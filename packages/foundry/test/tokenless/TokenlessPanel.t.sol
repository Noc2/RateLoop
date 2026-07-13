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
    bytes32 internal constant ADMISSION_POLICY_HASH = keccak256("invited-reviewers-policy-v1");

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

        panel.finalizeSettlement(roundId);
        assertEq(panel.withdrawableCredit(funder), RESERVE);
        assertEq(panel.withdrawableCredit(feeRecipient), FEE);
        assertEq(panel.totalWithdrawableCredit(), RESERVE + FEE);
        assertEq(usdc.balanceOf(address(panel)), BOUNTY + RESERVE + FEE);

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
        usdc.setBlockedRecipient(funder, true);
        assertEq(panel.returnStaleShares(roundId), dust);
        assertEq(panel.withdrawableCredit(funder), RESERVE + dust);

        address funderDestination = makeAddr("funderDestination");
        vm.prank(funder);
        panel.withdrawCredit(funderDestination);
        vm.prank(feeRecipient);
        panel.withdrawCredit(feeRecipient);
        assertEq(usdc.balanceOf(funderDestination), RESERVE + dust);
        assertEq(usdc.balanceOf(address(panel)), 0);
    }

    function test_UnderQuorumWaitsForBeaconDeadlineAndPaysOnlyValidRevealers() public {
        uint256 roundId = _createRound(2, 3);
        Rater memory alice = _rater(0x201, 1, 7_000, "alice", roundId);
        Rater memory bob = _rater(0x202, 0, 3_000, "bob", roundId);
        _commit(roundId, alice);
        _commit(roundId, bob);

        vm.warp(_round(roundId).commitDeadline + 1);
        _reveal(roundId, alice);
        vm.warp(_round(roundId).revealDeadline + 1);

        vm.expectRevert(TokenlessPanel.InvalidDeadline.selector);
        panel.beginSettlement(roundId);

        vm.warp(_round(roundId).beaconFailureDeadline + 1);
        panel.beginSettlement(roundId);
        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.UnderQuorumCompensation));
        assertEq(panel.withdrawableCredit(funder), BOUNTY + FEE + RESERVE - COMPENSATION);

        panel.claimCompensation(alice.commitKey, alice.payout, alice.salt);
        vm.expectRevert(TokenlessPanel.NotClaimable.selector);
        panel.claimCompensation(bob.commitKey, bob.payout, bob.salt);
        assertEq(usdc.balanceOf(alice.payout), COMPENSATION);
        assertEq(usdc.balanceOf(bob.payout), 0);

        vm.prank(funder);
        panel.withdrawCredit(funder);
        assertEq(usdc.balanceOf(address(panel)), 0);
    }

    function test_ZeroRevealAttackCannotFarmBeaconFailureReserve() public {
        uint256 roundId = _createRound(2, 3);
        Rater memory alice = _rater(0x301, 1, 7_000, "alice", roundId);
        Rater memory bob = _rater(0x302, 0, 3_000, "bob", roundId);
        _commit(roundId, alice);
        _commit(roundId, bob);

        vm.warp(_round(roundId).beaconFailureDeadline + 1);
        panel.beginSettlement(roundId);
        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.BeaconFailureCompensation));
        assertEq(panel.withdrawableCredit(funder), BOUNTY + FEE + RESERVE);

        vm.expectRevert(TokenlessPanel.NotClaimable.selector);
        panel.claimCompensation(alice.commitKey, alice.payout, alice.salt);
        vm.expectRevert(TokenlessPanel.NotClaimable.selector);
        panel.claimCompensation(bob.commitKey, bob.payout, bob.salt);
        vm.prank(funder);
        panel.withdrawCredit(funder);
        assertEq(usdc.balanceOf(address(panel)), 0);
    }

    function test_LateSelfRevealProvesValidWorkAndReceivesUnderQuorumCompensation() public {
        uint256 roundId = _createRound(2, 3);
        Rater memory alice = _rater(0x311, 1, 7_000, "alice", roundId);
        Rater memory bob = _rater(0x312, 0, 3_000, "bob", roundId);
        _commit(roundId, alice);
        _commit(roundId, bob);

        vm.warp(_round(roundId).revealDeadline + 1);
        _reveal(roundId, alice);
        assertTrue(panel.getCommit(alice.commitKey).revealed);

        vm.expectRevert(TokenlessPanel.InvalidDeadline.selector);
        panel.beginSettlement(roundId);

        vm.warp(_round(roundId).beaconFailureDeadline + 1);
        panel.beginSettlement(roundId);
        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.UnderQuorumCompensation));
        assertEq(panel.withdrawableCredit(funder), BOUNTY + FEE + RESERVE - COMPENSATION);
        assertEq(panel.claimCompensation(alice.commitKey, alice.payout, alice.salt), COMPENSATION);
        vm.expectRevert(TokenlessPanel.NotClaimable.selector);
        panel.claimCompensation(bob.commitKey, bob.payout, bob.salt);
    }

    function test_LateSelfRevealClosesAtBeaconFailureDeadline() public {
        uint256 roundId = _createRound(2, 3);
        Rater memory alice = _rater(0x321, 1, 7_000, "alice", roundId);
        _commit(roundId, alice);

        vm.warp(_round(roundId).beaconFailureDeadline + 1);
        vm.expectRevert(TokenlessPanel.InvalidDeadline.selector);
        _reveal(roundId, alice);
    }

    function test_ZeroCommitRoundFullyRefunds() public {
        uint256 roundId = _createRound(2, 3);
        vm.warp(_round(roundId).revealDeadline + 1);
        panel.beginSettlement(roundId);

        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.ZeroCommitRefund));
        assertEq(panel.withdrawableCredit(funder), BOUNTY + FEE + RESERVE);
        assertEq(usdc.balanceOf(address(panel)), BOUNTY + FEE + RESERVE);

        vm.prank(funder);
        panel.withdrawCredit(funder);
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

    function test_VoucherMustMatchExactAdmissionPolicyHash() public {
        uint256 roundId = _createRound(1, 1);
        Rater memory alice = _rater(0x581, 1, 5_000, "alice", roundId);

        TokenlessPanel.Voucher memory voucher = _voucher(roundId, alice);
        voucher.admissionPolicyHash = keccak256("different-but-not-ordered-policy");
        _expectInvalidVoucher(roundId, alice, voucher);

        assertEq(_round(roundId).commitCount, 0);
        assertFalse(panel.nullifierUsed(alice.nullifier));
    }

    function test_VoucherSignatureCannotBeReusedAcrossAdmissionPolicies() public {
        uint256 roundId = _createRound(1, 1);
        Rater memory alice = _rater(0x582, 1, 5_000, "alice", roundId);
        TokenlessPanel.Voucher memory voucher = _voucher(roundId, alice);
        bytes32 signedDigest = panel.voucherDigest(voucher);
        bytes memory signature = _sign(ISSUER_PK, signedDigest);

        voucher.admissionPolicyHash = keccak256("another-policy");
        bytes32 changedDigest = panel.voucherDigest(voucher);
        assertNotEq(changedDigest, signedDigest);
        assertFalse(issuer.isValidVoucherSignature(1, changedDigest, signature));
    }

    function test_RoundRejectsEmptyAdmissionPolicyHash() public {
        TokenlessPanel.RoundTerms memory terms = _terms(1, 1);
        terms.admissionPolicyHash = bytes32(0);

        vm.prank(funder);
        vm.expectRevert(TokenlessPanel.InvalidTerms.selector);
        panel.createRound(terms);
    }

    function test_ClaimGracePeriodAcceptsSafeUpperBoundary() public {
        TokenlessPanel.RoundTerms memory terms = _terms(2, 3);
        terms.claimGracePeriod = panel.MAX_CLAIM_GRACE_PERIOD();

        vm.prank(funder);
        uint256 roundId = panel.createRound(terms);

        Rater memory alice = _rater(0x601, 1, 5_000, "alice", roundId);
        _commit(roundId, alice);
        vm.warp(_round(roundId).beaconFailureDeadline + 1);
        uint256 expectedClaimDeadline = block.timestamp + panel.MAX_CLAIM_GRACE_PERIOD();
        panel.beginSettlement(roundId);

        assertEq(_round(roundId).claimGracePeriod, panel.MAX_CLAIM_GRACE_PERIOD());
        assertEq(_round(roundId).claimDeadline, expectedClaimDeadline);
    }

    function test_ClaimGracePeriodRejectsValueAboveSafeUpperBoundary() public {
        TokenlessPanel.RoundTerms memory terms = _terms(2, 3);
        terms.claimGracePeriod = panel.MAX_CLAIM_GRACE_PERIOD() + 1;

        vm.prank(funder);
        vm.expectRevert(TokenlessPanel.InvalidDeadline.selector);
        panel.createRound(terms);
    }

    function test_BeaconFailureDeadlineMustBeStrictlyAfterRevealDeadline() public {
        TokenlessPanel.RoundTerms memory terms = _terms(2, 3);
        terms.beaconFailureDeadline = terms.revealDeadline;

        vm.prank(funder);
        vm.expectRevert(TokenlessPanel.InvalidDeadline.selector);
        panel.createRound(terms);
    }

    function test_BlockedRefundAndFeeRecipientsCannotPreventFinalizationOrRaterClaim() public {
        uint256 roundId = _createRound(1, 1);
        Rater memory alice = _rater(0x701, 1, 5_000, "alice", roundId);
        _commit(roundId, alice);

        vm.warp(_round(roundId).commitDeadline + 1);
        _reveal(roundId, alice);
        vm.warp(_round(roundId).revealDeadline + 1);
        panel.beginSettlement(roundId);
        panel.processAggregate(roundId, 0, 1);
        panel.processWeights(roundId, 0, 1);

        usdc.setBlockedRecipient(funder, true);
        usdc.setBlockedRecipient(feeRecipient, true);
        panel.finalizeSettlement(roundId);

        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.Finalized));
        assertEq(panel.withdrawableCredit(funder), RESERVE);
        assertEq(panel.withdrawableCredit(feeRecipient), FEE);

        usdc.setTransferShortfall(1);
        vm.expectRevert(TokenlessPanel.TransferAmountMismatch.selector);
        panel.claim(alice.commitKey, alice.payout, alice.salt);
        assertFalse(panel.getCommit(alice.commitKey).claimed);
        usdc.setTransferShortfall(0);
        assertEq(panel.claim(alice.commitKey, alice.payout, alice.salt), BOUNTY);

        vm.prank(funder);
        vm.expectRevert(bytes("MockERC20: recipient blocked"));
        panel.withdrawCredit(funder);
        assertEq(panel.withdrawableCredit(funder), RESERVE);

        address alternateFunderDestination = makeAddr("alternateFunderDestination");
        address alternateFeeDestination = makeAddr("alternateFeeDestination");
        vm.prank(funder);
        panel.withdrawCredit(alternateFunderDestination);
        vm.prank(feeRecipient);
        panel.withdrawCredit(alternateFeeDestination);

        assertEq(usdc.balanceOf(alternateFunderDestination), RESERVE);
        assertEq(usdc.balanceOf(alternateFeeDestination), FEE);
        assertEq(usdc.balanceOf(address(panel)), 0);
    }

    function test_BlockedFunderCannotPreventZeroCommitTerminalizationAndOnlyOwnerCanRedirectCredit() public {
        uint256 roundId = _createRound(2, 3);
        address attacker = makeAddr("creditAttacker");
        address alternateDestination = makeAddr("alternateDestination");
        usdc.setBlockedRecipient(funder, true);

        vm.prank(funder);
        panel.cancelEmptyRound(roundId);

        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.ZeroCommitRefund));
        assertEq(panel.withdrawableCredit(funder), BOUNTY + FEE + RESERVE);

        vm.prank(attacker);
        vm.expectRevert(TokenlessPanel.NoCredit.selector);
        panel.withdrawCredit(alternateDestination);
        assertEq(panel.withdrawableCredit(funder), BOUNTY + FEE + RESERVE);

        usdc.setTransferShortfall(1);
        vm.prank(funder);
        vm.expectRevert(TokenlessPanel.TransferAmountMismatch.selector);
        panel.withdrawCredit(alternateDestination);
        assertEq(panel.withdrawableCredit(funder), BOUNTY + FEE + RESERVE);
        usdc.setTransferShortfall(0);

        vm.prank(funder);
        panel.withdrawCredit(alternateDestination);
        assertEq(usdc.balanceOf(alternateDestination), BOUNTY + FEE + RESERVE);
        assertEq(usdc.balanceOf(address(panel)), 0);
    }

    function test_BlockedFunderCannotPreventUnderQuorumCompensation() public {
        uint256 roundId = _createRound(2, 2);
        Rater memory alice = _rater(0x801, 1, 7_000, "alice", roundId);
        _commit(roundId, alice);

        vm.warp(_round(roundId).commitDeadline + 1);
        _reveal(roundId, alice);
        vm.warp(_round(roundId).beaconFailureDeadline + 1);
        usdc.setBlockedRecipient(funder, true);
        panel.beginSettlement(roundId);

        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.UnderQuorumCompensation));
        assertEq(panel.withdrawableCredit(funder), BOUNTY + FEE + RESERVE - COMPENSATION);
        assertEq(panel.claimCompensation(alice.commitKey, alice.payout, alice.salt), COMPENSATION);

        address alternateDestination = makeAddr("underQuorumRefundDestination");
        vm.prank(funder);
        panel.withdrawCredit(alternateDestination);
        assertEq(usdc.balanceOf(address(panel)), 0);
    }

    function test_OnlyMockDeployerCanConfigureTransferFaultsButMintRemainsPublic() public {
        address attacker = makeAddr("mockAttacker");

        vm.startPrank(attacker);
        usdc.mint(attacker, 1e6);
        vm.expectRevert(MockERC20.UnauthorizedFaultController.selector);
        usdc.setBlockedRecipient(funder, true);
        vm.expectRevert(MockERC20.UnauthorizedFaultController.selector);
        usdc.setTransferShortfall(1);
        vm.expectRevert(MockERC20.UnauthorizedFaultController.selector);
        usdc.setAuthorizationTransferShortfall(1);
        vm.stopPrank();

        assertEq(usdc.balanceOf(attacker), 1e6);
        assertFalse(usdc.blockedRecipients(funder));
        assertEq(usdc.transferShortfall(), 0);
        assertEq(usdc.authorizationTransferShortfall(), 0);

        usdc.setBlockedRecipient(funder, true);
        usdc.setTransferShortfall(2);
        usdc.setAuthorizationTransferShortfall(3);
        assertTrue(usdc.blockedRecipients(funder));
        assertEq(usdc.transferShortfall(), 2);
        assertEq(usdc.authorizationTransferShortfall(), 3);
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
            admissionPolicyHash: ADMISSION_POLICY_HASH,
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
        TokenlessPanel.Voucher memory voucher = _voucher(roundId, rater);
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

    function _voucher(uint256 roundId, Rater memory rater)
        internal
        view
        returns (TokenlessPanel.Voucher memory voucher)
    {
        voucher = TokenlessPanel.Voucher({
            voteKey: rater.voteKey,
            contentId: CONTENT_ID,
            roundId: roundId,
            nullifier: rater.nullifier,
            admissionPolicyHash: ADMISSION_POLICY_HASH,
            issuerEpoch: 1,
            expiresAt: uint64(block.timestamp + 1 hours)
        });
    }

    function _expectInvalidVoucher(uint256 roundId, Rater memory rater, TokenlessPanel.Voucher memory voucher)
        internal
    {
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
        vm.expectRevert(TokenlessPanel.InvalidVoucher.selector);
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
