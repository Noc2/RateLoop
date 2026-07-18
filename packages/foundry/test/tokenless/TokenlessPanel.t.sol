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
    uint256 internal constant FIXED_BASE = 26_666_666;
    uint256 internal constant MAXIMUM_BONUS = 6_666_667;
    uint256 internal constant RESERVE = FIXED_BASE * 3;
    bytes32 internal constant CONTENT_ID = keccak256("binary-question");
    bytes32 internal constant TERMS_HASH = keccak256("immutable-round-terms");
    bytes32 internal constant ADMISSION_POLICY_HASH = keccak256("invited-reviewers-policy-v1");
    bytes32 internal constant ENTROPY = keccak256("post-closure-entropy");

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

    function test_RbtsSettlementFixesEvidenceLiabilityAndImmediateRefunds() public {
        (uint256 roundId, Rater[3] memory raters) = _healthyRound();
        _beginHealthySettlement(roundId);

        panel.processAggregate(roundId, 0, 1);
        vm.expectRevert(TokenlessPanel.CursorMismatch.selector);
        panel.processAggregate(roundId, 0, 1);
        panel.processAggregate(roundId, 1, 9);
        assertEq(_round(roundId).upVotes, 2);
        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.AwaitingSeed));

        _finalizeSeed(roundId, ENTROPY);
        assertEq(uint8(_round(roundId).scoringMode), uint8(TokenlessPanel.ScoringMode.Rbts));
        assertNotEq(_round(roundId).scoringSeed, bytes32(0));

        panel.processScores(roundId, 0, 2);
        vm.expectRevert(TokenlessPanel.CursorMismatch.selector);
        panel.processScores(roundId, 0, 1);
        panel.processScores(roundId, 2, 1);
        panel.finalizeSettlement(roundId);

        TokenlessPanel.Round memory round = _round(roundId);
        assertEq(uint8(round.state), uint8(TokenlessPanel.RoundState.Finalized));
        assertGt(round.totalRbtsScoreBps, 0);

        uint256 liability;
        bytes32[3] memory references;
        bytes32[3] memory peers;
        for (uint256 i = 0; i < raters.length; ++i) {
            TokenlessPanel.CommitRecord memory record = panel.getCommit(raters[i].commitKey);
            assertNotEq(record.referenceCommitKey, bytes32(0));
            assertNotEq(record.peerCommitKey, bytes32(0));
            assertNotEq(record.referenceCommitKey, raters[i].commitKey);
            assertNotEq(record.peerCommitKey, raters[i].commitKey);
            assertNotEq(record.referenceCommitKey, record.peerCommitKey);
            assertEq(record.finalizedPayout, FIXED_BASE + ((MAXIMUM_BONUS * uint256(record.rbtsScoreBps)) / 10_000));
            assertGe(record.finalizedPayout, FIXED_BASE);
            assertLe(record.finalizedPayout, FIXED_BASE + MAXIMUM_BONUS);
            assertEq(panel.previewPayout(raters[i].commitKey), record.finalizedPayout);
            liability += record.finalizedPayout;
            references[i] = record.referenceCommitKey;
            peers[i] = record.peerCommitKey;
        }
        _assertEachRoleUsedOnce(raters, references);
        _assertEachRoleUsedOnce(raters, peers);
        assertEq(round.totalFinalizedLiability, liability);
        assertEq(panel.withdrawableCredit(funder), RESERVE + BOUNTY - liability);
        assertEq(panel.withdrawableCredit(feeRecipient), FEE);

        for (uint256 i = 0; i < raters.length; ++i) {
            vm.prank(makeAddr("permissionlessExecutor"));
            assertEq(
                panel.claim(raters[i].commitKey, raters[i].payout, raters[i].salt),
                panel.getCommit(raters[i].commitKey).finalizedPayout
            );
        }
        vm.warp(round.claimDeadline + 1);
        assertEq(panel.returnStaleShares(roundId), 0);

        vm.prank(funder);
        panel.withdrawCredit(funder);
        vm.prank(feeRecipient);
        panel.withdrawCredit(feeRecipient);
        assertEq(usdc.balanceOf(address(panel)), 0);
    }

    function test_ExpiredEntropyDeterministicallyFallsBackToFixedBaseOnly() public {
        (uint256 roundId, Rater[3] memory raters) = _healthyRound();
        _beginHealthySettlement(roundId);
        panel.processAggregate(roundId, 0, 3);

        uint256 entropyBlock = _round(roundId).entropyBlock;
        vm.roll(entropyBlock + 257);
        panel.finalizeScoringSeed(roundId);
        assertEq(uint8(_round(roundId).scoringMode), uint8(TokenlessPanel.ScoringMode.BaseOnlyEntropyUnavailable));
        assertEq(_round(roundId).scoringSeed, bytes32(0));

        panel.processScores(roundId, 0, 3);
        panel.finalizeSettlement(roundId);
        TokenlessPanel.Round memory round = _round(roundId);
        assertEq(round.totalRbtsScoreBps, 0);
        assertEq(round.totalFinalizedLiability, FIXED_BASE * 3);
        assertEq(panel.withdrawableCredit(funder), RESERVE + BOUNTY - (FIXED_BASE * 3));
        for (uint256 i = 0; i < raters.length; ++i) {
            TokenlessPanel.CommitRecord memory record = panel.getCommit(raters[i].commitKey);
            assertEq(record.referenceCommitKey, bytes32(0));
            assertEq(record.peerCommitKey, bytes32(0));
            assertEq(record.rbtsScoreBps, 0);
            assertEq(record.finalizedPayout, FIXED_BASE);
        }
    }

    function test_EntropyCannotBeReadUntilTheFutureBlockIsHistorical() public {
        (uint256 roundId,) = _healthyRound();
        _beginHealthySettlement(roundId);
        panel.processAggregate(roundId, 0, 3);

        vm.roll(_round(roundId).entropyBlock);
        vm.expectRevert(TokenlessPanel.InvalidDeadline.selector);
        panel.finalizeScoringSeed(roundId);
    }

    function test_UnderQuorumWaitsForFailureDeadlineAndPaysOnlyValidRevealers() public {
        uint256 roundId = _createRound(3, 3);
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
        assertEq(panel.withdrawableCredit(funder), BOUNTY + FEE + RESERVE - FIXED_BASE);
        assertEq(panel.claimCompensation(alice.commitKey, alice.payout, alice.salt), FIXED_BASE);
        vm.expectRevert(TokenlessPanel.NotClaimable.selector);
        panel.claimCompensation(bob.commitKey, bob.payout, bob.salt);
    }

    function test_ZeroRevealAttackCannotFarmAttemptReserve() public {
        uint256 roundId = _createRound(3, 3);
        Rater memory alice = _rater(0x301, 1, 7_000, "alice", roundId);
        _commit(roundId, alice);
        vm.warp(_round(roundId).beaconFailureDeadline + 1);
        panel.beginSettlement(roundId);

        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.BeaconFailureCompensation));
        assertEq(panel.withdrawableCredit(funder), BOUNTY + FEE + RESERVE);
        vm.expectRevert(TokenlessPanel.NotClaimable.selector);
        panel.claimCompensation(alice.commitKey, alice.payout, alice.salt);
    }

    function test_LateSelfRevealBeforeFailureDeadlineEarnsAttemptCompensation() public {
        uint256 roundId = _createRound(3, 3);
        Rater memory alice = _rater(0x311, 1, 7_000, "alice", roundId);
        _commit(roundId, alice);
        vm.warp(_round(roundId).revealDeadline + 1);
        _reveal(roundId, alice);

        // A reveal after the disclosed reveal deadline is compensation-only: it must never join
        // the frozen scoring set, so it cannot change quorum, the verdict, peers, or RBTS.
        assertEq(_round(roundId).revealCount, 0);
        assertEq(_round(roundId).compensatedRevealCount, 1);
        vm.expectRevert();
        panel.roundRevealKey(roundId, 0);

        vm.warp(_round(roundId).beaconFailureDeadline + 1);
        panel.beginSettlement(roundId);
        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.UnderQuorumCompensation));
        assertEq(panel.withdrawableCredit(funder), BOUNTY + FEE + RESERVE - FIXED_BASE);
        assertEq(panel.claimCompensation(alice.commitKey, alice.payout, alice.salt), FIXED_BASE);
    }

    function test_LateRevealsCannotForceQuorumOrEnterTheScoredSet() public {
        uint256 roundId = _createRound(3, 3);
        Rater memory alice = _rater(0x321, 1, 7_000, "alice", roundId);
        Rater memory bob = _rater(0x322, 0, 3_000, "bob", roundId);
        Rater memory carol = _rater(0x323, 1, 5_000, "carol", roundId);
        _commit(roundId, alice);
        _commit(roundId, bob);
        _commit(roundId, carol);

        // Two timely reveals stay below the minimum of three.
        vm.warp(_round(roundId).commitDeadline + 1);
        _reveal(roundId, alice);
        _reveal(roundId, bob);
        assertEq(_round(roundId).revealCount, 2);
        assertEq(_round(roundId).compensatedRevealCount, 2);

        // A late reveal cannot front-run settlement to force the round into a scored path: it
        // does not raise the scored reveal count even though it earns accepted-work compensation.
        vm.warp(_round(roundId).revealDeadline + 1);
        _reveal(roundId, carol);
        assertEq(_round(roundId).revealCount, 2);
        assertEq(_round(roundId).compensatedRevealCount, 3);
        vm.expectRevert();
        panel.roundRevealKey(roundId, 2);

        vm.warp(_round(roundId).beaconFailureDeadline + 1);
        panel.beginSettlement(roundId);
        assertEq(uint8(_round(roundId).state), uint8(TokenlessPanel.RoundState.UnderQuorumCompensation));

        // Every valid revealer, timely or late, still receives the fixed accepted-work amount and
        // the funder is refunded exactly the unused remainder. Settlement conservation holds.
        assertEq(panel.withdrawableCredit(funder), BOUNTY + FEE + RESERVE - (FIXED_BASE * 3));
        assertEq(panel.claimCompensation(alice.commitKey, alice.payout, alice.salt), FIXED_BASE);
        assertEq(panel.claimCompensation(bob.commitKey, bob.payout, bob.salt), FIXED_BASE);
        assertEq(panel.claimCompensation(carol.commitKey, carol.payout, carol.salt), FIXED_BASE);

        vm.warp(_round(roundId).claimDeadline + 1);
        assertEq(panel.returnStaleShares(roundId), 0);
        vm.prank(funder);
        panel.withdrawCredit(funder);
        assertEq(usdc.balanceOf(address(panel)), 0);
    }

    function test_QuorateRoundRejectsLateRevealInsteadOfAcceptingUnpaidWork() public {
        uint256 roundId = _createRound(3, 4);
        Rater memory alice = _rater(0x331, 1, 7_000, "alice-quorate", roundId);
        Rater memory bob = _rater(0x332, 0, 3_000, "bob-quorate", roundId);
        Rater memory carol = _rater(0x333, 1, 5_000, "carol-quorate", roundId);
        Rater memory dave = _rater(0x334, 0, 5_000, "dave-late", roundId);
        _commit(roundId, alice);
        _commit(roundId, bob);
        _commit(roundId, carol);
        _commit(roundId, dave);

        vm.warp(_round(roundId).commitDeadline + 1);
        _reveal(roundId, alice);
        _reveal(roundId, bob);
        _reveal(roundId, carol);
        assertEq(_round(roundId).revealCount, 3);
        assertEq(_round(roundId).compensatedRevealCount, 3);

        vm.warp(_round(roundId).revealDeadline + 1);
        vm.expectRevert(TokenlessPanel.InvalidState.selector);
        _reveal(roundId, dave);
        assertFalse(panel.getCommit(dave.commitKey).revealed);
        assertEq(_round(roundId).compensatedRevealCount, 3);

        panel.beginSettlement(roundId);
        panel.processAggregate(roundId, 0, 3);
        _finalizeSeed(roundId, ENTROPY);
        panel.processScores(roundId, 0, 3);
        panel.finalizeSettlement(roundId);

        vm.expectRevert(TokenlessPanel.NotClaimable.selector);
        panel.claim(dave.commitKey, dave.payout, dave.salt);
    }

    function test_ZeroCommitRoundFullyRefundsAndFirstCommitDisablesCancellation() public {
        uint256 emptyRound = _createRound(3, 3);
        vm.prank(funder);
        panel.cancelEmptyRound(emptyRound);
        assertEq(uint8(_round(emptyRound).state), uint8(TokenlessPanel.RoundState.ZeroCommitRefund));
        assertEq(panel.withdrawableCredit(funder), BOUNTY + FEE + RESERVE);

        uint256 committedRound = _createRound(3, 3);
        _commit(committedRound, _rater(0x401, 1, 7_000, "alice", committedRound));
        vm.prank(funder);
        vm.expectRevert(TokenlessPanel.InvalidState.selector);
        panel.cancelEmptyRound(committedRound);
    }

    function test_IssuerRotationCannotAffectAcceptedWorkOrPayment() public {
        (uint256 roundId, Rater[3] memory raters) = _healthyRound();
        vm.prank(rotationAuthority);
        issuer.rotateEmergency(makeAddr("replacementSigner"));

        _beginHealthySettlement(roundId);
        panel.processAggregate(roundId, 0, 3);
        _finalizeSeed(roundId, ENTROPY);
        panel.processScores(roundId, 0, 3);
        panel.finalizeSettlement(roundId);
        assertGt(panel.claim(raters[0].commitKey, raters[0].payout, raters[0].salt), 0);
    }

    function test_TermsEnforceMinimumPanelBoundedMaximumAndExactReserveEconomics() public {
        TokenlessPanel.RoundTerms memory terms = _terms(3, 3);

        terms.minimumReveals = 2;
        _expectInvalidTerms(terms);
        terms = _terms(3, 3);
        terms.maximumCommits = panel.MAXIMUM_COMMITS() + 1;
        _setEconomics(terms);
        _expectInvalidTerms(terms);
        terms = _terms(3, 3);
        terms.attemptCompensation = FIXED_BASE + 1;
        _expectInvalidTerms(terms);
        terms = _terms(3, 3);
        terms.attemptReserve = RESERVE - 1;
        _expectInvalidTerms(terms);

        terms = _terms(3, panel.MAXIMUM_COMMITS());
        vm.prank(funder);
        uint256 roundId = panel.createRound(terms);
        assertEq(_round(roundId).maximumCommits, panel.MAXIMUM_COMMITS());
    }

    function test_RevealRequiresOnePercentPredictionGrid() public {
        uint256 roundId = _createRound(3, 3);
        Rater memory invalid = _rater(0x501, 1, 150, "invalid", roundId);
        _commit(roundId, invalid);
        vm.warp(_round(roundId).commitDeadline + 1);
        vm.expectRevert(TokenlessPanel.InvalidPrediction.selector);
        _reveal(roundId, invalid);
    }

    function test_VoucherMustMatchExactAdmissionPolicyHash() public {
        uint256 roundId = _createRound(3, 3);
        Rater memory alice = _rater(0x581, 1, 5_000, "alice", roundId);
        TokenlessPanel.Voucher memory voucher = _voucher(roundId, alice);
        voucher.admissionPolicyHash = keccak256("different-policy");
        _expectInvalidVoucher(roundId, alice, voucher);
        assertFalse(panel.nullifierUsed(alice.nullifier));
    }

    function test_ClaimGraceAndFailureDeadlinesRemainBounded() public {
        TokenlessPanel.RoundTerms memory terms = _terms(3, 3);
        terms.claimGracePeriod = panel.MAX_CLAIM_GRACE_PERIOD();
        vm.prank(funder);
        panel.createRound(terms);

        terms = _terms(3, 3);
        terms.claimGracePeriod = panel.MAX_CLAIM_GRACE_PERIOD() + 1;
        vm.prank(funder);
        vm.expectRevert(TokenlessPanel.InvalidDeadline.selector);
        panel.createRound(terms);

        terms = _terms(3, 3);
        terms.beaconFailureDeadline = terms.revealDeadline;
        vm.prank(funder);
        vm.expectRevert(TokenlessPanel.InvalidDeadline.selector);
        panel.createRound(terms);
    }

    function test_RevealAndBeaconHorizonsAreBoundedFromCreation() public {
        // A round pinned to the maximum permitted reveal and beacon horizons is still valid.
        TokenlessPanel.RoundTerms memory terms = _terms(3, 3);
        terms.commitDeadline = uint64(block.timestamp + 10 minutes);
        terms.revealDeadline = uint64(block.timestamp + panel.MAX_REVEAL_HORIZON());
        terms.beaconFailureDeadline = uint64(block.timestamp + panel.MAX_REVEAL_HORIZON() + panel.MIN_BEACON_GRACE());
        vm.prank(funder);
        panel.createRound(terms);

        // Reveal deadline beyond the maximum horizon strands accepted work and is rejected.
        terms = _terms(3, 3);
        terms.revealDeadline = uint64(block.timestamp + panel.MAX_REVEAL_HORIZON() + 1);
        terms.beaconFailureDeadline = terms.revealDeadline + 10 minutes;
        _expectInvalidDeadline(terms);

        // Beacon-failure deadline beyond the maximum horizon is rejected.
        terms = _terms(3, 3);
        terms.beaconFailureDeadline = uint64(block.timestamp + panel.MAX_BEACON_FAILURE_HORIZON() + 1);
        _expectInvalidDeadline(terms);

        // A reveal window narrower than the minimum operational window is rejected.
        terms = _terms(3, 3);
        terms.revealDeadline = terms.commitDeadline + 1;
        _expectInvalidDeadline(terms);

        // A beacon grace narrower than the minimum operational window is rejected.
        terms = _terms(3, 3);
        terms.beaconFailureDeadline = terms.revealDeadline + 1;
        _expectInvalidDeadline(terms);

        // A commit window narrower than the minimum operational window is rejected.
        terms = _terms(3, 3);
        terms.commitDeadline = uint64(block.timestamp + 1);
        _expectInvalidDeadline(terms);
    }

    function test_BlockedCreditRecipientsCannotPreventFinalizationOrRaterClaim() public {
        (uint256 roundId, Rater[3] memory raters) = _healthyRound();
        _beginHealthySettlement(roundId);
        panel.processAggregate(roundId, 0, 3);
        _finalizeSeed(roundId, ENTROPY);
        panel.processScores(roundId, 0, 3);
        usdc.setBlockedRecipient(funder, true);
        usdc.setBlockedRecipient(feeRecipient, true);
        panel.finalizeSettlement(roundId);

        uint256 expected = panel.previewPayout(raters[0].commitKey);
        usdc.setTransferShortfall(1);
        vm.expectRevert(TokenlessPanel.TransferAmountMismatch.selector);
        panel.claim(raters[0].commitKey, raters[0].payout, raters[0].salt);
        assertFalse(panel.getCommit(raters[0].commitKey).claimed);
        usdc.setTransferShortfall(0);
        assertEq(panel.claim(raters[0].commitKey, raters[0].payout, raters[0].salt), expected);

        address refundDestination = makeAddr("refundDestination");
        vm.prank(funder);
        panel.withdrawCredit(refundDestination);
        vm.prank(feeRecipient);
        panel.withdrawCredit(makeAddr("feeDestination"));
        assertGt(usdc.balanceOf(refundDestination), 0);
    }

    function _healthyRound() internal returns (uint256 roundId, Rater[3] memory raters) {
        roundId = _createRound(3, 3);
        raters[0] = _rater(0x101, 1, 5_000, "alice", roundId);
        raters[1] = _rater(0x102, 1, 7_000, "bob", roundId);
        raters[2] = _rater(0x103, 0, 9_000, "carol", roundId);
        for (uint256 i = 0; i < raters.length; ++i) {
            _commit(roundId, raters[i]);
        }
    }

    function _beginHealthySettlement(uint256 roundId) internal {
        vm.warp(_round(roundId).commitDeadline + 1);
        for (uint256 i = 0; i < 3; ++i) {
            bytes32 commitKey = panel.roundCommitKey(roundId, i);
            TokenlessPanel.CommitRecord memory record = panel.getCommit(commitKey);
            Rater memory material = _materialFromRecord(roundId, record);
            _reveal(roundId, material);
        }
        vm.warp(_round(roundId).revealDeadline + 1);
        panel.beginSettlement(roundId);
        assertEq(_round(roundId).entropyBlock, block.number + 1);
    }

    function _materialFromRecord(uint256 roundId, TokenlessPanel.CommitRecord memory record)
        internal
        view
        returns (Rater memory material)
    {
        // Test fixtures derive every committed field from the private key labels. Find the matching fixture.
        uint256[3] memory keys = [uint256(0x101), uint256(0x102), uint256(0x103)];
        string[3] memory labels = [string("alice"), string("bob"), string("carol")];
        uint8[3] memory votes = [uint8(1), uint8(1), uint8(0)];
        uint16[3] memory predictions = [uint16(5_000), uint16(7_000), uint16(9_000)];
        for (uint256 i = 0; i < keys.length; ++i) {
            if (vm.addr(keys[i]) == record.voteKey) {
                return _raterView(keys[i], votes[i], predictions[i], labels[i], roundId);
            }
        }
        revert("unknown healthy fixture");
    }

    function _finalizeSeed(uint256 roundId, bytes32 entropy) internal {
        uint256 entropyBlock = _round(roundId).entropyBlock;
        vm.roll(entropyBlock + 1);
        vm.setBlockhash(entropyBlock, entropy);
        panel.finalizeScoringSeed(roundId);
    }

    function _assertEachRoleUsedOnce(Rater[3] memory raters, bytes32[3] memory assignments) internal pure {
        for (uint256 i = 0; i < raters.length; ++i) {
            uint256 count;
            for (uint256 j = 0; j < assignments.length; ++j) {
                if (assignments[j] == raters[i].commitKey) ++count;
            }
            assertEq(count, 1);
        }
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
            attemptReserve: 0,
            attemptCompensation: 0,
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
        _setEconomics(terms);
    }

    function _setEconomics(TokenlessPanel.RoundTerms memory terms) internal pure {
        uint256 maximumSeatPay = terms.bountyAmount / terms.maximumCommits;
        uint256 fixedBase = (maximumSeatPay * 8_000) / 10_000;
        terms.attemptCompensation = fixedBase;
        terms.attemptReserve = fixedBase * terms.maximumCommits;
    }

    function _expectInvalidTerms(TokenlessPanel.RoundTerms memory terms) internal {
        vm.prank(funder);
        vm.expectRevert(TokenlessPanel.InvalidTerms.selector);
        panel.createRound(terms);
    }

    function _expectInvalidDeadline(TokenlessPanel.RoundTerms memory terms) internal {
        vm.prank(funder);
        vm.expectRevert(TokenlessPanel.InvalidDeadline.selector);
        panel.createRound(terms);
    }

    function _rater(uint256 privateKey, uint8 vote, uint16 prediction, string memory label, uint256 roundId)
        internal
        view
        returns (Rater memory)
    {
        return _raterView(privateKey, vote, prediction, label, roundId);
    }

    function _raterView(uint256 privateKey, uint8 vote, uint16 prediction, string memory label, uint256 roundId)
        internal
        view
        returns (Rater memory rater)
    {
        rater.privateKey = privateKey;
        rater.voteKey = vm.addr(privateKey);
        rater.payout = address(uint160(uint256(keccak256(abi.encode(label, "Payout")))));
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
        bytes memory voucherSignature = _sign(ISSUER_PK, panel.voucherDigest(voucher));
        bytes memory voteSignature = _sign(
            rater.privateKey,
            panel.commitDigest(roundId, sealedCommitment, keccak256(sealedPayload), payoutCommitment, rater.nullifier)
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
        bytes memory voucherSignature = _sign(ISSUER_PK, panel.voucherDigest(voucher));
        bytes memory voteSignature = _sign(
            rater.privateKey,
            panel.commitDigest(roundId, sealedCommitment, keccak256(sealedPayload), payoutCommitment, rater.nullifier)
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
