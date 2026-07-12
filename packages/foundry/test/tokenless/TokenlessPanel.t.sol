// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { Test } from "forge-std/Test.sol";
import { CredentialIssuer } from "../../contracts/tokenless/CredentialIssuer.sol";
import { TokenlessPanel } from "../../contracts/tokenless/TokenlessPanel.sol";
import { MockERC20 } from "../../contracts/mocks/MockERC20.sol";

contract TokenlessPanelTest is Test {
    uint256 internal constant ISSUER_PK = 0xA11CE;
    uint256 internal constant BOUNTY = 100e6;
    uint256 internal constant FEE = 10e6;
    uint256 internal constant RESERVE = 15e6;
    uint256 internal constant COMPENSATION = 5e6;
    bytes32 internal constant CONTENT_ID = keccak256("binary-question");
    bytes32 internal constant TERMS_HASH = keccak256("immutable-round-terms");

    address internal funder = makeAddr("funder");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal rotationAuthority = makeAddr("rotationAuthority");
    address internal relayer = makeAddr("relayer");

    MockERC20 internal usdc;
    CredentialIssuer internal issuer;
    TokenlessPanel internal panel;

    struct Rater {
        uint256 privateKey;
        address voteKey;
        address payout;
        bytes32 nullifier;
        bytes32 salt;
        bytes32 responseHash;
        uint8 vote;
        uint16 prediction;
        bytes32 commitKey;
    }

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        issuer = new CredentialIssuer(rotationAuthority, vm.addr(ISSUER_PK), 1 days);
        panel = new TokenlessPanel(address(usdc), address(issuer));
        usdc.mint(funder, 10_000e6);
        vm.prank(funder);
        usdc.approve(address(panel), type(uint256).max);
    }

    function test_SuccessPathIsRestartSafeConservingAndPermissionlesslyClaimable() public {
        uint256 roundId = _createRound(2, 3);
        Rater memory alice = _rater(0x101, 1, 5_000, "alice", roundId);
        Rater memory bob = _rater(0x102, 1, 7_000, "bob", roundId);
        Rater memory carol = _rater(0x103, 0, 9_000, "carol", roundId);
        _commit(roundId, alice);
        _commit(roundId, bob);
        _commit(roundId, carol);

        vm.warp(_round(roundId).commitDeadline + 1);
        _reveal(roundId, alice);
        _reveal(roundId, bob);
        _reveal(roundId, carol);

        vm.warp(_round(roundId).revealDeadline + 1);
        panel.beginSettlement(roundId);
        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.Aggregating));

        vm.expectRevert(TokenlessPanel.NotClaimable.selector);
        panel.claim(alice.commitKey, alice.payout, alice.salt);

        panel.processAggregate(roundId, 0, 1);
        vm.expectRevert(TokenlessPanel.CursorMismatch.selector);
        panel.processAggregate(roundId, 0, 1);
        panel.processAggregate(roundId, 1, 9);
        assertEq(_round(roundId).upVotes, 2);

        panel.processWeights(roundId, 0, 2);
        panel.processWeights(roundId, 2, 1);
        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.Weighting));

        uint256 funderBeforeFinalize = usdc.balanceOf(funder);
        panel.finalizeSettlement(roundId);
        assertEq(usdc.balanceOf(funder) - funderBeforeFinalize, RESERVE);
        assertEq(usdc.balanceOf(feeRecipient), FEE);
        assertEq(usdc.balanceOf(address(panel)), BOUNTY);

        uint256 aliceAmount = panel.previewPayout(alice.commitKey);
        uint256 bobAmount = panel.previewPayout(bob.commitKey);
        uint256 carolAmount = panel.previewPayout(carol.commitKey);
        assertGe(aliceAmount, 26_666_666);
        assertGe(bobAmount, 26_666_666);
        assertGe(carolAmount, 26_666_666);
        assertLe(aliceAmount + bobAmount + carolAmount, BOUNTY);

        vm.prank(relayer);
        panel.claim(alice.commitKey, alice.payout, alice.salt);
        vm.prank(makeAddr("anyone"));
        panel.claim(bob.commitKey, bob.payout, bob.salt);
        panel.claim(carol.commitKey, carol.payout, carol.salt);
        assertEq(usdc.balanceOf(alice.payout), aliceAmount);
        assertEq(usdc.balanceOf(bob.payout), bobAmount);
        assertEq(usdc.balanceOf(carol.payout), carolAmount);

        uint256 dust = BOUNTY - aliceAmount - bobAmount - carolAmount;
        vm.warp(_round(roundId).claimDeadline + 1);
        uint256 funderBeforeDust = usdc.balanceOf(funder);
        assertEq(panel.returnStaleShares(roundId), dust);
        assertEq(usdc.balanceOf(funder) - funderBeforeDust, dust);
        assertEq(usdc.balanceOf(address(panel)), 0);
    }

    function test_UnderQuorumRefundsBountyAndFeeButPaysValidRevealer() public {
        uint256 roundId = _createRound(2, 3);
        Rater memory alice = _rater(0x201, 1, 7_000, "alice", roundId);
        Rater memory bob = _rater(0x202, 0, 3_000, "bob", roundId);
        _commit(roundId, alice);
        _commit(roundId, bob);

        vm.warp(_round(roundId).commitDeadline + 1);
        _reveal(roundId, alice);
        vm.warp(_round(roundId).revealDeadline + 1);

        uint256 beforeRefund = usdc.balanceOf(funder);
        panel.beginSettlement(roundId);
        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.UnderQuorumCompensation));
        assertEq(usdc.balanceOf(funder) - beforeRefund, BOUNTY + FEE + RESERVE - COMPENSATION);

        panel.claimCompensation(alice.commitKey, alice.payout, alice.salt);
        assertEq(usdc.balanceOf(alice.payout), COMPENSATION);
        vm.expectRevert(TokenlessPanel.NotClaimable.selector);
        panel.claimCompensation(bob.commitKey, bob.payout, bob.salt);
        assertEq(usdc.balanceOf(address(panel)), 0);
    }

    function test_BeaconFailurePaysEveryAcceptedCommitterAndRefundsRemainingFunds() public {
        uint256 roundId = _createRound(2, 3);
        Rater memory alice = _rater(0x301, 1, 7_000, "alice", roundId);
        Rater memory bob = _rater(0x302, 0, 3_000, "bob", roundId);
        _commit(roundId, alice);
        _commit(roundId, bob);

        vm.warp(_round(roundId).beaconFailureDeadline + 1);
        uint256 beforeRefund = usdc.balanceOf(funder);
        panel.beginSettlement(roundId);
        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.BeaconFailureCompensation));
        assertEq(usdc.balanceOf(funder) - beforeRefund, BOUNTY + FEE + RESERVE - 2 * COMPENSATION);

        panel.claimCompensation(alice.commitKey, alice.payout, alice.salt);
        panel.claimCompensation(bob.commitKey, bob.payout, bob.salt);
        assertEq(usdc.balanceOf(address(panel)), 0);
    }

    function test_ZeroCommitRoundFullyRefunds() public {
        uint256 roundId = _createRound(2, 3);
        uint256 beforeRefund = usdc.balanceOf(funder);
        vm.warp(_round(roundId).revealDeadline + 1);
        panel.beginSettlement(roundId);

        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.ZeroCommitRefund));
        assertEq(usdc.balanceOf(funder) - beforeRefund, BOUNTY + FEE + RESERVE);
        assertEq(usdc.balanceOf(address(panel)), 0);
    }

    function test_FirstAcceptedCommitPermanentlyDisablesFunderCancellation() public {
        uint256 roundId = _createRound(2, 3);
        Rater memory alice = _rater(0x401, 1, 7_000, "alice", roundId);
        _commit(roundId, alice);

        vm.prank(funder);
        vm.expectRevert(TokenlessPanel.InvalidState.selector);
        panel.cancelEmptyRound(roundId);
    }

    function test_IssuerRotationCannotAffectAnAcceptedCommitOrItsPayment() public {
        uint256 roundId = _createRound(1, 1);
        Rater memory alice = _rater(0x501, 1, 5_000, "alice", roundId);
        _commit(roundId, alice);

        vm.prank(rotationAuthority);
        issuer.rotateEmergency(makeAddr("replacementSigner"));

        vm.warp(_round(roundId).commitDeadline + 1);
        _reveal(roundId, alice);
        vm.warp(_round(roundId).revealDeadline + 1);
        panel.beginSettlement(roundId);
        panel.processAggregate(roundId, 0, 1);
        panel.processWeights(roundId, 0, 1);
        panel.finalizeSettlement(roundId);
        panel.claim(alice.commitKey, alice.payout, alice.salt);

        assertEq(usdc.balanceOf(alice.payout), BOUNTY);
    }

    function test_RoundFundingMustCoverMaximumAcceptedWorkReserve() public {
        TokenlessPanel.RoundTerms memory terms = _terms(2, 3);
        terms.attemptReserve = 3 * COMPENSATION - 1;
        vm.prank(funder);
        vm.expectRevert(TokenlessPanel.InvalidTerms.selector);
        panel.createRound(terms);
    }

    function _createRound(uint32 minimumReveals, uint32 maximumCommits) internal returns (uint256 roundId) {
        vm.prank(funder);
        roundId = panel.createRound(_terms(minimumReveals, maximumCommits));
    }

    function _terms(uint32 minimumReveals, uint32 maximumCommits)
        internal
        view
        returns (TokenlessPanel.RoundTerms memory terms)
    {
        terms = TokenlessPanel.RoundTerms({
            contentId: CONTENT_ID,
            termsHash: TERMS_HASH,
            beaconNetworkHash: keccak256("drand-quicknet-chain-hash"),
            bountyAmount: BOUNTY,
            feeAmount: FEE,
            attemptReserve: RESERVE,
            attemptCompensation: COMPENSATION,
            minimumReveals: minimumReveals,
            maximumCommits: maximumCommits,
            requiredTier: 2,
            commitDeadline: uint64(block.timestamp + 10 minutes),
            revealDeadline: uint64(block.timestamp + 20 minutes),
            beaconFailureDeadline: uint64(block.timestamp + 30 minutes),
            beaconRound: 12_345_678,
            claimGracePeriod: 1 days,
            feeRecipient: feeRecipient
        });
    }

    function _rater(uint256 privateKey, uint8 vote, uint16 prediction, string memory label, uint256 roundId)
        internal
        returns (Rater memory rater)
    {
        rater.privateKey = privateKey;
        rater.voteKey = vm.addr(privateKey);
        rater.payout = makeAddr(string.concat(label, "Payout"));
        rater.nullifier = keccak256(abi.encode("nullifier", label, roundId));
        rater.salt = keccak256(abi.encode("salt", label, roundId));
        rater.responseHash = keccak256(abi.encode("response", label, roundId));
        rater.vote = vote;
        rater.prediction = prediction;
        rater.commitKey = panel.commitKeyFor(roundId, rater.voteKey);
    }

    function _commit(uint256 roundId, Rater memory rater) internal {
        TokenlessPanel.Voucher memory voucher = TokenlessPanel.Voucher({
            voteKey: rater.voteKey,
            contentId: CONTENT_ID,
            roundId: roundId,
            nullifier: rater.nullifier,
            tierId: 2,
            issuerEpoch: 1,
            expiresAt: uint64(block.timestamp + 1 hours)
        });
        bytes32 sealedCommitment = panel.revealCommitment(
            roundId, rater.voteKey, rater.vote, rater.prediction, rater.responseHash, rater.payout, rater.salt
        );
        bytes32 payoutCommitment = panel.payoutCommitmentFor(rater.payout, rater.salt);
        bytes memory sealedPayload = abi.encodePacked("tlock-ciphertext", rater.voteKey, roundId);
        bytes32 sealedPayloadHash = keccak256(sealedPayload);
        bytes memory voucherSignature = _sign(ISSUER_PK, panel.voucherDigest(voucher));
        bytes memory voteSignature = _sign(
            rater.privateKey,
            panel.commitDigest(roundId, sealedCommitment, sealedPayloadHash, payoutCommitment, rater.nullifier)
        );

        vm.prank(relayer);
        panel.commit(voucher, sealedCommitment, sealedPayload, payoutCommitment, voucherSignature, voteSignature);
    }

    function _reveal(uint256 roundId, Rater memory rater) internal {
        vm.prank(relayer);
        panel.reveal(roundId, rater.voteKey, rater.vote, rater.prediction, rater.responseHash, rater.payout, rater.salt);
    }

    function _round(uint256 roundId) internal view returns (TokenlessPanel.Round memory) {
        return panel.getRound(roundId);
    }

    function _sign(uint256 privateKey, bytes32 digest) internal pure returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}
