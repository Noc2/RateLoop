// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { VotePreflightLib } from "../contracts/libraries/VotePreflightLib.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";

/// @title SelectiveRevelationTest
/// @notice Tests for the selective vote revelation (front-running keeper) fix.
///         Validates that the epochUnrevealedCount counter + revealGracePeriod
///         prevents attackers from selectively revealing votes and settling.
contract SelectiveRevelationTest is VotingTestBase {
    LoopReputation public lrepToken;
    ContentRegistry public registry;
    RoundVotingEngine public engine;
    RoundRewardDistributor public rewardDistributor;

    address public owner = address(1);
    address public submitter = address(2);
    // 10 voters for the attack scenario
    address[10] public voters;
    address public treasury = address(100);

    uint256 public constant STAKE = 5e6; // 5 LREP
    uint256 public constant T0 = 1_000_000;
    uint256 public constant EPOCH = 1 hours;
    uint256 public constant GRACE_PERIOD = 60 minutes;

    function setUp() public {
        vm.warp(T0);
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

        rewardDistributor = RoundRewardDistributor(
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
        ProtocolConfig(address(engine.protocolConfig())).setRewardDistributor(address(rewardDistributor));
        ProtocolConfig(address(engine.protocolConfig())).setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(address(engine.protocolConfig())).setTreasury(treasury);
        _setTlockRoundConfig(ProtocolConfig(address(engine.protocolConfig())), EPOCH, EPOCH, 3, 100);
        ProtocolConfig(address(engine.protocolConfig())).setRevealGracePeriod(GRACE_PERIOD);

        lrepToken.mint(owner, 2_000_000e6);
        lrepToken.approve(address(engine), 500_000e6);

        // Set up 10 voters
        for (uint256 i = 0; i < 10; i++) {
            voters[i] = address(uint160(10 + i));
            lrepToken.mint(voters[i], 10_000e6);
        }

        lrepToken.mint(submitter, 10_000e6);

        vm.stopPrank();
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    function _commit(address voter, uint256 contentId, bool isUp, uint256 stake)
        internal
        returns (bytes32 commitKey, bytes32 salt)
    {
        salt = keccak256(abi.encodePacked(voter, block.timestamp));
        commitKey = _commitTestVote(
            DirectTestCommitRequest({
                engine: engine,
                lrepToken: lrepToken,
                voter: voter,
                contentId: contentId,
                isUp: isUp,
                stake: stake,
                frontend: address(0),
                salt: salt
            })
        );
    }

    function _reveal(uint256 contentId, uint256 roundId, bytes32 commitKey, bool isUp, bytes32 salt) internal {
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, isUp, 5_000, salt);
    }

    function _scoreSeedFromLogs(Vm.Log[] memory logs, uint256 contentId, uint256 roundId)
        internal
        view
        returns (bytes32 scoreSeed)
    {
        bytes32 expectedTopic =
            keccak256("RbtsRewardsScored(uint256,uint256,bytes32,uint256,uint256,uint256,uint256,uint16)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == address(engine) && logs[i].topics.length == 3 && logs[i].topics[0] == expectedTopic
                    && uint256(logs[i].topics[1]) == contentId && uint256(logs[i].topics[2]) == roundId
            ) {
                (scoreSeed,,,,,) = abi.decode(logs[i].data, (bytes32, uint256, uint256, uint256, uint256, uint16));
                return scoreSeed;
            }
        }
        revert("RbtsRewardsScored event not emitted");
    }

    function _settlementEntropyFromLogs(Vm.Log[] memory logs, uint256 contentId, uint256 roundId)
        internal
        view
        returns (bytes32 settlementEntropy)
    {
        bytes32 expectedTopic = keccak256("RbtsSeedCaptured(uint256,uint256,bytes32)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == address(engine) && logs[i].topics.length == 3 && logs[i].topics[0] == expectedTopic
                    && uint256(logs[i].topics[1]) == contentId && uint256(logs[i].topics[2]) == roundId
            ) {
                settlementEntropy = abi.decode(logs[i].data, (bytes32));
            }
        }
        if (settlementEntropy != bytes32(0)) return settlementEntropy;
        revert("RbtsSeedCaptured event not emitted");
    }

    function _submitContent() internal returns (uint256 contentId) {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/selective", "test", "test", "test", 0);
        vm.stopPrank();
        contentId = 1;
    }

    function _completeRbtsSettlementAfterPendingCleanup(uint256 contentId, uint256 roundId) internal {
        RoundLib.Round memory pendingRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _processUnrevealedBeforeRbtsSettlement(engine, contentId, roundId, pendingRound);
        vm.roll(block.number + 1);
        _applyIdentityRbtsSettlementSnapshot(engine, contentId, roundId, pendingRound.revealedCount);
    }

    // =========================================================================
    // CORE ATTACK SCENARIO
    // =========================================================================

    /// @notice Reproduces the selective revelation attack: 10 epoch-1 voters (6 UP, 4 DOWN),
    ///         attacker reveals only 3 (2 UP + 1 DOWN) and tries to settle. Must revert.
    function test_SelectiveReveal_BlocksSettlement() public {
        uint256 contentId = _submitContent();

        // 6 UP voters, 4 DOWN voters — all in epoch 1
        bytes32[10] memory commitKeys;
        bytes32[10] memory salts;
        bool[10] memory directions = [true, true, true, true, true, true, false, false, false, false];

        for (uint256 i = 0; i < 10; i++) {
            (commitKeys[i], salts[i]) = _commit(voters[i], contentId, directions[i], STAKE);
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r = RoundEngineReadHelpers.round(engine, contentId, roundId);

        // Warp past epoch end
        _warpPastTlockRevealTime(uint256(r.startTime) + EPOCH);

        // Attacker selectively reveals only 3 votes: 2 UP + 1 DOWN
        _reveal(contentId, roundId, commitKeys[0], true, salts[0]);
        _reveal(contentId, roundId, commitKeys[1], true, salts[1]);
        _reveal(contentId, roundId, commitKeys[6], false, salts[6]);

        // Settlement should revert — 7 unrevealed past-epoch votes remain within grace period
        vm.roll(block.number + 1);
        vm.expectRevert(RoundVotingEngine.UnrevealedPastEpochVotes.selector);
        engine.settleRound(contentId, roundId);
    }

    /// @notice Same scenario but all 10 votes are revealed — settlement succeeds.
    function test_AllPastEpochRevealed_SettlementSucceeds() public {
        uint256 contentId = _submitContent();

        bytes32[10] memory commitKeys;
        bytes32[10] memory salts;
        bool[10] memory directions = [true, true, true, true, true, true, false, false, false, false];

        for (uint256 i = 0; i < 10; i++) {
            (commitKeys[i], salts[i]) = _commit(voters[i], contentId, directions[i], STAKE);
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r = RoundEngineReadHelpers.round(engine, contentId, roundId);

        _warpPastTlockRevealTime(uint256(r.startTime) + EPOCH);

        // Reveal ALL 10 votes
        for (uint256 i = 0; i < 10; i++) {
            _reveal(contentId, roundId, commitKeys[i], directions[i], salts[i]);
        }

        // Settlement succeeds
        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertTrue(round.upWins); // 6 UP vs 4 DOWN
    }

    // =========================================================================
    // SINGLE-DURATION: LATE SAME-WINDOW COMMITS
    // =========================================================================

    /// @notice Votes committed late in the shared blind window settle normally once revealed.
    function test_SingleDuration_LateSameWindowCommitsSettleWhenRevealed() public {
        uint256 contentId = _submitContent();

        // 3 voters early in the shared window.
        (bytes32 ck1, bytes32 s1) = _commit(voters[0], contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voters[1], contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voters[2], contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r = RoundEngineReadHelpers.round(engine, contentId, roundId);

        // 2 more voters near the end of the same shared blind window.
        vm.warp(uint256(r.startTime) + EPOCH - 1);
        (bytes32 ck4, bytes32 s4) = _commit(voters[3], contentId, false, STAKE);
        (bytes32 ck5, bytes32 s5) = _commit(voters[4], contentId, false, STAKE);

        _warpPastTlockRevealTime(uint256(r.startTime) + EPOCH);

        // Reveal all votes from the shared window.
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);
        _reveal(contentId, roundId, ck4, false, s4);
        _reveal(contentId, roundId, ck5, false, s5);

        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertFalse(round.upWins, "late same-window down votes are counted");
    }

    function test_SingleDuration_UnrevealedAfterGraceDoesNotAffectRbtsSeed() public {
        uint256 contentId = _submitContent();

        bytes32[10] memory commitKeys;
        bytes32[10] memory salts;
        bool[10] memory directions = [true, true, false, true, false, true, false, true, false, false];
        for (uint256 i = 0; i < 10; i++) {
            (commitKeys[i], salts[i]) = _commit(voters[i], contentId, directions[i], STAKE);
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 lastRevealableAfter = _lastCommitRevealableAfter(engine, contentId, roundId);
        _warpPastTlockRevealTime(lastRevealableAfter);

        for (uint256 i = 0; i < 8; i++) {
            _reveal(contentId, roundId, commitKeys[i], directions[i], salts[i]);
        }
        vm.warp(lastRevealableAfter + GRACE_PERIOD + 1);

        vm.recordLogs();
        _captureRbtsSeedForCleanup(engine, contentId, roundId);
        _completeRbtsSettlementAfterPendingCleanup(contentId, roundId);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 actualSeed = _scoreSeedFromLogs(logs, contentId, roundId);
        bytes32 settlementEntropy = _settlementEntropyFromLogs(logs, contentId, roundId);

        bytes32 scoringSetHash = _scoringSetHash(contentId, roundId, commitKeys, salts, 8);
        bytes32 expectedSeed = keccak256(
            abi.encode(
                block.chainid, address(engine), contentId, roundId, uint256(8), scoringSetHash, settlementEntropy
            )
        );

        bytes32 pollutedSetHash = _scoringSetHash(contentId, roundId, commitKeys, salts, 10);
        bytes32 pollutedSeed = keccak256(
            abi.encode(
                block.chainid, address(engine), contentId, roundId, uint256(10), pollutedSetHash, settlementEntropy
            )
        );

        assertEq(actualSeed, expectedSeed, "score seed only includes threshold scoring set");
        assertNotEq(actualSeed, pollutedSeed, "unrevealed commits must not perturb seed after grace");
    }

    function _scoringSetHash(
        uint256 contentId,
        uint256 roundId,
        bytes32[10] memory commitKeys,
        bytes32[10] memory salts,
        uint256 count
    )
        internal
        view
        returns (bytes32 hash)
    {
        for (uint256 i = 0; i < count; i++) {
            bytes32 drawKey = _commitIdentityKey(engine, contentId, roundId, commitKeys[i]);
            if (drawKey == bytes32(0)) {
                RoundLib.Commit memory commit = RoundEngineReadHelpers.commit(engine, contentId, roundId, commitKeys[i]);
                drawKey = VotePreflightLib.addressIdentityKey(commit.voter);
            }
            hash = keccak256(abi.encode(hash, commitKeys[i], drawKey, _rbtsRevealEntropy(commitKeys[i], salts[i])));
        }
    }

    function _rbtsRevealEntropy(bytes32 commitKey, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode("rateloop.rbts.reveal-entropy.v1", commitKey, salt));
    }

    function test_SingleDuration_UnrevealedAfterGraceDoesNotCreateSubsidy() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voters[0], contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voters[1], contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voters[2], contentId, true, STAKE);
        _commit(voters[3], contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        vm.warp(_lastCommitRevealableAfter(engine, contentId, roundId) + GRACE_PERIOD + 1);

        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, true, s3);

        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 0);
        uint256 forfeitedPool = _roundRbtsForfeitedPool(engine, contentId, roundId);
        if (_roundRbtsRewardWeight(engine, contentId, roundId) > 0) {
            assertEq(_roundVoterPool(engine, contentId, roundId), forfeitedPool);
        }
    }

    function test_FirstSettleableBlockPostThresholdRevealCountsAndCanFlipSettlement() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voters[0], contentId, true, 1e6);
        (bytes32 ck2, bytes32 s2) = _commit(voters[1], contentId, true, 1e6);
        (bytes32 ck3, bytes32 s3) = _commit(voters[2], contentId, true, 1e6);
        (bytes32 ck4, bytes32 s4) = _commit(voters[3], contentId, false, 10e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r.startTime) + EPOCH);

        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, true, s3);

        vm.warp(block.timestamp + 1);
        vm.roll(block.number + 1);
        RoundLib.Round memory beforeLateReveal = RoundEngineReadHelpers.round(engine, contentId, roundId);
        uint256 upPoolBefore = beforeLateReveal.upPool;
        uint256 downPoolBefore = beforeLateReveal.downPool;
        uint256 weightedUpPoolBefore = beforeLateReveal.weightedUpPool;
        uint256 weightedDownPoolBefore = beforeLateReveal.weightedDownPool;
        uint256 upEvidenceBefore = _roundRatingUpEvidence(engine, contentId, roundId);
        uint256 downEvidenceBefore = _roundRatingDownEvidence(engine, contentId, roundId);
        uint256 frontendStakeBefore = _roundStakeWithEligibleFrontend(engine, contentId, roundId);

        _reveal(contentId, roundId, ck4, false, s4);
        RoundLib.Round memory afterLateReveal = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(afterLateReveal.upPool, upPoolBefore, "late reveal keeps up pool");
        assertEq(afterLateReveal.downPool, downPoolBefore + 10e6, "late reveal moves down pool");
        assertEq(afterLateReveal.weightedUpPool, weightedUpPoolBefore, "late reveal keeps weighted up");
        assertEq(afterLateReveal.weightedDownPool, weightedDownPoolBefore + 10e6, "late reveal moves weighted down");
        assertEq(_roundRatingUpEvidence(engine, contentId, roundId), upEvidenceBefore, "late reveal adds up evidence");
        assertEq(
            _roundRatingDownEvidence(engine, contentId, roundId),
            downEvidenceBefore + 2_000_000,
            "late reveal adds down evidence"
        );
        assertEq(
            _roundStakeWithEligibleFrontend(engine, contentId, roundId), frontendStakeBefore, "late frontend stake"
        );
        assertEq(_commitRbtsScoringWeight(engine, contentId, roundId, ck4), 10e6, "late reveal scored");

        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory settled = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertFalse(settled.upWins, "late down reveal flips settlement");
        assertGt(_commitRbtsScoringWeight(engine, contentId, roundId, ck1), 0, "threshold reveal set scored");
        assertEq(_commitRbtsScoringWeight(engine, contentId, roundId, ck4), 10e6, "late reveal has scoring weight");
        assertEq(
            _commitRbtsStakeReturned(engine, contentId, roundId, ck4)
                + _commitRbtsForfeitedStake(engine, contentId, roundId, ck4),
            10e6,
            "late reveal stake accounted through RBTS"
        );
    }

    function test_SameBlockPostThresholdRevealCountsAndCanFlipSettlement() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voters[0], contentId, true, 1e6);
        (bytes32 ck2, bytes32 s2) = _commit(voters[1], contentId, true, 1e6);
        (bytes32 ck3, bytes32 s3) = _commit(voters[2], contentId, true, 1e6);
        (bytes32 ck4, bytes32 s4) = _commit(voters[3], contentId, false, 10e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r.startTime) + EPOCH);

        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, true, s3);

        RoundLib.Round memory beforeLateReveal = RoundEngineReadHelpers.round(engine, contentId, roundId);
        uint256 upPoolBefore = beforeLateReveal.upPool;
        uint256 downPoolBefore = beforeLateReveal.downPool;
        uint256 weightedUpPoolBefore = beforeLateReveal.weightedUpPool;
        uint256 weightedDownPoolBefore = beforeLateReveal.weightedDownPool;
        uint256 upEvidenceBefore = _roundRatingUpEvidence(engine, contentId, roundId);
        uint256 downEvidenceBefore = _roundRatingDownEvidence(engine, contentId, roundId);

        _reveal(contentId, roundId, ck4, false, s4);

        RoundLib.Round memory afterLateReveal = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(afterLateReveal.upPool, upPoolBefore, "same-block late reveal keeps up pool");
        assertEq(afterLateReveal.downPool, downPoolBefore + 10e6, "same-block late reveal moves down pool");
        assertEq(afterLateReveal.weightedUpPool, weightedUpPoolBefore, "same-block late reveal keeps up weight");
        assertEq(
            afterLateReveal.weightedDownPool, weightedDownPoolBefore + 10e6, "same-block late reveal moves down weight"
        );
        assertEq(_roundRatingUpEvidence(engine, contentId, roundId), upEvidenceBefore, "same-block late up evidence");
        assertEq(
            _roundRatingDownEvidence(engine, contentId, roundId),
            downEvidenceBefore + 2_000_000,
            "same-block late down evidence"
        );
        assertEq(_commitRbtsScoringWeight(engine, contentId, roundId, ck4), 10e6, "same-block late reveal scored");

        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory settled = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertFalse(settled.upWins, "same-block down reveal flips settlement");
        assertEq(
            _commitRbtsStakeReturned(engine, contentId, roundId, ck4)
                + _commitRbtsForfeitedStake(engine, contentId, roundId, ck4),
            10e6,
            "same-block late reveal stake accounted through RBTS"
        );
    }

    function test_RevealAfterSettlementClosureRevertsBeforeMutation() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voters[0], contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voters[1], contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voters[2], contentId, true, STAKE);
        (bytes32 ck4, bytes32 s4) = _commit(voters[3], contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        vm.warp(_lastCommitRevealableAfter(engine, contentId, roundId) + GRACE_PERIOD + 1);

        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, true, s3);

        _captureRbtsSeedForCleanup(engine, contentId, roundId);

        RoundLib.Round memory beforeReveal = RoundEngineReadHelpers.round(engine, contentId, roundId);
        (,,,, bool revealedBefore,,) = engine.commitCore(contentId, roundId, ck4);
        assertFalse(revealedBefore, "commit starts unrevealed");

        vm.expectRevert(RoundVotingEngine.UnrevealedPastEpochVotes.selector);
        _reveal(contentId, roundId, ck4, false, s4);

        RoundLib.Round memory afterReveal = RoundEngineReadHelpers.round(engine, contentId, roundId);
        (,,,, bool revealedAfter,,) = engine.commitCore(contentId, roundId, ck4);
        assertFalse(revealedAfter, "post-closure reveal does not mutate commit");
        assertEq(afterReveal.revealedCount, beforeReveal.revealedCount, "revealed count unchanged");
        assertEq(_commitRbtsScoringWeight(engine, contentId, roundId, ck4), 0, "RBTS weight unchanged");
    }

    // =========================================================================
    // GRACE PERIOD EXPIRY
    // =========================================================================

    /// @notice Unrevealed past-epoch votes block settlement until reveal grace, then settle if reveal quorum exists.
    function test_FinalGraceExpiry_AllowsSettlementAndCleanupWhenRevealQuorumExists() public {
        uint256 contentId = _submitContent();

        bytes32[4] memory commitKeys;
        bytes32[4] memory salts;
        bool[4] memory directions = [true, true, false, false];

        for (uint256 i = 0; i < 4; i++) {
            (commitKeys[i], salts[i]) = _commit(voters[i], contentId, directions[i], STAKE);
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 revealGraceDeadline = _lastCommitRevealableAfter(engine, contentId, roundId) + GRACE_PERIOD;

        // Warp past the tlock-backed revealable timestamp + full grace period.
        vm.warp(revealGraceDeadline + 1);

        // Only reveal 3 of 4 votes (enough for minVoters)
        _reveal(contentId, roundId, commitKeys[0], true, salts[0]);
        _reveal(contentId, roundId, commitKeys[1], true, salts[1]);
        _reveal(contentId, roundId, commitKeys[2], false, salts[2]);

        _captureRbtsSeedForCleanup(engine, contentId, roundId);

        RoundLib.Round memory pendingRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(pendingRound.state), uint256(RoundLib.RoundState.SettlementPending));
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 1);

        vm.expectRevert(bytes("Round not settled"));
        vm.prank(voters[0]);
        rewardDistributor.claimReward(contentId, roundId);

        _completeRbtsSettlementAfterPendingCleanup(contentId, roundId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 0);
    }

    function test_FinalGraceExpiry_UnrevealedPastEpochDoesNotCreateSubsidy() public {
        uint256 contentId = _submitContent();

        bytes32[4] memory commitKeys;
        bytes32[4] memory salts;
        bool[4] memory directions = [true, true, true, false];

        for (uint256 i = 0; i < 4; i++) {
            (commitKeys[i], salts[i]) = _commit(voters[i], contentId, directions[i], STAKE);
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 revealGraceDeadline = _lastCommitRevealableAfter(engine, contentId, roundId) + GRACE_PERIOD;

        vm.warp(revealGraceDeadline + 1);

        _reveal(contentId, roundId, commitKeys[0], true, salts[0]);
        _reveal(contentId, roundId, commitKeys[1], true, salts[1]);
        _reveal(contentId, roundId, commitKeys[2], true, salts[2]);

        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 0);
        uint256 forfeitedPool = _roundRbtsForfeitedPool(engine, contentId, roundId);
        if (_roundRbtsRewardWeight(engine, contentId, roundId) > 0) {
            assertEq(_roundVoterPool(engine, contentId, roundId), forfeitedPool);
        }
    }

    function test_PostThresholdRevealAfterFinalGrace_RevertsAndLeavesStakeForCleanup() public {
        uint256 contentId = _submitContent();

        bytes32[4] memory commitKeys;
        bytes32[4] memory salts;
        bool[4] memory directions = [true, true, true, false];

        for (uint256 i = 0; i < 4; i++) {
            (commitKeys[i], salts[i]) = _commit(voters[i], contentId, directions[i], STAKE);
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r.startTime) + EPOCH);

        _reveal(contentId, roundId, commitKeys[0], true, salts[0]);
        _reveal(contentId, roundId, commitKeys[1], true, salts[1]);
        _reveal(contentId, roundId, commitKeys[2], true, salts[2]);

        uint256 revealGraceDeadline = _lastCommitRevealableAfter(engine, contentId, roundId) + GRACE_PERIOD;
        vm.warp(revealGraceDeadline + 1);

        vm.expectRevert(RoundVotingEngine.UnrevealedPastEpochVotes.selector);
        _reveal(contentId, roundId, commitKeys[3], false, salts[3]);

        _captureRbtsSeedForCleanup(engine, contentId, roundId);
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 1);
        assertEq(_commitRbtsStakeReturned(engine, contentId, roundId, commitKeys[3]), 0);
        _completeRbtsSettlementAfterPendingCleanup(contentId, roundId);
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 0);
    }

    /// @notice Within grace period, unrevealed votes still block settlement.
    function test_WithinGracePeriod_SettlementBlocked() public {
        uint256 contentId = _submitContent();

        bytes32[4] memory commitKeys;
        bytes32[4] memory salts;
        bool[4] memory directions = [true, true, false, false];

        for (uint256 i = 0; i < 4; i++) {
            (commitKeys[i], salts[i]) = _commit(voters[i], contentId, directions[i], STAKE);
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r = RoundEngineReadHelpers.round(engine, contentId, roundId);

        // Warp past epoch end but WITHIN grace period (30 min into 60 min grace)
        vm.warp(r.startTime + EPOCH + 30 minutes);

        // Reveal 3 of 4 votes
        _reveal(contentId, roundId, commitKeys[0], true, salts[0]);
        _reveal(contentId, roundId, commitKeys[1], true, salts[1]);
        _reveal(contentId, roundId, commitKeys[2], false, salts[2]);

        // Settlement blocked — 1 unrevealed vote within grace period
        vm.roll(block.number + 1);
        vm.expectRevert(RoundVotingEngine.UnrevealedPastEpochVotes.selector);
        engine.settleRound(contentId, roundId);
    }

    // =========================================================================
    // COUNTER ACCURACY
    // =========================================================================

    /// @notice Verify epochUnrevealedCount decrements correctly as votes are revealed.
    function test_CounterAccuracy_DecrementOnReveal() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voters[0], contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voters[1], contentId, false, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voters[2], contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r = RoundEngineReadHelpers.round(engine, contentId, roundId);
        uint256 epochEnd = r.startTime + EPOCH;

        assertEq(r.voteCount, 3);
        assertEq(r.revealedCount, 0);

        _warpPastTlockRevealTime(epochEnd);

        _reveal(contentId, roundId, ck1, true, s1);
        assertEq(RoundEngineReadHelpers.round(engine, contentId, roundId).revealedCount, 1);

        _reveal(contentId, roundId, ck2, false, s2);
        assertEq(RoundEngineReadHelpers.round(engine, contentId, roundId).revealedCount, 2);

        _reveal(contentId, roundId, ck3, true, s3);
        assertEq(RoundEngineReadHelpers.round(engine, contentId, roundId).revealedCount, 3);

        // Settlement succeeds
        _settleAfterRbtsSeed(engine, contentId, roundId);
    }

    // =========================================================================
    // CONFIGURATION
    // =========================================================================

    /// @notice CONFIG_ROLE can update revealGracePeriod.
    function test_SetRevealGracePeriod_ConfigRole() public {
        ProtocolConfig cfg = ProtocolConfig(address(engine.protocolConfig()));
        vm.prank(owner);
        cfg.setRevealGracePeriod(2 hours);
        assertEq(cfg.revealGracePeriod(), 2 hours);
    }

    /// @notice revealGracePeriod must be >= epochDuration.
    function test_SetRevealGracePeriod_BelowEpochDuration_Reverts() public {
        // epochDuration is 1 hour; 30 min < 1 hour → revert
        ProtocolConfig cfg = ProtocolConfig(address(engine.protocolConfig()));
        vm.prank(owner);
        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        cfg.setRevealGracePeriod(30 minutes);
    }

    /// @notice Non-CONFIG_ROLE cannot set revealGracePeriod.
    function test_SetRevealGracePeriod_Unauthorized_Reverts() public {
        ProtocolConfig cfg = ProtocolConfig(address(engine.protocolConfig()));
        vm.prank(voters[0]);
        vm.expectRevert();
        cfg.setRevealGracePeriod(2 hours);
    }

    function test_RevealGracePeriodSnapshot_OldRoundKeepsOriginalValue() public {
        uint256 contentId = _submitContent();

        bytes32[4] memory commitKeys;
        bytes32[4] memory salts;
        bool[4] memory directions = [true, true, false, false];

        for (uint256 i = 0; i < 4; i++) {
            (commitKeys[i], salts[i]) = _commit(voters[i], contentId, directions[i], STAKE);
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(_roundRevealGracePeriodSnapshot(engine, contentId, roundId), GRACE_PERIOD);

        ProtocolConfig cfg = ProtocolConfig(address(engine.protocolConfig()));
        vm.prank(owner);
        cfg.setRevealGracePeriod(2 hours);

        vm.warp(_lastCommitRevealableAfter(engine, contentId, roundId) + GRACE_PERIOD + 1);

        _reveal(contentId, roundId, commitKeys[0], true, salts[0]);
        _reveal(contentId, roundId, commitKeys[1], true, salts[1]);
        _reveal(contentId, roundId, commitKeys[2], false, salts[2]);

        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 0);
    }

    function test_RevealGracePeriodSnapshot_NewRoundUsesUpdatedValue() public {
        ProtocolConfig cfg = ProtocolConfig(address(engine.protocolConfig()));
        vm.prank(owner);
        cfg.setRevealGracePeriod(2 hours);

        uint256 contentId = _submitContent();

        bytes32[4] memory commitKeys;
        bytes32[4] memory salts;
        bool[4] memory directions = [true, true, false, false];

        for (uint256 i = 0; i < 4; i++) {
            (commitKeys[i], salts[i]) = _commit(voters[i], contentId, directions[i], STAKE);
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(_roundRevealGracePeriodSnapshot(engine, contentId, roundId), 2 hours);

        uint256 lastRevealableAfter = _lastCommitRevealableAfter(engine, contentId, roundId);
        vm.warp(lastRevealableAfter + GRACE_PERIOD + 1);

        _reveal(contentId, roundId, commitKeys[0], true, salts[0]);
        _reveal(contentId, roundId, commitKeys[1], true, salts[1]);
        _reveal(contentId, roundId, commitKeys[2], false, salts[2]);

        vm.roll(block.number + 1);
        vm.expectRevert(RoundVotingEngine.UnrevealedPastEpochVotes.selector);
        engine.settleRound(contentId, roundId);

        vm.warp(lastRevealableAfter + 2 hours + 1);
        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 0);
    }

    // =========================================================================
    // SINGLE-DURATION SETTLEMENT: UNREVEALED SAME-WINDOW VOTES
    // =========================================================================

    /// @notice Unrevealed same-window votes block settlement while still inside reveal grace.
    function test_SingleDuration_UnrevealedSameWindowBlocksWithinGrace() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voters[0], contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voters[1], contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voters[2], contentId, false, STAKE);
        _commit(voters[3], contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Reveal quorum after the blind window, but before the unrevealed vote's grace expires.
        vm.warp(_lastCommitRevealableAfter(engine, contentId, roundId) + 30 minutes);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);

        // Settlement blocked — one same-window unrevealed vote remains inside grace.
        vm.roll(block.number + 1);
        vm.expectRevert(RoundVotingEngine.UnrevealedPastEpochVotes.selector);
        engine.settleRound(contentId, roundId);
    }
}
