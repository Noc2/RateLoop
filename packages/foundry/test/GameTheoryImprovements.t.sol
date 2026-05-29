// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";

/// @title Game-Theory Improvement Tests (tlock commit-reveal, epoch-weighted rewards)
/// @notice Integration tests verifying the tlock commit-reveal flow with epoch weighting:
///         1. Epoch-1 (blind) = 100% weight (10000 BPS), epoch-2+ (informed) = 25% weight (2500 BPS)
///         2. minVoters = 3 required for settlement
///         3. Expired rounds cancelled after maxDuration without enough voters
///         4. Unanimous rounds receive only forfeiture-derived rewards, not a reserve subsidy
contract GameTheoryImprovementsTest is VotingTestBase {
    LoopReputation lrepToken;
    ContentRegistry registry;
    RoundVotingEngine engine;
    RoundRewardDistributor distributor;

    address owner = address(1);
    address submitter = address(2);
    address treasuryAddr = address(3);
    address alice = address(10);
    address bob = address(11);
    address carol = address(12);
    address dave = address(13);

    // epochDuration = 1 hour (default, matching contract default)
    uint256 constant EPOCH_DURATION = 1 hours;
    // maxDuration = 7 days (default)
    uint256 constant MAX_DURATION = 7 days;
    // minVoters = 3 (new default after tlock redesign)
    uint256 constant MIN_VOTERS = 3;

    uint256 contentNonce;

    function setUp() public {
        vm.warp(10_000); // predictable start time
        vm.startPrank(owner);

        lrepToken = new LoopReputation(owner, owner);
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), owner);

        ContentRegistry regImpl = new ContentRegistry();
        RoundVotingEngine engImpl = new RoundVotingEngine();
        RoundRewardDistributor distImpl = new RoundRewardDistributor();

        registry = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(regImpl),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(lrepToken)))
                )
            )
        );

        // Initialize engine; Foundry helpers below use test-only payload bytes.
        engine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(engImpl),
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
        registry.setTreasury(treasuryAddr);
        ProtocolConfig(address(engine.protocolConfig())).setRewardDistributor(address(distributor));
        ProtocolConfig(address(engine.protocolConfig())).setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(address(engine.protocolConfig())).setTreasury(treasuryAddr);

        // Override config: 1-hour epochs, 7-day max, minVoters=3, maxVoters=100
        _setTlockRoundConfig(
            ProtocolConfig(address(engine.protocolConfig())), EPOCH_DURATION, MAX_DURATION, MIN_VOTERS, 100
        );

        // Fund submitter and voters
        lrepToken.mint(submitter, 100_000e6);
        lrepToken.mint(alice, 100_000e6);
        lrepToken.mint(bob, 100_000e6);
        lrepToken.mint(carol, 100_000e6);
        lrepToken.mint(dave, 100_000e6);

        vm.stopPrank();
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    /// @dev Submit a new content item with a unique URL to avoid duplicate-URL conflicts.
    function _submit() internal returns (uint256) {
        contentNonce++;
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        uint256 id = _submitContentWithReservation(
            registry, string(abi.encodePacked("https://t.co/gt", vm.toString(contentNonce))), "Goal", "Goal", "tag", 0
        );
        vm.stopPrank();
        return id;
    }

    function _setRoundMinVoters(uint16 minVoters) internal {
        ProtocolConfig protocolConfig = ProtocolConfig(address(engine.protocolConfig()));
        vm.startPrank(owner);
        _setTlockRoundConfig(protocolConfig, EPOCH_DURATION, MAX_DURATION, minVoters, 100);
        vm.stopPrank();
    }

    /// @dev Commit a vote for a voter in the current round. Approves and calls commitVote.
    function _commit(address voter, uint256 contentId, bool isUp, uint256 stake) internal {
        bytes32 salt = bytes32(uint256(uint160(voter)) ^ uint256(contentId));
        uint64 targetRound = _tlockCommitTargetRound(engine, contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes memory ct = _testCiphertext(isUp, salt, contentId, targetRound, drandChainHash);
        bytes32 ch =
            _commitHash(isUp, salt, voter, contentId, _defaultRatingReferenceBps(), targetRound, drandChainHash, ct);

        _openRoundForTest(engine, contentId, voter);
        vm.startPrank(voter);
        lrepToken.approve(address(engine), stake);
        uint256 cachedRoundContext1 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        engine.commitVote(contentId, cachedRoundContext1, targetRound, drandChainHash, ch, ct, stake, address(0));
        vm.stopPrank();
    }

    /// @dev Reveal a previously committed vote. Caller must warp past revealableAfter first.
    function _reveal(address voter, uint256 contentId, uint256 roundId, bool isUp) internal {
        bytes32 salt = bytes32(uint256(uint160(voter)) ^ uint256(contentId));
        bytes32 ch = engine.voterCommitHash(contentId, roundId, voter);
        bytes32 ck = _commitKey(voter, ch);

        vm.prank(voter);
        engine.revealVoteByCommitKey(contentId, roundId, ck, isUp, 5_000, salt);
        if (engine.roundThresholdReachedBlock(contentId, roundId) == block.number) {
            vm.roll(block.number + 1);
        }
    }

    /// @dev Settle the round. Caller must ensure minVoters have been revealed.
    function _settle(uint256 contentId, uint256 roundId) internal {
        _settleAfterRbtsSeed(engine, contentId, roundId);
    }

    // =========================================================================
    // TEST 1: EpochWeightWinCondition
    // =========================================================================

    /// @notice DOWN wins despite raw UP majority (30 vs 10) because epoch weighting
    ///         gives epoch-1 votes 100% weight and epoch-2+ votes only 25% weight.
    ///
    ///   Alice: DOWN, 10 LREP, epoch-1 -> effectiveStake = 10 LREP (weight = 10000 BPS)
    ///   Bob, Carol, Dave: UP, 10 LREP each, epoch-2 -> effectiveStake = 2.5 LREP each
    ///
    ///   weightedDownPool = 10, weightedUpPool = 7.5 -> DOWN wins.
    function test_EpochWeightWinCondition() public {
        _setRoundMinVoters(4);
        uint256 cid = _submit();
        uint256 roundStart = block.timestamp;

        // --- Epoch-1 commits (blind, at round start) ---
        _commit(alice, cid, false, 10e6); // DOWN, epoch-1

        // --- Epoch-2 commits (informed, after epoch-1 ends) ---
        _warpPastTlockRevealTime(roundStart + EPOCH_DURATION);
        _commit(bob, cid, true, 10e6); // UP, epoch-2
        _commit(carol, cid, true, 10e6); // UP, epoch-2
        _commit(dave, cid, true, 10e6); // UP, epoch-2

        uint256 roundId = engine.currentRoundId(cid);

        // Reveal all votes. Epoch-1 commits are revealable after roundStart + EPOCH_DURATION.
        // Epoch-2 commits are revealable after roundStart + 2 * EPOCH_DURATION.
        // Warp past epoch-2 end so all can be revealed.
        _warpPastTlockRevealTime(roundStart + 2 * EPOCH_DURATION);

        _reveal(alice, cid, roundId, false);
        _reveal(bob, cid, roundId, true);
        _reveal(carol, cid, roundId, true);
        _reveal(dave, cid, roundId, true);

        // Verify pools before settlement
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, roundId);
        assertEq(round.revealedCount, 4, "All 4 votes revealed");

        // weightedDownPool = 10e6 * 10000 / 10000 = 10e6
        // weightedUpPool = 3 * (10e6 * 2500 / 10000) = 3 * 2_500_000 = 7_500_000
        assertEq(round.weightedDownPool, 10e6, "weighted DOWN pool = 10 LREP (epoch-1 full weight)");
        assertEq(round.weightedUpPool, 7_500_000, "weighted UP pool = 7.5 LREP (3x epoch-2 at 25% each)");

        // thresholdReachedAt was set when the 4th vote was revealed (minVoters = 4)
        assertGt(round.thresholdReachedAt, 0, "threshold reached");

        _settle(cid, roundId);

        RoundLib.Round memory settled = RoundEngineReadHelpers.round(engine, cid, roundId);
        assertEq(uint256(settled.state), uint256(RoundLib.RoundState.Settled), "Round settled");
        assertFalse(settled.upWins, "DOWN wins despite raw UP majority - epoch weighting prevails");
        assertLt(registry.getRating(cid), 5_000, "rating follows weighted DOWN evidence");
    }

    function test_WeightedTieBreak_PreventsLateEpochRefundGrief() public {
        uint256 cid = _submit();
        uint256 roundStart = block.timestamp;

        _commit(alice, cid, true, 10e6);
        _commit(bob, cid, false, 7_500_000);

        uint256 roundId = engine.currentRoundId(cid);
        _warpPastTlockRevealTime(roundStart + EPOCH_DURATION);
        _reveal(alice, cid, roundId, true);
        _reveal(bob, cid, roundId, false);

        _commit(carol, cid, false, 10e6);
        _warpPastTlockRevealTime(roundStart + 2 * EPOCH_DURATION);
        _reveal(carol, cid, roundId, false);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, roundId);
        assertEq(round.weightedUpPool, 10e6, "epoch-1 UP weight");
        assertEq(round.weightedDownPool, 10e6, "epoch-1 plus late DOWN equalizes weight");
        assertEq(round.upPool, 10e6, "raw UP pool");
        assertEq(round.downPool, 17_500_000, "raw DOWN pool");

        _settle(cid, roundId);

        RoundLib.Round memory settled = RoundEngineReadHelpers.round(engine, cid, roundId);
        assertEq(uint256(settled.state), uint256(RoundLib.RoundState.Settled), "weighted-only tie settles");
        assertTrue(settled.upWins, "earlier higher-weight side wins weighted-only tie");
        assertEq(
            engine.roundWinningStake(cid, roundId),
            engine.roundRbtsRewardWeight(cid, roundId),
            "roundWinningStake tracks RBTS reward weight"
        );
        assertGt(engine.roundWinningStake(cid, roundId), 0, "winning reward weight recorded");

        vm.prank(carol);
        vm.expectRevert(RoundVotingEngine.RoundNotCancelledOrTied.selector);
        engine.claimCancelledRoundRefund(cid, roundId);
    }

    // =========================================================================
    // TEST 2: EpochWeightSignal
    // =========================================================================

    /// @notice Epoch-1 voters carry 4x signal weight per LREP vs epoch-2 voters.
    ///
    ///   Alice: UP, 10 LREP, epoch-1 -> effectiveStake = 10 LREP
    ///   Bob:   DOWN, 10 LREP, epoch-1 -> effectiveStake = 10 LREP
    ///   Carol: UP, 10 LREP, epoch-2 -> effectiveStake = 2.5 LREP
    ///
    ///   UP wins. weightedUpPool = 10 + 2.5 = 12.5 LREP.
    ///   Alice carries 4x Carol's signal weight per LREP. RBTS scoring calibrates
    ///   individual reward returns after settlement.
    function test_EpochWeightSignalPools() public {
        uint256 cid = _submit();
        uint256 roundStart = block.timestamp;

        // --- Epoch-1 commits ---
        _commit(alice, cid, true, 10e6); // UP, epoch-1
        _commit(bob, cid, false, 10e6); // DOWN, epoch-1

        // --- Epoch-2 commit ---
        _warpPastTlockRevealTime(roundStart + EPOCH_DURATION);
        _commit(carol, cid, true, 10e6); // UP, epoch-2

        uint256 roundId = engine.currentRoundId(cid);

        // Warp past epoch-2 end to allow all reveals
        _warpPastTlockRevealTime(roundStart + 2 * EPOCH_DURATION);

        _reveal(alice, cid, roundId, true);
        _reveal(bob, cid, roundId, false);
        _reveal(carol, cid, roundId, true);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, roundId);
        assertGt(round.thresholdReachedAt, 0, "threshold reached after 3 reveals");

        // weightedUpPool = 10e6 + 2_500_000 = 12_500_000
        // weightedDownPool = 10e6
        assertEq(round.weightedUpPool, 12_500_000, "weighted UP pool = 12.5 LREP");
        assertEq(round.weightedDownPool, 10e6, "weighted DOWN pool = 10 LREP");

        _settle(cid, roundId);

        RoundLib.Round memory settled = RoundEngineReadHelpers.round(engine, cid, roundId);
        assertEq(uint256(settled.state), uint256(RoundLib.RoundState.Settled), "Round settled");
        assertTrue(settled.upWins, "UP wins (weighted UP pool 125 > DOWN pool 100)");

        uint256 voterPool = engine.roundVoterPool(cid, roundId);

        uint256 aliceBefore = lrepToken.balanceOf(alice);
        vm.prank(alice);
        distributor.claimReward(cid, roundId);
        uint256 aliceGain = lrepToken.balanceOf(alice) - aliceBefore;

        uint256 carolBefore = lrepToken.balanceOf(carol);
        vm.prank(carol);
        distributor.claimReward(cid, roundId);
        uint256 carolGain = lrepToken.balanceOf(carol) - carolBefore;

        assertGt(aliceGain, 0, "Alice receives RBTS claim value");
        assertGt(carolGain, 0, "Carol receives RBTS claim value");
        assertLe(aliceGain, 10e6 + voterPool, "Alice claim stays inside pool bounds");
        assertLe(carolGain, 10e6 + voterPool, "Carol claim stays inside pool bounds");
    }

    // =========================================================================
    // TEST 3: MinVotersSettlement (exactly 3 voters in epoch-1, settles)
    // =========================================================================

    /// @notice Exactly minVoters=3 all commit and reveal in epoch-1. Settlement succeeds
    ///         immediately after all votes are revealed.
    function test_MinVotersSettlement() public {
        uint256 cid = _submit();
        uint256 roundStart = block.timestamp;

        // 3 voters commit in epoch-1: 2 UP, 1 DOWN
        _commit(alice, cid, true, 5e6);
        _commit(bob, cid, true, 5e6);
        _commit(carol, cid, false, 5e6);

        uint256 roundId = engine.currentRoundId(cid);

        // Warp past epoch-1 end to make commits revealable
        _warpPastTlockRevealTime(roundStart + EPOCH_DURATION);

        _reveal(alice, cid, roundId, true);
        _reveal(bob, cid, roundId, true);
        _reveal(carol, cid, roundId, false);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, roundId);
        assertEq(round.revealedCount, 3, "3 votes revealed");
        assertGt(round.thresholdReachedAt, 0, "threshold reached at 3rd reveal");

        _settle(cid, roundId);

        RoundLib.Round memory settled = RoundEngineReadHelpers.round(engine, cid, roundId);
        assertEq(uint256(settled.state), uint256(RoundLib.RoundState.Settled), "Round settled with exactly 3 voters");
        assertTrue(settled.upWins, "UP wins (100 weighted vs 50 weighted, all epoch-1)");
    }

    // =========================================================================
    // TEST 4: ExpiredRoundCancellation (only 2 voters over 7 days)
    // =========================================================================

    /// @notice Only 2 voters commit over the full maxDuration window. Round cannot
    ///         settle (minVoters=3) and is eligible for cancelExpiredRound.
    function test_ExpiredRoundCancellation() public {
        uint256 cid = _submit();
        uint256 roundStart = block.timestamp;

        // Only alice and bob commit - not enough to reach minVoters=3
        _commit(alice, cid, true, 5e6);
        _commit(bob, cid, false, 5e6);

        uint256 roundId = engine.currentRoundId(cid);

        // Warp past maxDuration (7 days) without any more commits
        vm.warp(roundStart + MAX_DURATION + 1);

        // cancelExpiredRound should succeed
        engine.cancelExpiredRound(cid, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Cancelled), "Round cancelled after expiry");

        // Voters should be able to claim refunds
        uint256 aliceBefore = lrepToken.balanceOf(alice);
        uint256 bobBefore = lrepToken.balanceOf(bob);

        // claimCancelledRoundRefund looks up the voter's commit from internal mapping
        vm.prank(alice);
        engine.claimCancelledRoundRefund(cid, roundId);

        vm.prank(bob);
        engine.claimCancelledRoundRefund(cid, roundId);

        assertEq(lrepToken.balanceOf(alice) - aliceBefore, 5e6, "Alice refunded full stake");
        assertEq(lrepToken.balanceOf(bob) - bobBefore, 5e6, "Bob refunded full stake");
    }

    // =========================================================================
    // TEST 5: unanimous round with no losing pool
    // =========================================================================

    /// @notice All 3 voters vote UP (unanimous). losingPool = 0, so no extra voter pool is created.
    function test_UnanimousRound_NoConsensusSubsidy() public {
        uint256 cid = _submit();
        uint256 roundStart = block.timestamp;

        // 3 unanimous UP voters (epoch-1)
        _commit(alice, cid, true, 10e6);
        _commit(bob, cid, true, 10e6);
        _commit(carol, cid, true, 10e6);

        uint256 roundId = engine.currentRoundId(cid);

        // Warp past epoch-1 end
        _warpPastTlockRevealTime(roundStart + EPOCH_DURATION);

        _reveal(alice, cid, roundId, true);
        _reveal(bob, cid, roundId, true);
        _reveal(carol, cid, roundId, true);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, roundId);
        assertEq(round.revealedCount, 3, "3 votes revealed");
        assertEq(round.downPool, 0, "No DOWN votes - unanimous");
        assertGt(round.thresholdReachedAt, 0, "threshold reached");

        _settle(cid, roundId);

        RoundLib.Round memory settled = RoundEngineReadHelpers.round(engine, cid, roundId);
        assertEq(uint256(settled.state), uint256(RoundLib.RoundState.Settled), "Round settled");
        assertTrue(settled.upWins, "UP wins (unanimous)");

        uint256 forfeitedPool = engine.roundRbtsForfeitedPool(cid, roundId);
        uint256 voterPool = engine.roundVoterPool(cid, roundId);
        if (engine.roundRbtsRewardWeight(cid, roundId) > 0) {
            assertEq(voterPool, forfeitedPool, "Voter pool comes only from RBTS forfeitures");
        }

        // Alice can claim her stake + subsidy share
        uint256 aliceBefore = lrepToken.balanceOf(alice);
        vm.prank(alice);
        distributor.claimReward(cid, roundId);
        uint256 aliceAfter = lrepToken.balanceOf(alice);
        uint256 payout = aliceAfter - aliceBefore;
        assertGt(payout, 0, "Alice received a claim");
        assertLe(payout, 10e6 + voterPool, "claim stays inside forfeiture pool");
    }
}
