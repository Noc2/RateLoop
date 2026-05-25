// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";

/// @title SelectiveRevelationTest
/// @notice Tests for the selective vote revelation (front-running keeper) fix.
///         Validates that the epochUnrevealedCount counter + revealGracePeriod
///         prevents attackers from selectively revealing votes and settling.
contract SelectiveRevelationTest is VotingTestBase {
    struct CommitArtifacts {
        bytes32 salt;
        uint64 targetRound;
        bytes32 drandChainHash;
        bytes ciphertext;
        bytes32 commitHash;
        bytes32 commitKey;
    }

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
        _setTlockRoundConfig(ProtocolConfig(address(engine.protocolConfig())), EPOCH, 7 days, 3, 200);
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

    function _buildCommitArtifacts(address voter, uint256 contentId, bool isUp, bytes32 salt)
        private
        view
        returns (CommitArtifacts memory artifacts)
    {
        artifacts.salt = salt;
        artifacts.targetRound = _tlockCommitTargetRound(engine, contentId);
        artifacts.drandChainHash = _tlockDrandChainHash();
        artifacts.ciphertext = _testCiphertext(isUp, salt, contentId, artifacts.targetRound, artifacts.drandChainHash);
        artifacts.commitHash = _commitHash(
            isUp, salt, voter, contentId, artifacts.targetRound, artifacts.drandChainHash, artifacts.ciphertext
        );
        artifacts.commitKey = keccak256(abi.encodePacked(voter, artifacts.commitHash));
    }

    function _commit(address voter, uint256 contentId, bool isUp, uint256 stake)
        internal
        returns (bytes32 commitKey, bytes32 salt)
    {
        salt = keccak256(abi.encodePacked(voter, block.timestamp));
        CommitArtifacts memory artifacts = _buildCommitArtifacts(voter, contentId, isUp, salt);
        _openRoundForTest(engine, contentId, voter);
        vm.startPrank(voter);
        lrepToken.approve(address(engine), stake);
        uint256 cachedRoundContext1 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        engine.commitVote(
            contentId,
            cachedRoundContext1,
            artifacts.targetRound,
            artifacts.drandChainHash,
            artifacts.commitHash,
            artifacts.ciphertext,
            stake,
            address(0)
        );
        vm.stopPrank();
        commitKey = artifacts.commitKey;
    }

    function _reveal(uint256 contentId, uint256 roundId, bytes32 commitKey, bool isUp, bytes32 salt) internal {
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, isUp, 5_000, salt);
    }

    function _submitContent() internal returns (uint256 contentId) {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/selective", "test", "test", "test", 0);
        vm.stopPrank();
        contentId = 1;
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
        vm.expectRevert(RoundVotingEngine.UnrevealedPastEpochVotes.selector);
        _settleAfterRbtsSeed(engine, contentId, roundId);
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
    // MULTI-EPOCH: CURRENT EPOCH DOESN'T BLOCK
    // =========================================================================

    /// @notice Epoch-1 votes all revealed. Epoch-2 votes still in current epoch (unrevealed).
    ///         Settlement should succeed because current-epoch votes don't block.
    function test_MultiEpoch_CurrentEpochDoesNotBlock() public {
        uint256 contentId = _submitContent();

        // 3 voters in epoch 1
        (bytes32 ck1, bytes32 s1) = _commit(voters[0], contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voters[1], contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voters[2], contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r = RoundEngineReadHelpers.round(engine, contentId, roundId);

        // Warp to epoch 2 (past epoch-1 end, within epoch-2)
        _warpPastTlockRevealTime(uint256(r.startTime) + EPOCH);

        // 2 more voters in epoch 2 (current epoch — not yet revealable)
        _commit(voters[3], contentId, false, STAKE);
        _commit(voters[4], contentId, false, STAKE);

        // Reveal all 3 epoch-1 votes
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);

        // Settlement succeeds — epoch-2 votes are in current epoch, don't block
        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
    }

    function test_MultiEpoch_CurrentEpochUnrevealedDoesNotCreateSubsidy() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voters[0], contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voters[1], contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voters[2], contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r = RoundEngineReadHelpers.round(engine, contentId, roundId);

        _warpPastTlockRevealTime(uint256(r.startTime) + EPOCH);

        _commit(voters[3], contentId, false, STAKE);

        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, true, s3);

        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertEq(engine.roundUnrevealedCleanupRemaining(contentId, roundId), 0);
        uint256 forfeitedPool = engine.roundRbtsForfeitedPool(contentId, roundId);
        if (engine.roundRbtsRewardWeight(contentId, roundId) > 0) {
            assertEq(engine.roundVoterPool(contentId, roundId), forfeitedPool);
        }
    }

    function test_LaterBlockPostThresholdRevealCanEnterRbtsScoringSet() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voters[0], contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voters[1], contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voters[2], contentId, false, STAKE);
        (bytes32 ck4, bytes32 s4) = _commit(voters[3], contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r.startTime) + EPOCH);

        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);

        // A later-block post-threshold reveal keeps the existing round economics. The
        // same-block backrun case is covered separately below.
        vm.warp(block.timestamp + 1);
        vm.roll(block.number + 1);
        RoundLib.Round memory beforeLateReveal = RoundEngineReadHelpers.round(engine, contentId, roundId);
        uint256 upPoolBefore = beforeLateReveal.upPool;
        uint256 downPoolBefore = beforeLateReveal.downPool;
        uint256 weightedUpPoolBefore = beforeLateReveal.weightedUpPool;
        uint256 weightedDownPoolBefore = beforeLateReveal.weightedDownPool;
        uint256 upEvidenceBefore = engine.roundRatingUpEvidence(contentId, roundId);
        uint256 downEvidenceBefore = engine.roundRatingDownEvidence(contentId, roundId);
        _reveal(contentId, roundId, ck4, true, s4);

        RoundLib.Round memory afterLateReveal = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertGt(afterLateReveal.upPool, upPoolBefore, "later-block reveal can move settlement up pool");
        assertEq(afterLateReveal.downPool, downPoolBefore, "later-block reveal leaves down pool unchanged");
        assertGt(afterLateReveal.weightedUpPool, weightedUpPoolBefore, "later-block reveal can move weighted up");
        assertEq(afterLateReveal.weightedDownPool, weightedDownPoolBefore, "later-block reveal leaves weighted down");
        assertEq(
            engine.roundRatingUpEvidence(contentId, roundId),
            upEvidenceBefore + 1_500_000,
            "later-block reveal adds up evidence"
        );
        assertEq(
            engine.roundRatingDownEvidence(contentId, roundId),
            downEvidenceBefore,
            "later-block reveal leaves down evidence"
        );

        vm.roll(block.number + 1);
        engine.settleRound(contentId, roundId);

        assertGt(engine.commitRbtsScoringWeight(contentId, roundId, ck1), 0, "threshold reveal set scored");
        assertGt(engine.commitRbtsScoringWeight(contentId, roundId, ck4), 0, "later-block reveal enters scoring set");
    }

    function test_SameBlockPostThresholdRevealCannotMoveSettlementOrEnterRbtsScoringSet() public {
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
        uint256 upEvidenceBefore = engine.roundRatingUpEvidence(contentId, roundId);
        uint256 downEvidenceBefore = engine.roundRatingDownEvidence(contentId, roundId);

        _reveal(contentId, roundId, ck4, false, s4);

        RoundLib.Round memory afterLateReveal = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(afterLateReveal.upPool, upPoolBefore, "same-block late reveal cannot move up pool");
        assertEq(afterLateReveal.downPool, downPoolBefore, "same-block late reveal cannot move down pool");
        assertEq(afterLateReveal.weightedUpPool, weightedUpPoolBefore, "same-block late reveal cannot move up weight");
        assertEq(
            afterLateReveal.weightedDownPool, weightedDownPoolBefore, "same-block late reveal cannot move down weight"
        );
        assertEq(engine.roundRatingUpEvidence(contentId, roundId), upEvidenceBefore, "same-block late up evidence");
        assertEq(
            engine.roundRatingDownEvidence(contentId, roundId), downEvidenceBefore, "same-block late down evidence"
        );
        assertEq(engine.commitRbtsScoringWeight(contentId, roundId, ck4), 0, "same-block late reveal omitted");

        vm.roll(block.number + 1);
        engine.settleRound(contentId, roundId);

        RoundLib.Round memory settled = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertTrue(settled.upWins, "same-block down backrun cannot flip settlement");
        assertEq(engine.commitRbtsRewardWeight(contentId, roundId, ck4), 0, "late reveal has no RBTS reward");
        assertEq(engine.commitRbtsStakeReturned(contentId, roundId, ck4), 10e6, "late reveal gets stake back");
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
        uint256 revealGraceDeadline = engine.lastCommitRevealableAfter(contentId, roundId) + GRACE_PERIOD;

        // Warp past the tlock-backed revealable timestamp + full grace period.
        vm.warp(revealGraceDeadline + 1);

        // Only reveal 3 of 4 votes (enough for minVoters)
        _reveal(contentId, roundId, commitKeys[0], true, salts[0]);
        _reveal(contentId, roundId, commitKeys[1], true, salts[1]);
        _reveal(contentId, roundId, commitKeys[2], false, salts[2]);

        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertEq(engine.roundUnrevealedCleanupRemaining(contentId, roundId), 1);

        vm.expectRevert(RoundRewardDistributor.UnrevealedCleanupPending.selector);
        vm.prank(voters[0]);
        rewardDistributor.claimReward(contentId, roundId);

        engine.processUnrevealedVotes(contentId, roundId, 0, 0);
        assertEq(engine.roundUnrevealedCleanupRemaining(contentId, roundId), 0);
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
        uint256 revealGraceDeadline = engine.lastCommitRevealableAfter(contentId, roundId) + GRACE_PERIOD;

        vm.warp(revealGraceDeadline + 1);

        _reveal(contentId, roundId, commitKeys[0], true, salts[0]);
        _reveal(contentId, roundId, commitKeys[1], true, salts[1]);
        _reveal(contentId, roundId, commitKeys[2], true, salts[2]);

        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertEq(engine.roundUnrevealedCleanupRemaining(contentId, roundId), 1);
        uint256 forfeitedPool = engine.roundRbtsForfeitedPool(contentId, roundId);
        if (engine.roundRbtsRewardWeight(contentId, roundId) > 0) {
            assertEq(engine.roundVoterPool(contentId, roundId), forfeitedPool);
        }
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
        vm.expectRevert(RoundVotingEngine.UnrevealedPastEpochVotes.selector);
        _settleAfterRbtsSeed(engine, contentId, roundId);
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
        assertEq(engine.roundRevealGracePeriodSnapshot(contentId, roundId), GRACE_PERIOD);

        ProtocolConfig cfg = ProtocolConfig(address(engine.protocolConfig()));
        vm.prank(owner);
        cfg.setRevealGracePeriod(2 hours);

        vm.warp(engine.lastCommitRevealableAfter(contentId, roundId) + GRACE_PERIOD + 1);

        _reveal(contentId, roundId, commitKeys[0], true, salts[0]);
        _reveal(contentId, roundId, commitKeys[1], true, salts[1]);
        _reveal(contentId, roundId, commitKeys[2], false, salts[2]);

        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertEq(engine.roundUnrevealedCleanupRemaining(contentId, roundId), 1);
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
        assertEq(engine.roundRevealGracePeriodSnapshot(contentId, roundId), 2 hours);

        uint256 lastRevealableAfter = engine.lastCommitRevealableAfter(contentId, roundId);
        vm.warp(lastRevealableAfter + GRACE_PERIOD + 1);

        _reveal(contentId, roundId, commitKeys[0], true, salts[0]);
        _reveal(contentId, roundId, commitKeys[1], true, salts[1]);
        _reveal(contentId, roundId, commitKeys[2], false, salts[2]);

        vm.expectRevert(RoundVotingEngine.UnrevealedPastEpochVotes.selector);
        _settleAfterRbtsSeed(engine, contentId, roundId);

        vm.warp(lastRevealableAfter + 2 hours + 1);
        _settleAfterRbtsSeed(engine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertEq(engine.roundUnrevealedCleanupRemaining(contentId, roundId), 1);
    }

    // =========================================================================
    // MULTI-EPOCH SETTLEMENT: BOTH EPOCHS PAST
    // =========================================================================

    /// @notice Two epochs past: epoch-1 fully revealed, epoch-2 has unrevealed within grace.
    ///         Settlement blocked by epoch-2 unrevealed votes.
    function test_MultiEpoch_Epoch2UnrevealedBlocks() public {
        uint256 contentId = _submitContent();

        // 3 voters in epoch 1
        (bytes32 ck1, bytes32 s1) = _commit(voters[0], contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voters[1], contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voters[2], contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r = RoundEngineReadHelpers.round(engine, contentId, roundId);

        // Warp to epoch 2
        _warpPastTlockRevealTime(uint256(r.startTime) + EPOCH);

        // 1 voter in epoch 2
        _commit(voters[3], contentId, false, STAKE);

        // Reveal all epoch-1 votes
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);

        // Warp past epoch-2 end but within epoch-2 grace period
        _warpPastTlockRevealTime(uint256(r.startTime) + 2 * EPOCH);

        // Settlement blocked — epoch-2 has unrevealed vote within grace period
        vm.expectRevert(RoundVotingEngine.UnrevealedPastEpochVotes.selector);
        _settleAfterRbtsSeed(engine, contentId, roundId);
    }
}
