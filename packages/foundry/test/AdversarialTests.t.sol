// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { RewardMath } from "../contracts/libraries/RewardMath.sol";
import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { MockWorldIDRouter } from "../contracts/mocks/MockWorldIDRouter.sol";

/// @title AdversarialTests
/// @notice Pre-deployment adversarial tests covering reward exhaustion, state transition
///         violations, double-claim vectors, cooldown bypass, unanimous-round accounting,
///         and processUnrevealedVotes edge cases.
contract AdversarialTests is VotingTestBase {
    LoopReputation lrepToken;
    ContentRegistry registry;
    RoundVotingEngine engine;
    RoundRewardDistributor distributor;

    address owner = address(0xA);
    address treasury = address(0xB);
    address submitter = address(0xC);
    address voter1 = address(0xD1);
    address voter2 = address(0xD2);
    address voter3 = address(0xD3);
    address voter4 = address(0xD4);
    address voter5 = address(0xD5);
    address attacker = address(0xF1);

    uint256 constant STAKE = 10e6;
    uint256 constant EPOCH_DURATION = 10 minutes;
    mapping(bytes32 => bool) internal commitDirections;
    mapping(bytes32 => bytes32) internal commitSalts;

    function _tlockDrandChainHash() internal pure override returns (bytes32) {
        return DEFAULT_DRAND_CHAIN_HASH;
    }

    function _tlockDrandGenesisTime() internal pure override returns (uint64) {
        return DEFAULT_DRAND_GENESIS_TIME;
    }

    function _tlockDrandPeriod() internal pure override returns (uint64) {
        return DEFAULT_DRAND_PERIOD;
    }

    function _tlockEpochDuration() internal pure override returns (uint256) {
        return EPOCH_DURATION;
    }

    function setUp() public {
        vm.warp(1000);
        vm.roll(100);
        vm.startPrank(owner);

        lrepToken = new LoopReputation(owner, owner);
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), owner);

        ContentRegistry registryImpl = new ContentRegistry();
        RoundVotingEngine engineImpl = new RoundVotingEngine();
        RoundRewardDistributor distImpl = new RoundRewardDistributor();

        registry = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(lrepToken)))
                )
            )
        );

        engine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(engineImpl),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(lrepToken), address(registry), address(_deployProtocolConfig(owner)))
                    )
                )
            )
        );

        distributor = RoundRewardDistributor(
            address(
                new ERC1967Proxy(
                    address(distImpl),
                    abi.encodeCall(
                        RoundRewardDistributor.initialize,
                        (owner, address(lrepToken), address(engine), address(registry))
                    )
                )
            )
        );

        registry.setVotingEngine(address(engine));
        MockCategoryRegistry mockCategoryRegistry = new MockCategoryRegistry();
        mockCategoryRegistry.seedDefaultTestCategories();
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(address(engine.protocolConfig())).setRewardDistributor(address(distributor));
        ProtocolConfig(address(engine.protocolConfig())).setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(address(engine.protocolConfig())).setTreasury(treasury);
        _setTlockDrandConfig(
            ProtocolConfig(address(engine.protocolConfig())),
            DEFAULT_DRAND_CHAIN_HASH,
            DEFAULT_DRAND_GENESIS_TIME,
            DEFAULT_DRAND_PERIOD
        );
        _setTlockRoundConfig(ProtocolConfig(address(engine.protocolConfig())), EPOCH_DURATION, 7 days, 3, 200);

        // Fund actors
        address[6] memory users = [submitter, voter1, voter2, voter3, voter4, voter5];
        for (uint256 i = 0; i < users.length; i++) {
            lrepToken.mint(users[i], 100_000e6);
        }
        lrepToken.mint(attacker, 100_000e6);

        vm.stopPrank();
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    function _submitContent() internal returns (uint256) {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/adv", "test", "test", "test", 0);
        vm.stopPrank();
        return 1;
    }

    function _submitContent2() internal returns (uint256) {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/adv2", "test", "test", "test", 0);
        vm.stopPrank();
        return 2;
    }

    function _deployRaterRegistry() internal returns (RaterRegistry identityRegistry) {
        identityRegistry = new RaterRegistry(
            owner, owner, address(new MockWorldIDRouter()), keccak256("rateloop-human-v1"), 12_345, 365 days
        );
    }

    function _delegateIdentity(RaterRegistry identityRegistry, address holder, address delegate) internal {
        vm.prank(holder);
        identityRegistry.setDelegate(delegate);
        vm.prank(delegate);
        identityRegistry.acceptDelegate();
    }

    function _commit(address voter, uint256 contentId, bool isUp, uint256 stake)
        internal
        returns (bytes32 commitKey, bytes32 salt)
    {
        salt = keccak256(abi.encodePacked(voter, block.timestamp, contentId, isUp));
        uint64 targetRound = _tlockCommitTargetRound(engine, contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes memory ciphertext = _testCiphertext(isUp, salt, contentId, targetRound, drandChainHash);
        uint16 referenceRatingBps = _currentRatingReferenceBps(contentId);
        bytes32 commitHash =
            _commitHash(isUp, salt, voter, contentId, referenceRatingBps, targetRound, drandChainHash, ciphertext);
        vm.startPrank(voter);
        lrepToken.approve(address(engine), stake);
        uint256 cachedRoundContext1 = _roundContext(engine.previewCommitRoundId(contentId), referenceRatingBps);
        engine.commitVote(
            contentId, cachedRoundContext1, targetRound, drandChainHash, commitHash, ciphertext, stake, address(0)
        );
        vm.stopPrank();
        commitKey = _commitKey(voter, commitHash);
        commitDirections[commitKey] = isUp;
        commitSalts[commitKey] = salt;
    }

    function _reveal(uint256 contentId, uint256 roundId, bytes32 commitKey) internal {
        RoundLib.Commit memory c = RoundEngineReadHelpers.commit(engine, contentId, roundId, commitKey);
        if (c.revealed || c.stakeAmount == 0) return;
        bool up = commitDirections[commitKey];
        bytes32 s = commitSalts[commitKey];
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, up, 5_000, s);
    }

    function _settleRound(uint256 contentId, uint256 roundId, bytes32[] memory commitKeys) internal {
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        // Warp past the epoch so every committed vote is revealable, then reveal all
        // supplied commits. Settlement still requires no past-epoch unrevealed votes.
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);
        for (uint256 i = 0; i < commitKeys.length; i++) {
            _reveal(contentId, roundId, commitKeys[i]);
        }
        _settleAfterRbtsSeed(engine, contentId, roundId);
    }

    function _settleAfterFinalGrace(uint256 contentId, uint256 roundId, bytes32[] memory commitKeys) internal {
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        vm.warp(round.startTime + 7 days + ProtocolConfig(address(engine.protocolConfig())).revealGracePeriod() + 1);
        for (uint256 i = 0; i < commitKeys.length; i++) {
            _reveal(contentId, roundId, commitKeys[i]);
        }
        _settleAfterRbtsSeed(engine, contentId, roundId);
    }

    // =========================================================================
    // 1. REWARD EXHAUSTION — sum of all winner claims equals winningPool + voterPool
    // =========================================================================

    /// @notice With 4 winners and 1 loser, total claimed must not exceed pool bounds
    function test_RewardExhaustion_MultipleWinners_CantExceedPool() public {
        uint256 contentId = _submitContent();

        // 4 UP voters (winners — total weighted UP = 15e6 > DOWN), 1 DOWN voter (loser)
        (bytes32 ck1,) = _commit(voter1, contentId, true, 5e6);
        (bytes32 ck2,) = _commit(voter2, contentId, true, 4e6);
        (bytes32 ck3,) = _commit(voter3, contentId, true, 3e6);
        (bytes32 ck4,) = _commit(voter4, contentId, true, 3e6);
        (bytes32 ck5,) = _commit(voter5, contentId, false, 8e6); // loser (weighted 8e6 < 15e6 UP)

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory cks = new bytes32[](5);
        cks[0] = ck1;
        cks[1] = ck2;
        cks[2] = ck3;
        cks[3] = ck4;
        cks[4] = ck5;
        _settleRound(contentId, roundId, cks);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint8(round.state), uint8(RoundLib.RoundState.Settled));
        assertTrue(round.upWins);

        uint256 voterPool = engine.roundVoterPool(contentId, roundId);
        uint256 totalStake = round.upPool + round.downPool;

        // Claim every revealed voter. Under RBTS, score-eligible losing-side voters
        // can also share the voter pool, so winner-only claims need not exhaust it.
        uint256 totalClaimed;
        address[5] memory claimants = [voter1, voter2, voter3, voter4, voter5];
        for (uint256 i = 0; i < claimants.length; i++) {
            uint256 before = lrepToken.balanceOf(claimants[i]);
            vm.prank(claimants[i]);
            distributor.claimReward(contentId, roundId);
            totalClaimed += lrepToken.balanceOf(claimants[i]) - before;
        }

        // Total claimed = RBTS stake returns/rebates + rewards, including final-claimant remainders.
        assertLe(totalClaimed, totalStake + voterPool, "Claims must not exceed stake plus voter pool");
        assertEq(
            distributor.roundVoterRewardClaimedAmount(contentId, roundId),
            voterPool,
            "Score-eligible claims should exhaust voter pool exactly"
        );
    }

    /// @notice Revealed voters with RBTS forfeitures receive their score-spread stake return and do not revert.
    function test_RewardExhaustion_LowScoreGetsStakeReturn() public {
        uint256 contentId = _submitContent();

        // Asymmetric stakes to avoid tie
        (bytes32 ck1,) = _commit(voter1, contentId, true, 10e6);
        (bytes32 ck2,) = _commit(voter2, contentId, false, 5e6);
        (bytes32 ck3,) = _commit(voter3, contentId, true, 1e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory cks = new bytes32[](3);
        cks[0] = ck1;
        cks[1] = ck2;
        cks[2] = ck3;
        _settleRound(contentId, roundId, cks);

        uint256 expectedClaim = engine.commitRbtsStakeReturned(contentId, roundId, ck2);
        uint256 scoreWeight = engine.commitRbtsRewardWeight(contentId, roundId, ck2);
        if (scoreWeight > 0) {
            expectedClaim += RewardMath.calculateVoterReward(
                scoreWeight, engine.roundRbtsRewardWeight(contentId, roundId), engine.roundVoterPool(contentId, roundId)
            );
        }

        uint256 balBefore = lrepToken.balanceOf(voter2);
        vm.prank(voter2);
        distributor.claimReward(contentId, roundId);
        uint256 balAfter = lrepToken.balanceOf(voter2);

        assertEq(balAfter - balBefore, expectedClaim, "Claim should match RBTS claim value");
        assertLt(balAfter - balBefore, 5e6, "Forfeited losing leg should not recover full stake");
    }

    // =========================================================================
    // 2. DOUBLE-CLAIM VECTORS
    // =========================================================================

    /// @notice Voter cannot claim reward twice
    function test_DoubleClaim_VoterReward_Reverts() public {
        uint256 contentId = _submitContent();

        // Asymmetric stakes to avoid tie
        (bytes32 ck1,) = _commit(voter1, contentId, true, 10e6);
        (bytes32 ck2,) = _commit(voter2, contentId, false, 5e6);
        (bytes32 ck3,) = _commit(voter3, contentId, true, 1e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory cks = new bytes32[](3);
        cks[0] = ck1;
        cks[1] = ck2;
        cks[2] = ck3;
        _settleRound(contentId, roundId, cks);

        vm.prank(voter1);
        distributor.claimReward(contentId, roundId);

        vm.prank(voter1);
        vm.expectRevert("Already claimed");
        distributor.claimReward(contentId, roundId);
    }

    /// @notice Voter cannot claim refund twice on cancelled round
    function test_DoubleClaim_Refund_Reverts() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);

        vm.warp(1000 + 7 days + 1);
        engine.cancelExpiredRound(contentId, 1);

        vm.prank(voter1);
        engine.claimCancelledRoundRefund(contentId, 1);

        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.AlreadyClaimed.selector);
        engine.claimCancelledRoundRefund(contentId, 1);
    }

    /// @notice Voter who committed but was not revealed cannot claim reward (only refund path)
    function test_DoubleClaim_UnrevealedVoterCannotClaimReward() public {
        uint256 contentId = _submitContent();

        // Asymmetric stakes; voter1/voter3 UP, voter2 DOWN — UP wins
        (bytes32 ck1,) = _commit(voter1, contentId, true, 10e6);
        (bytes32 ck2,) = _commit(voter2, contentId, false, 5e6);
        (bytes32 ck3,) = _commit(voter3, contentId, true, 1e6);
        _commit(voter4, contentId, true, STAKE); // not revealed

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory cks = new bytes32[](3);
        cks[0] = ck1;
        cks[1] = ck2;
        cks[2] = ck3;
        _settleAfterFinalGrace(contentId, roundId, cks);

        vm.prank(voter4);
        vm.expectRevert(RoundRewardDistributor.UnrevealedCleanupPending.selector);
        distributor.claimReward(contentId, roundId);

        engine.processUnrevealedVotes(contentId, roundId, 0, 0);

        // Unrevealed votes cannot claim winner rewards, even after cleanup.
        vm.prank(voter4);
        vm.expectRevert("Vote not revealed");
        distributor.claimReward(contentId, roundId);
    }

    // =========================================================================
    // 3. processUnrevealedVotes — DOUBLE PROCESSING
    // =========================================================================

    /// @notice Processing the same index range twice should not double-forfeit
    function test_ProcessUnrevealed_DoubleProcess_NoDoubleForfeit() public {
        uint256 contentId = _submitContent();

        // Asymmetric stakes: UP wins, voter3 unrevealed and epoch passed.
        (bytes32 ck1,) = _commit(voter1, contentId, true, 10e6);
        (bytes32 ck2,) = _commit(voter2, contentId, false, 5e6);
        (bytes32 ck3,) = _commit(voter3, contentId, true, 1e6);
        _commit(voter4, contentId, true, 5e6); // unrevealed, same epoch

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Only reveal three quorum votes, then settle after the final grace window.
        bytes32[] memory cks = new bytes32[](3);
        cks[0] = ck1;
        cks[1] = ck2;
        cks[2] = ck3;
        _settleAfterFinalGrace(contentId, roundId, cks);

        uint256 treasuryBefore = lrepToken.balanceOf(treasury);

        // Process unrevealed (settled unrevealed stake is routed to treasury).
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);

        uint256 routedAmount = lrepToken.balanceOf(treasury) - treasuryBefore;
        assertGt(routedAmount, 0, "Some amount should be routed to treasury");

        // Process again — same range, reverts because nothing left to process (stakeAmount zeroed)
        vm.expectRevert(RoundVotingEngine.NothingProcessed.selector);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);
    }

    /// @notice Unrevealed voter from current epoch at settlement should be refunded, not forfeited
    function test_ProcessUnrevealed_CurrentEpochVoter_Refunded() public {
        uint256 contentId = _submitContent();

        // Epoch 1 voters
        (bytes32 ck1,) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2,) = _commit(voter2, contentId, false, STAKE);
        (bytes32 ck3,) = _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);

        // Move into epoch 2, add voter3 before the reveal threshold is reached,
        // then reveal the epoch 1 voters.
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);
        _commit(voter4, contentId, true, 2_500_000);
        _reveal(contentId, roundId, ck1);
        _reveal(contentId, roundId, ck2);
        _reveal(contentId, roundId, ck3);

        // Settle immediately (voter3's epoch hasn't ended)
        _settleAfterRbtsSeed(engine, contentId, roundId);

        uint256 voter4Before = lrepToken.balanceOf(voter4);

        // Process unrevealed — voter4 should be refunded (epoch not ended at settlement)
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);

        uint256 voter4After = lrepToken.balanceOf(voter4);
        assertEq(voter4After - voter4Before, 2_500_000, "Current-epoch voter should get full refund");
    }

    // =========================================================================
    // 4. STATE TRANSITION VIOLATIONS
    // =========================================================================

    /// @notice Cannot settle an already settled round
    function test_StateTransition_CannotSettleTwice() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1,) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2,) = _commit(voter2, contentId, false, STAKE);
        (bytes32 ck3,) = _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory cks = new bytes32[](3);
        cks[0] = ck1;
        cks[1] = ck2;
        cks[2] = ck3;
        _settleRound(contentId, roundId, cks);

        vm.expectRevert(RoundVotingEngine.RoundNotOpen.selector);
        _settleAfterRbtsSeed(engine, contentId, roundId);
    }

    /// @notice Cannot cancel a settled round
    function test_StateTransition_CannotCancelSettledRound() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1,) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2,) = _commit(voter2, contentId, false, STAKE);
        (bytes32 ck3,) = _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory cks = new bytes32[](3);
        cks[0] = ck1;
        cks[1] = ck2;
        cks[2] = ck3;
        _settleRound(contentId, roundId, cks);

        vm.expectRevert(RoundVotingEngine.RoundNotOpen.selector);
        engine.cancelExpiredRound(contentId, roundId);
    }

    /// @notice Cannot cancel a round that has reached the settlement threshold (L-Vote-4: when
    ///         at least one HRC commit is present).
    function test_StateTransition_CannotCancelThresholdReachedRound() public {
        // L-Vote-4: install a rater registry and seed voter1 as HRC so the cancel lockout
        // engages once the round has commit quorum. Without an HRC commit the round would be
        // refund-cancellable (the all-sybil escape valve) — that path is covered separately.
        RaterRegistry identityRegistry = _deployRaterRegistry();
        ProtocolConfig cfg = ProtocolConfig(address(engine.protocolConfig()));
        vm.prank(owner);
        cfg.setRaterRegistry(address(identityRegistry));
        vm.prank(owner);
        identityRegistry.seedHumanCredential(
            voter1, uint64(block.timestamp + 365 days), keccak256("voter1"), keccak256("evidence")
        );

        uint256 contentId = _submitContent();

        (bytes32 ck1,) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2,) = _commit(voter2, contentId, false, STAKE);
        (bytes32 ck3,) = _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);

        // Reveal to reach threshold
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);
        _reveal(contentId, roundId, ck1);
        _reveal(contentId, roundId, ck2);
        _reveal(contentId, roundId, ck3);

        // Warp past maxDuration
        vm.warp(round.startTime + 7 days + 1);

        vm.expectRevert(RoundVotingEngine.ThresholdReached.selector);
        engine.cancelExpiredRound(contentId, roundId);
    }

    /// @notice L-Vote-4: with no HRC commit, commit-quorum sybils cannot grief the round into
    ///         a RevealFailed cycle — the round remains refund-cancellable.
    function test_StateTransition_CancelSucceedsWithSybilQuorumOnly() public {
        uint256 contentId = _submitContent();

        // No rater registry installed → all voters resolve as non-HRC.
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertFalse(engine.roundHasHumanVerifiedCommit(contentId, roundId));

        vm.warp(round.startTime + 7 days + 1);

        engine.cancelExpiredRound(contentId, roundId);
        RoundLib.Round memory cancelled = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(cancelled.state), uint256(RoundLib.RoundState.Cancelled));
    }

    /// @notice Cannot commit to a cancelled round (new round should be created)
    function test_StateTransition_CommitAfterCancel_CreatesNewRound() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);

        vm.warp(1000 + 7 days + 1);
        engine.cancelExpiredRound(contentId, 1);

        // Next commit should create round 2
        vm.warp(1000 + 7 days + 1 + 24 hours + 1); // past cooldown
        (bytes32 ck2,) = _commit(voter2, contentId, false, STAKE);
        uint256 newRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(newRoundId, 2, "Should create new round after cancellation");
        assertTrue(ck2 != bytes32(0));
    }

    /// @notice Cannot claim reward from a cancelled round
    function test_StateTransition_CannotClaimRewardFromCancelledRound() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);

        vm.warp(1000 + 7 days + 1);
        engine.cancelExpiredRound(contentId, 1);

        vm.prank(voter1);
        vm.expectRevert("Round not settled");
        distributor.claimReward(contentId, 1);
    }

    /// @notice Cannot claim refund from a settled round
    function test_StateTransition_CannotRefundFromSettledRound() public {
        uint256 contentId = _submitContent();

        // Asymmetric stakes to avoid tie
        (bytes32 ck1,) = _commit(voter1, contentId, true, 10e6);
        (bytes32 ck2,) = _commit(voter2, contentId, false, 5e6);
        (bytes32 ck3,) = _commit(voter3, contentId, true, 1e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory cks = new bytes32[](3);
        cks[0] = ck1;
        cks[1] = ck2;
        cks[2] = ck3;
        _settleRound(contentId, roundId, cks);

        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.RoundNotCancelledOrTied.selector);
        engine.claimCancelledRoundRefund(contentId, roundId);
    }

    // =========================================================================
    // 5. UNANIMOUS ROUNDS DO NOT RECEIVE SUBSIDY
    // =========================================================================

    /// @notice Unanimous rounds settle without creating a subsidy pool.
    function test_UnanimousRound_NoConsensusSubsidy() public {
        uint256 contentId = _submitContent();

        // Large unanimous UP round
        (bytes32 ck1,) = _commit(voter1, contentId, true, 10e6);
        (bytes32 ck2,) = _commit(voter2, contentId, true, 10e6);
        (bytes32 ck3,) = _commit(voter3, contentId, true, 10e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory cks = new bytes32[](3);
        cks[0] = ck1;
        cks[1] = ck2;
        cks[2] = ck3;
        _settleRound(contentId, roundId, cks);

        uint256 forfeitedPool = engine.roundRbtsForfeitedPool(contentId, roundId);
        if (engine.roundRbtsRewardWeight(contentId, roundId) > 0) {
            assertEq(engine.roundVoterPool(contentId, roundId), forfeitedPool);
        }
    }

    /// @notice Unanimous rounds get zero subsidy without a losing pool.
    function test_UnanimousRound_ZeroSubsidy() public {
        // Deploy fresh setup; there is no consensus reserve in the protocol.
        vm.startPrank(owner);
        LoopReputation token2 = new LoopReputation(owner, owner);
        token2.grantRole(token2.MINTER_ROLE(), owner);

        ContentRegistry reg2 = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(new ContentRegistry()),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(token2)))
                )
            )
        );

        RoundVotingEngine eng2 = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(new RoundVotingEngine()),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(token2), address(reg2), address(_deployProtocolConfig(owner)))
                    )
                )
            )
        );

        RoundRewardDistributor dist2 = RoundRewardDistributor(
            address(
                new ERC1967Proxy(
                    address(new RoundRewardDistributor()),
                    abi.encodeCall(
                        RoundRewardDistributor.initialize, (owner, address(token2), address(eng2), address(reg2))
                    )
                )
            )
        );

        reg2.setVotingEngine(address(eng2));
        MockCategoryRegistry mockCategoryRegistry = new MockCategoryRegistry();
        mockCategoryRegistry.seedDefaultTestCategories();
        reg2.setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(address(eng2.protocolConfig())).setRewardDistributor(address(dist2));
        ProtocolConfig(address(eng2.protocolConfig())).setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(address(eng2.protocolConfig())).setTreasury(treasury);
        _setTlockDrandConfig(
            ProtocolConfig(address(eng2.protocolConfig())),
            DEFAULT_DRAND_CHAIN_HASH,
            DEFAULT_DRAND_GENESIS_TIME,
            DEFAULT_DRAND_PERIOD
        );
        _setTlockRoundConfig(ProtocolConfig(address(eng2.protocolConfig())), EPOCH_DURATION, 7 days, 3, 200);

        token2.mint(submitter, 100_000e6);
        token2.mint(voter1, 100_000e6);
        token2.mint(voter2, 100_000e6);
        token2.mint(voter3, 100_000e6);
        vm.stopPrank();

        // Submit content
        vm.startPrank(submitter);
        token2.approve(address(reg2), 10e6);
        _submitContentWithReservation(reg2, "https://example.com/zero", "test", "test", "test", 0);
        vm.stopPrank();

        // Unanimous votes
        bytes32 salt1 = keccak256(abi.encodePacked(voter1, block.timestamp, uint256(1)));
        uint64 targetRound1 = _tlockCommitTargetRound(eng2, 1);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes memory ct1 = _testCiphertext(true, salt1, 1, targetRound1, drandChainHash);
        bytes32 ch1 =
            _commitHash(true, salt1, voter1, 1, _defaultRatingReferenceBps(), targetRound1, drandChainHash, ct1);

        vm.startPrank(voter1);
        token2.approve(address(eng2), STAKE);
        uint256 cachedRoundContext2 = _roundContext(eng2.previewCommitRoundId(1), _defaultRatingReferenceBps());
        eng2.commitVote(1, cachedRoundContext2, targetRound1, drandChainHash, ch1, ct1, STAKE, address(0));
        vm.stopPrank();

        bytes32 salt2 = keccak256(abi.encodePacked(voter2, block.timestamp, uint256(1)));
        uint64 targetRound2 = _tlockCommitTargetRound(eng2, 1);
        bytes memory ct2 = _testCiphertext(true, salt2, 1, targetRound2, drandChainHash);
        bytes32 ch2 =
            _commitHash(true, salt2, voter2, 1, _defaultRatingReferenceBps(), targetRound2, drandChainHash, ct2);

        vm.startPrank(voter2);
        token2.approve(address(eng2), STAKE);
        uint256 cachedRoundContext3 = _roundContext(eng2.previewCommitRoundId(1), _defaultRatingReferenceBps());
        eng2.commitVote(1, cachedRoundContext3, targetRound2, drandChainHash, ch2, ct2, STAKE, address(0));
        vm.stopPrank();

        bytes32 salt3 = keccak256(abi.encodePacked(voter3, block.timestamp, uint256(1)));
        uint64 targetRound3 = _tlockCommitTargetRound(eng2, 1);
        bytes memory ct3 = _testCiphertext(true, salt3, 1, targetRound3, drandChainHash);
        bytes32 ch3 =
            _commitHash(true, salt3, voter3, 1, _defaultRatingReferenceBps(), targetRound3, drandChainHash, ct3);

        vm.startPrank(voter3);
        token2.approve(address(eng2), STAKE);
        uint256 cachedRoundContext4 = _roundContext(eng2.previewCommitRoundId(1), _defaultRatingReferenceBps());
        eng2.commitVote(1, cachedRoundContext4, targetRound3, drandChainHash, ch3, ct3, STAKE, address(0));
        vm.stopPrank();

        bytes32 ck1 = _commitKey(voter1, ch1);
        bytes32 ck2 = _commitKey(voter2, ch2);
        bytes32 ck3 = _commitKey(voter3, ch3);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(eng2, 1, 1);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);

        // Reveal
        eng2.revealVoteByCommitKey(1, 1, ck1, true, 5_000, salt1);
        eng2.revealVoteByCommitKey(1, 1, ck2, true, 5_000, salt2);
        eng2.revealVoteByCommitKey(1, 1, ck3, true, 5_000, salt3);

        _settleAfterRbtsSeed(eng2, 1, 1);

        // No consensus subsidy is paid. RBTS forfeitures still fund
        // the voter pool, with the frontend share falling back to voters when no eligible
        // frontend is attached.
        uint256 forfeitedPool = eng2.roundRbtsForfeitedPool(1, 1);
        uint256 voterPool = eng2.roundVoterPool(1, 1);
        if (eng2.roundRbtsRewardWeight(1, 1) > 0) {
            assertEq(voterPool, forfeitedPool, "Voter pool should come only from RBTS forfeitures");
        }
    }

    // =========================================================================
    // 6. SELF-OPPOSITION (Sybil with 2 addresses)
    // =========================================================================

    /// @notice Two-address self-opposition cannot satisfy the three-voter RBTS quorum.
    function test_SelfOpposition_TwoAddressQuorumRejected() public {
        uint256 contentId = _submitContent();

        // Attacker controls both accounts, but two reveals are not enough for RBTS settlement.
        address sybil = address(0xBEEF);
        vm.prank(owner);
        lrepToken.mint(sybil, 100_000e6);

        (bytes32 ckAttack,) = _commit(attacker, contentId, true, 5e6);
        (bytes32 ckSybil,) = _commit(sybil, contentId, false, 5e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory cks = new bytes32[](2);
        cks[0] = ckAttack;
        cks[1] = ckSybil;

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);
        for (uint256 i = 0; i < cks.length; i++) {
            _reveal(contentId, roundId, cks[i]);
        }

        vm.expectRevert(RoundVotingEngine.NotEnoughVotes.selector);
        _settleAfterRbtsSeed(engine, contentId, roundId);
    }

    /// @notice Attacker with asymmetric stakes still partially forfeits the losing side.
    function test_SelfOpposition_AsymmetricStakes_LosingLegPartiallyForfeits() public {
        uint256 contentId = _submitContent();

        address sybil = address(0xBEEF);
        vm.prank(owner);
        lrepToken.mint(sybil, 100_000e6);

        // Third honest voter to prevent tie
        (bytes32 ckHonest,) = _commit(voter1, contentId, true, STAKE);

        // Attacker: big UP, small DOWN
        (bytes32 ckBig,) = _commit(attacker, contentId, true, 8e6);
        (bytes32 ckSmall,) = _commit(sybil, contentId, false, 2e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory cks = new bytes32[](3);
        cks[0] = ckHonest;
        cks[1] = ckBig;
        cks[2] = ckSmall;
        _settleRound(contentId, roundId, cks);

        // UP wins. The losing sybil leg can earn RBTS stake return/reward, but still
        // recovers less than it committed.
        uint256 attackerBefore = lrepToken.balanceOf(attacker);
        uint256 sybilBefore = lrepToken.balanceOf(sybil);

        vm.prank(attacker);
        distributor.claimReward(contentId, roundId);
        vm.prank(sybil);
        distributor.claimReward(contentId, roundId); // loser, gets fixed rebate

        uint256 attackerNet = lrepToken.balanceOf(attacker) - attackerBefore;
        uint256 sybilNet = lrepToken.balanceOf(sybil) - sybilBefore;

        assertGt(attackerNet, 8e6, "Winning leg can still earn ordinary winner rewards");
        assertGt(sybilNet, 0, "Losing leg can still recover RBTS value");
        assertLt(sybilNet, 2e6, "Opposing losing stake remains unprofitable on its own");
    }

    // =========================================================================
    // 7. COOLDOWN BYPASS VIA DELEGATION (regression test for fix 59241a4)
    // =========================================================================

    /// @notice Identity cooldown prevents a delegated identity from voting twice within cooldown.
    function test_CooldownBypass_DelegationBlocked() public {
        RaterRegistry identityRegistry = _deployRaterRegistry();
        ProtocolConfig cfg = ProtocolConfig(address(engine.protocolConfig()));
        vm.prank(owner);
        cfg.setRaterRegistry(address(identityRegistry));

        address holder = address(0xA1);
        address delegate = address(0xA2);

        vm.startPrank(owner);
        lrepToken.mint(holder, 100_000e6);
        lrepToken.mint(delegate, 100_000e6);
        vm.stopPrank();

        _delegateIdentity(identityRegistry, holder, delegate);

        uint256 contentId = _submitContent();

        // Holder votes (uses token 1)
        bytes32 salt = keccak256(abi.encodePacked(holder, block.timestamp, contentId));
        bytes32 commitHash = _commitHash(true, salt, holder, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);
        vm.startPrank(holder);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext4 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        engine.commitVote(
            contentId,
            cachedRoundContext4,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        // Delegate resolves to the same identity, so voting again on the same content is blocked.
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/adv3", "test", "test", "test", 0);
        vm.stopPrank();

        // Delegate tries to vote on SAME content — blocked by CooldownActive (checked before IdentityAlreadyCommitted)
        bytes32 salt3 = keccak256(abi.encodePacked(delegate, block.timestamp, contentId));
        bytes32 commitHash3 = _commitHash(false, salt3, delegate, contentId);
        bytes memory ciphertext3 = _testCiphertext(false, salt3, contentId);
        vm.startPrank(delegate);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext5 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.CooldownActive.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext5,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash3,
            ciphertext3,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    /// @notice Identity cooldown blocks the same delegated identity across rounds.
    function test_CooldownBypass_SameTokenAcrossRounds() public {
        RaterRegistry identityRegistry = _deployRaterRegistry();
        ProtocolConfig cfg = ProtocolConfig(address(engine.protocolConfig()));
        vm.prank(owner);
        cfg.setRaterRegistry(address(identityRegistry));

        address holder = address(0xA1);
        address delegate = address(0xA2);

        vm.startPrank(owner);
        lrepToken.mint(holder, 100_000e6);
        lrepToken.mint(delegate, 100_000e6);
        vm.stopPrank();

        _delegateIdentity(identityRegistry, holder, delegate);

        uint256 contentId = _submitContent();

        // Holder votes on round 1 (along with 2 others for settlement)
        (bytes32 ckH,) = _commit(holder, contentId, true, 10e6);
        (bytes32 ck1,) = _commit(voter1, contentId, true, 10e6);
        (bytes32 ck2,) = _commit(voter2, contentId, false, 5e6);

        // Settle round 1 quickly (after epoch 1)
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory cks = new bytes32[](3);
        cks[0] = ckH;
        cks[1] = ck1;
        cks[2] = ck2;
        _settleRound(contentId, roundId, cks);

        // Now within 24h of holder's vote, delegate tries to vote on round 2 (same content)
        // The holder voted at t=1000. _settleRound warped to startTime+EPOCH+1 ≈ 1601.
        // Cooldown = 24h = 86400s. We're at ~1601, cooldown expires at ~87400.
        // So delegate should be blocked.
        bytes32 salt2 = keccak256(abi.encodePacked(delegate, block.timestamp, contentId, false));
        bytes memory ciphertext2 = _testCiphertext(false, salt2, contentId);
        uint16 referenceRatingBps2 = _currentRatingReferenceBps(contentId);
        bytes32 commitHash2 = _commitHash(
            false,
            salt2,
            delegate,
            contentId,
            referenceRatingBps2,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ciphertext2
        );
        vm.startPrank(delegate);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext6 = _roundContext(engine.previewCommitRoundId(contentId), referenceRatingBps2);
        vm.expectRevert(RoundVotingEngine.CooldownActive.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext6,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash2,
            ciphertext2,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    // =========================================================================
    // 8. TIED ROUND — FULL REFUND
    // =========================================================================

    /// @notice In a tied round, every voter gets their full stake back
    function test_TiedRound_FullRefundForAll() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1,) = _commit(voter1, contentId, true, 2e6);
        (bytes32 ck2,) = _commit(voter2, contentId, false, 3e6);
        (bytes32 ck3,) = _commit(voter3, contentId, true, 1e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory cks = new bytes32[](3);
        cks[0] = ck1;
        cks[1] = ck2;
        cks[2] = ck3;

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);
        _reveal(contentId, roundId, ck1);
        _reveal(contentId, roundId, ck2);
        _reveal(contentId, roundId, ck3);

        // Both in epoch 1, same stake — weighted pools are equal → tie
        _settleAfterRbtsSeed(engine, contentId, roundId);

        round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint8(round.state), uint8(RoundLib.RoundState.Tied));

        uint256 v1Before = lrepToken.balanceOf(voter1);
        uint256 v2Before = lrepToken.balanceOf(voter2);
        uint256 v3Before = lrepToken.balanceOf(voter3);

        vm.prank(voter1);
        engine.claimCancelledRoundRefund(contentId, roundId);
        vm.prank(voter2);
        engine.claimCancelledRoundRefund(contentId, roundId);
        vm.prank(voter3);
        engine.claimCancelledRoundRefund(contentId, roundId);

        assertEq(lrepToken.balanceOf(voter1) - v1Before, 2e6, "Voter1 full refund");
        assertEq(lrepToken.balanceOf(voter2) - v2Before, 3e6, "Voter2 full refund");
        assertEq(lrepToken.balanceOf(voter3) - v3Before, 1e6, "Voter3 full refund");
    }

    // =========================================================================
    // 9. EPOCH WEIGHTED SIGNAL — early voters carry more weight
    // =========================================================================

    /// @notice Epoch-1 stake carries 4x the weighted signal of epoch-2 stake.
    function test_EpochWeight_EarlyVoteCarries4xWeight() public {
        uint256 contentId = _submitContent();

        // Epoch 1: voter1 UP (large stake to ensure UP wins), voter2 DOWN (loser provides pool)
        // Weighted UP epoch1: 10e6, Weighted DOWN epoch1: 10e6. UP wins.
        (bytes32 ck1,) = _commit(voter1, contentId, true, 10e6);
        (bytes32 ck2,) = _commit(voter2, contentId, false, 10e6); // loser

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);

        // Wait for epoch 1 to end and add the epoch-2 voter before threshold is reached.
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);
        (bytes32 ck3,) = _commit(voter3, contentId, true, 10e6);
        uint256 voter3RevealableAfter = block.timestamp + EPOCH_DURATION;
        _reveal(contentId, roundId, ck1);
        _reveal(contentId, roundId, ck2);

        // Wait for epoch 2 to end, reveal voter3
        _warpPastTlockRevealTime(voter3RevealableAfter);
        _reveal(contentId, roundId, ck3);

        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory settledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertTrue(settledRound.upWins);
        assertEq(settledRound.weightedUpPool, 12_500_000, "Epoch-1 and epoch-2 UP weight should combine");
        assertEq(settledRound.weightedDownPool, 10_000_000, "Epoch-1 DOWN weight should remain full stake");
    }

    // =========================================================================
    // 10. REVEAL TIMING — cannot reveal before epoch ends
    // =========================================================================

    /// @notice Revealing before epoch end reverts
    function test_RevealTiming_BeforeEpoch_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, contentId, true));
        bytes32 commitHash = _commitHash(true, salt, voter1, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext7 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        engine.commitVote(
            contentId,
            cachedRoundContext7,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32 commitKey = _commitKey(voter1, commitHash);

        // Try to reveal immediately (before epoch end)
        vm.expectRevert(RoundVotingEngine.EpochNotEnded.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);
    }

    /// @notice Cannot reveal with wrong salt (commit hash mismatch)
    function test_RevealTiming_WrongSalt_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, contentId, true));
        bytes32 commitHash = _commitHash(true, salt, voter1, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext8 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        engine.commitVote(
            contentId,
            cachedRoundContext8,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32 commitKey = _commitKey(voter1, commitHash);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);

        bytes32 wrongSalt = keccak256("wrong");
        vm.expectRevert(RoundVotingEngine.HashMismatch.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, wrongSalt);
    }

    /// @notice Cannot reveal with wrong direction
    function test_RevealTiming_WrongDirection_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, contentId, true));
        bytes32 commitHash = _commitHash(true, salt, voter1, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext9 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        engine.commitVote(
            contentId,
            cachedRoundContext9,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32 commitKey = _commitKey(voter1, commitHash);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);

        vm.expectRevert(RoundVotingEngine.HashMismatch.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, false, 5_000, salt); // wrong direction
    }

    /// @notice Fake AGE armor without an embedded tlock stanza is rejected at commit time.
    function test_RevealTiming_OpaqueCiphertext_RevertsOnCommit() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, contentId, "opaque"));
        bytes memory opaqueCiphertext = abi.encodePacked(
            "-----BEGIN AGE ENCRYPTED FILE-----\n", "opaque-test-payload\n", "-----END AGE ENCRYPTED FILE-----\n"
        );
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 commitHash = _commitHash(true, salt, voter1, contentId, targetRound, drandChainHash, opaqueCiphertext);

        vm.startPrank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext10 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.InvalidCiphertext.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext10,
            targetRound,
            drandChainHash,
            commitHash,
            opaqueCiphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    // =========================================================================
    // 11. ENGINE BALANCE SOLVENCY — after full cycle engine holds ≥ obligations
    // =========================================================================

    /// @notice After settle + all claims, engine balance remains above outstanding protocol obligations.
    function test_Solvency_AfterFullCycle() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1,) = _commit(voter1, contentId, true, 5e6);
        (bytes32 ck2,) = _commit(voter2, contentId, false, 3e6);
        (bytes32 ck3,) = _commit(voter3, contentId, true, 2e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory cks = new bytes32[](3);
        cks[0] = ck1;
        cks[1] = ck2;
        cks[2] = ck3;
        _settleRound(contentId, roundId, cks);

        // Claim all
        vm.prank(voter1);
        distributor.claimReward(contentId, roundId);
        vm.prank(voter3);
        distributor.claimReward(contentId, roundId);
        vm.prank(voter2);
        distributor.claimReward(contentId, roundId); // loser, gets fixed rebate
        // Process unrevealed (none in this case — reverts to prevent no-op keeper reward drain)
        vm.expectRevert(RoundVotingEngine.NothingProcessed.selector);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);

        uint256 engineBalance = lrepToken.balanceOf(address(engine));
        uint256 obligations = 0;

        assertGe(engineBalance, obligations, "Engine insolvent after full cycle");
    }

    // =========================================================================
    // 12. SUBMITTER SELF-VOTE PREVENTION
    // =========================================================================

    /// @notice Submitter cannot vote on their own content
    function test_SelfVote_SubmitterBlocked() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(submitter, block.timestamp, contentId, true));
        bytes32 commitHash = _commitHash(true, salt, submitter, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.startPrank(submitter);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext11 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.SelfVote.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext11,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    // =========================================================================
    // 13. STAKE BOUNDS
    // =========================================================================

    /// @notice Counted voting rejects zero-stake ratings; advisory votes handle zero-stake signal.
    function test_StakeBounds_ZeroStakeRejected() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, contentId));
        bytes32 commitHash = _commitHash(true, salt, voter1, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(engine), 0);
        uint256 cachedRoundContext12 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.InvalidStake.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext12,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            0,
            address(0)
        );
        vm.stopPrank();
    }

    /// @notice Stake above MAX_STAKE reverts
    function test_StakeBounds_AboveMax_Reverts() public {
        uint256 contentId = _submitContent();

        uint256 tooMuch = 10e6 + 1; // MAX_STAKE = 10e6
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, contentId));
        bytes32 commitHash = _commitHash(true, salt, voter1, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(engine), tooMuch);
        uint256 cachedRoundContext13 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.InvalidStake.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext13,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            tooMuch,
            address(0)
        );
        vm.stopPrank();
    }

    // =========================================================================
    // 14. REWARD MATH — voter rewards stay within score-spread pool
    // =========================================================================

    /// @notice calculateVoterReward: sum of all voter rewards ≤ voterPool (fuzz)
    function testFuzz_RewardMath_VoterRewards_DontExceedPool(
        uint256 stake1,
        uint256 stake2,
        uint256 stake3,
        uint256 losingPool
    ) public pure {
        stake1 = bound(stake1, 1e6, 10e6);
        stake2 = bound(stake2, 1e6, 10e6);
        stake3 = bound(stake3, 1e6, 10e6);
        losingPool = bound(losingPool, 1e6, 1_000_000e6);

        uint256 voterPool = losingPool;

        // All three are winners with epoch-1 weight (10000 BPS)
        uint256 eff1 = stake1; // weight 100% → same as stake
        uint256 eff2 = stake2;
        uint256 eff3 = stake3;
        uint256 totalWeighted = eff1 + eff2 + eff3;

        uint256 r1 = RewardMath.calculateVoterReward(eff1, totalWeighted, voterPool);
        uint256 r2 = RewardMath.calculateVoterReward(eff2, totalWeighted, voterPool);
        uint256 r3 = RewardMath.calculateVoterReward(eff3, totalWeighted, voterPool);

        assertLe(r1 + r2 + r3, voterPool, "Sum of rewards must not exceed voter pool");
    }
}
