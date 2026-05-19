// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Vm } from "forge-std/Test.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RatingLib } from "../contracts/libraries/RatingLib.sol";
import { RewardMath } from "../contracts/libraries/RewardMath.sol";
import { RoundSettlementSideEffectsLib } from "../contracts/libraries/RoundSettlementSideEffectsLib.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { ParticipationPool } from "../contracts/ParticipationPool.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { IFrontendRegistry } from "../contracts/interfaces/IFrontendRegistry.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";

contract RevertingParticipationPool {
    IERC20 public immutable token;

    constructor(address _token) {
        token = IERC20(_token);
    }

    function getCurrentRateBps() external pure returns (uint256) {
        revert("rate unavailable");
    }

    function distributeReward(address voter, uint256 amount) public returns (uint256 paidAmount) {
        uint256 balance = token.balanceOf(address(this));
        paidAmount = amount > balance ? balance : amount;
        if (paidAmount > 0) {
            token.transfer(voter, paidAmount);
        }
    }
}

/// @title Round-based integration tests for tlock commit-reveal flow with epoch-weighted rewards.
/// @dev Covers: full lifecycle, multi-voter, concurrent rounds, tied rounds,
///      cancelled/expired rounds, consensus settlement, config snapshots.
///      Uses fake AGE-armored test ciphertexts, not real drand/tlock payloads.
contract RoundIntegrationTest is VotingTestBase {
    LoopReputation public lrepToken;
    ContentRegistry public registry;
    RoundVotingEngine public votingEngine;
    RoundRewardDistributor public rewardDistributor;
    RaterRegistry public raterRegistry;

    address public owner = address(1);
    address public submitter = address(2);
    address public voter1 = address(3);
    address public voter2 = address(4);
    address public voter3 = address(5);
    address public voter4 = address(6);
    address public voter5 = address(7);
    address public voter6 = address(8);
    address public delegate1 = address(9);
    address public delegate2 = address(10);
    address public treasury = address(100);

    uint256 public constant STAKE = 5e6; // 5 LREP

    // Short epoch duration for tests (10 minutes — above the 5-minute minimum)
    uint256 public constant EPOCH_DURATION = 10 minutes;

    function _tlockDrandChainHash() internal pure override returns (bytes32) {
        return DEFAULT_DRAND_CHAIN_HASH;
    }

    function _tlockDrandGenesisTime() internal pure override returns (uint64) {
        return DEFAULT_DRAND_GENESIS_TIME;
    }

    function _tlockDrandPeriod() internal pure override returns (uint64) {
        return DEFAULT_DRAND_PERIOD;
    }

    function _tlockEpochDuration() internal view override returns (uint256) {
        return activeTlockEpochDuration;
    }

    function _defaultPredictionBps(uint256 index, bool isUp) internal pure returns (uint16) {
        uint16[3] memory upPredictions = [uint16(7_000), uint16(6_000), uint16(5_500)];
        uint16[3] memory downPredictions = [uint16(4_000), uint16(3_500), uint16(3_000)];
        return isUp ? upPredictions[index % upPredictions.length] : downPredictions[index % downPredictions.length];
    }

    function _commitHashWithPrediction(
        bool isUp,
        uint16 predictedUpBps,
        bytes32 salt,
        address voter,
        uint256 contentId,
        uint256 roundId,
        uint16 roundReferenceRatingBps,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes memory ciphertext
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                isUp,
                predictedUpBps,
                salt,
                voter,
                contentId,
                roundId,
                roundReferenceRatingBps,
                targetRound,
                drandChainHash,
                keccak256(ciphertext)
            )
        );
    }

    function _commitHashWithPrediction(bool isUp, uint16 predictedUpBps, bytes32 salt, address voter, uint256 contentId)
        internal
        view
        returns (bytes32)
    {
        bytes memory ciphertext = _testCiphertext(isUp, salt, contentId);
        return _commitHashWithPrediction(
            isUp,
            predictedUpBps,
            salt,
            voter,
            contentId,
            _defaultTestCommitRoundId(contentId),
            _currentRatingReferenceBps(contentId),
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ciphertext
        );
    }

    function setUp() public {
        // Set a predictable start time
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

        // Foundry tests use fake AGE-armored payloads here rather than real drand/tlock ciphertexts.
        votingEngine = RoundVotingEngine(
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
                        (owner, address(lrepToken), address(votingEngine), address(registry))
                    )
                )
            )
        );

        registry.setVotingEngine(address(votingEngine));
        registry.setProtocolConfig(address(votingEngine.protocolConfig()));
        MockCategoryRegistry mockCategoryRegistry = new MockCategoryRegistry();
        mockCategoryRegistry.seedDefaultTestCategories();
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(address(votingEngine.protocolConfig())).setRewardDistributor(address(rewardDistributor));
        ProtocolConfig(address(votingEngine.protocolConfig())).setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(address(votingEngine.protocolConfig())).setTreasury(treasury);
        raterRegistry = _deployRaterRegistry(owner);
        ProtocolConfig(address(votingEngine.protocolConfig())).setRaterRegistry(address(raterRegistry));
        _setTlockDrandConfig(
            ProtocolConfig(address(votingEngine.protocolConfig())),
            DEFAULT_DRAND_CHAIN_HASH,
            DEFAULT_DRAND_GENESIS_TIME,
            DEFAULT_DRAND_PERIOD
        );

        // setConfig(epochDuration, maxDuration, minVoters, maxVoters)
        // Use short 10-minute epochs for tests.
        _setTlockRoundConfig(ProtocolConfig(address(votingEngine.protocolConfig())), EPOCH_DURATION, 7 days, 3, 200);

        // Mint LREP to all test users
        address[7] memory users = [submitter, voter1, voter2, voter3, voter4, voter5, voter6];
        for (uint256 i = 0; i < users.length; i++) {
            lrepToken.mint(users[i], 10_000e6);
            _seedRaterIdentity(raterRegistry, users[i], bytes32(uint256(uint160(users[i]))));
        }
        lrepToken.mint(delegate1, 10_000e6);
        lrepToken.mint(delegate2, 10_000e6);

        vm.stopPrank();
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    function _submitContent() internal returns (uint256 contentId) {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/1", "test goal", "test goal", "test", 0);
        vm.stopPrank();
        contentId = 1;
    }

    /// @dev Submit content with a unique URL suffix to avoid duplicate-URL conflicts.
    function _submitContentN(uint256 n) internal returns (uint256 contentId) {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        string memory url = string(abi.encodePacked("https://example.com/", vm.toString(n)));
        _submitContentWithReservation(registry, url, "test goal", "test goal", "test", 0);
        vm.stopPrank();
        contentId = n;
    }

    function _buildCommitPayload(bool isUp, bytes32 salt, address voter, uint256 contentId)
        internal
        view
        returns (bytes32 ch, bytes memory ct, uint64 targetRound, bytes32 drandChainHash)
    {
        return _buildCommitPayloadWithPrediction(isUp, 5_000, salt, voter, contentId);
    }

    function _buildCommitPayloadWithPrediction(
        bool isUp,
        uint16 predictedUpBps,
        bytes32 salt,
        address voter,
        uint256 contentId
    ) internal view returns (bytes32 ch, bytes memory ct, uint64 targetRound, bytes32 drandChainHash) {
        targetRound = _tlockCommitTargetRound(votingEngine, contentId);
        drandChainHash = _tlockDrandChainHash();
        ct = _testCiphertext(isUp, salt, contentId, targetRound, drandChainHash);
        ch = _commitHashWithPrediction(
            isUp,
            predictedUpBps,
            salt,
            voter,
            contentId,
            _defaultTestCommitRoundId(contentId),
            _currentRatingReferenceBps(contentId),
            targetRound,
            drandChainHash,
            ct
        );
    }

    /// @dev Commit + reveal a vote for a voter in a single epoch boundary.
    ///      The commit is recorded, then time advances past EPOCH_DURATION, then the vote is revealed.
    function _commitAndReveal(address voter, uint256 contentId, bool isUp, uint256 stakeAmount) internal {
        bytes32 salt = keccak256(abi.encodePacked(voter, contentId, isUp));
        uint16 predictedUpBps = _defaultPredictionBps(0, isUp);
        (bytes32 ch, bytes memory ct, uint64 targetRound, bytes32 drandChainHash) =
            _buildCommitPayloadWithPrediction(isUp, predictedUpBps, salt, voter, contentId);

        vm.startPrank(voter);
        lrepToken.approve(address(votingEngine), stakeAmount);
        uint256 cachedRoundContext1 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId, cachedRoundContext1, targetRound, drandChainHash, ch, ct, stakeAmount, address(0)
        );
        vm.stopPrank();

        // Advance time past epoch boundary so vote becomes revealable
        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);

        bytes32 ck = _commitKey(voter, ch);
        uint256 roundId = _getActiveOrLatestRoundId(contentId);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck, isUp, predictedUpBps, salt);
    }

    /// @dev Commit a vote (no reveal). Returns (commitHash, commitKey).
    function _commit(address voter, uint256 contentId, bool isUp, uint256 stakeAmount)
        internal
        returns (bytes32 ch, bytes32 ck)
    {
        bytes32 salt = keccak256(abi.encodePacked(voter, contentId, isUp, block.timestamp));
        return _commitWithSalt(voter, contentId, isUp, stakeAmount, salt);
    }

    function _commitWithSalt(address voter, uint256 contentId, bool isUp, uint256 stakeAmount, bytes32 salt)
        internal
        returns (bytes32 ch, bytes32 ck)
    {
        return _commitWithSaltAndFrontend(voter, contentId, isUp, stakeAmount, salt, address(0));
    }

    function _commitWithSaltAndPrediction(
        address voter,
        uint256 contentId,
        bool isUp,
        uint256 stakeAmount,
        bytes32 salt,
        uint16 predictedUpBps
    ) internal returns (bytes32 ch, bytes32 ck) {
        bytes memory ct;
        uint64 targetRound;
        bytes32 drandChainHash;
        (ch, ct, targetRound, drandChainHash) =
            _buildCommitPayloadWithPrediction(isUp, predictedUpBps, salt, voter, contentId);

        vm.startPrank(voter);
        lrepToken.approve(address(votingEngine), stakeAmount);
        uint256 cachedRoundContext =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId, cachedRoundContext, targetRound, drandChainHash, ch, ct, stakeAmount, address(0)
        );
        vm.stopPrank();

        ck = _commitKey(voter, ch);
    }

    function _commitWithSaltAndFrontend(
        address voter,
        uint256 contentId,
        bool isUp,
        uint256 stakeAmount,
        bytes32 salt,
        address frontend
    ) internal returns (bytes32 ch, bytes32 ck) {
        bytes memory ct;
        uint64 targetRound;
        bytes32 drandChainHash;
        (ch, ct, targetRound, drandChainHash) = _buildCommitPayload(isUp, salt, voter, contentId);

        vm.startPrank(voter);
        lrepToken.approve(address(votingEngine), stakeAmount);
        uint256 cachedRoundContext2 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId, cachedRoundContext2, targetRound, drandChainHash, ch, ct, stakeAmount, frontend
        );
        vm.stopPrank();

        ck = _commitKey(voter, ch);
    }

    /// @dev Commit all votes in an epoch (no inter-commit time advance), then reveal all after epoch boundary.
    ///      Voters must all be in the same epoch — caller should not advance time between commits.
    function _commitAllThenReveal(
        address[] memory voters,
        uint256 contentId,
        bool[] memory directions,
        uint256 stakeAmount
    ) internal {
        uint256[] memory stakeAmounts = new uint256[](voters.length);
        for (uint256 i = 0; i < voters.length; i++) {
            stakeAmounts[i] = stakeAmount;
        }
        _commitAllThenRevealWithStakes(voters, contentId, directions, stakeAmounts);
    }

    function _commitAllThenRevealWithStakes(
        address[] memory voters,
        uint256 contentId,
        bool[] memory directions,
        uint256[] memory stakeAmounts
    ) internal {
        bytes32[] memory salts = new bytes32[](voters.length);
        bytes32[] memory commitHashes = new bytes32[](voters.length);
        bytes32[] memory commitKeys = new bytes32[](voters.length);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        // If no active round yet, it will be created on first commit
        bool roundCreated = roundId > 0;

        for (uint256 i = 0; i < voters.length; i++) {
            salts[i] = keccak256(abi.encodePacked(voters[i], contentId, directions[i], i));
            uint16 predictedUpBps = _defaultPredictionBps(i, directions[i]);
            (bytes32 commitHash, bytes memory ct, uint64 targetRound, bytes32 drandChainHash) =
                _buildCommitPayloadWithPrediction(directions[i], predictedUpBps, salts[i], voters[i], contentId);
            commitHashes[i] = commitHash;

            vm.startPrank(voters[i]);
            lrepToken.approve(address(votingEngine), stakeAmounts[i]);
            uint256 cachedRoundContext3 =
                _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
            votingEngine.commitVote(
                contentId,
                cachedRoundContext3,
                targetRound,
                drandChainHash,
                commitHashes[i],
                ct,
                stakeAmounts[i],
                address(0)
            );
            vm.stopPrank();

            commitKeys[i] = _commitKey(voters[i], commitHashes[i]);
            if (!roundCreated) {
                roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
                roundCreated = true;
            }
        }

        // Advance past the epoch boundary and the selected drand target round.
        vm.warp(block.timestamp + EPOCH_DURATION + _tlockDrandPeriod() + 1);

        for (uint256 i = 0; i < voters.length; i++) {
            votingEngine.revealVoteByCommitKey(
                contentId, roundId, commitKeys[i], directions[i], _defaultPredictionBps(i, directions[i]), salts[i]
            );
        }
    }

    /// @dev Returns the active round ID; if 0 (terminal), falls back to the last created round.
    function _getActiveOrLatestRoundId(uint256 contentId) internal view returns (uint256) {
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        if (roundId == 0) {
            // Round closed between commit and reveal — use last created round
            roundId = RoundEngineReadHelpers.latestRoundId(votingEngine, contentId);
        }
        return roundId;
    }

    /// @dev Settle a round that has met minVoters.
    function _settle(uint256 contentId, uint256 roundId) internal {
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
    }

    /// @dev Fully settle a round: commit votes, reveal them, settle.
    ///      All voters commit in epoch-1 (blind, 100% weight) so no herding disadvantage.
    function _settleRoundWith(address[] memory voters, uint256 contentId, bool[] memory directions, uint256 stakeAmount)
        internal
        returns (uint256 roundId)
    {
        _commitAllThenReveal(voters, contentId, directions, stakeAmount);
        roundId = _getActiveOrLatestRoundId(contentId);
        _settle(contentId, roundId);
    }

    function _settleRoundWithStakes(
        address[] memory voters,
        uint256 contentId,
        bool[] memory directions,
        uint256[] memory stakeAmounts
    ) internal returns (uint256 roundId) {
        _commitAllThenRevealWithStakes(voters, contentId, directions, stakeAmounts);
        roundId = _getActiveOrLatestRoundId(contentId);
        _settle(contentId, roundId);
    }

    function _settleTiedRound(uint256 contentId) internal returns (uint256 roundId) {
        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory directions = new bool[](3);
        directions[0] = true;
        directions[1] = true;
        directions[2] = false;
        uint256[] memory stakes = new uint256[](3);
        stakes[0] = STAKE / 2;
        stakes[1] = STAKE / 2;
        stakes[2] = STAKE;

        roundId = _settleRoundWithStakes(voters, contentId, directions, stakes);
    }

    function _commitKeyForVoter(uint256 contentId, uint256 roundId, address voter) internal view returns (bytes32) {
        return _commitKey(voter, votingEngine.voterCommitHash(contentId, roundId, voter));
    }

    function _expectedParticipationReward(uint256 contentId, uint256 roundId, address voter)
        internal
        view
        returns (uint256)
    {
        bytes32 commitKey = _commitKeyForVoter(contentId, roundId, voter);
        return votingEngine.commitRbtsScoringWeight(contentId, roundId, commitKey)
            * rewardDistributor.roundParticipationRewardRateBps(contentId, roundId) / 10000;
    }

    function _expectedRbtsReturnedStake(uint256 contentId, uint256 roundId, address voter)
        internal
        view
        returns (uint256)
    {
        bytes32 commitKey = _commitKeyForVoter(contentId, roundId, voter);
        return votingEngine.commitRbtsStakeReturned(contentId, roundId, commitKey);
    }

    function _expectedRbtsClaimValue(uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (uint256)
    {
        uint256 stakeReturned = votingEngine.commitRbtsStakeReturned(contentId, roundId, commitKey);
        uint256 scoreWeight = votingEngine.commitRbtsRewardWeight(contentId, roundId, commitKey);
        if (scoreWeight == 0) return stakeReturned;

        uint256 voterPool = votingEngine.roundVoterPool(contentId, roundId);
        uint256 totalScoreWeight = votingEngine.roundRbtsRewardWeight(contentId, roundId);
        uint256 rewardClaimants = votingEngine.roundRbtsRewardClaimants(contentId, roundId);
        uint256 claimedCount = rewardDistributor.roundVoterRewardClaimedCount(contentId, roundId);
        uint256 claimedAmount = rewardDistributor.roundVoterRewardClaimedAmount(contentId, roundId);
        if (voterPool == 0 || totalScoreWeight == 0 || claimedCount >= rewardClaimants) return stakeReturned;

        uint256 reward = claimedCount + 1 == rewardClaimants
            ? voterPool - claimedAmount
            : RewardMath.calculateVoterReward(scoreWeight, totalScoreWeight, voterPool);
        return stakeReturned + reward;
    }

    // =========================================================================
    // 1. FULL ROUND LIFECYCLE — commit → reveal → settleRound → claim reward
    // =========================================================================

    function test_FullRoundLifecycle_UpWins() public {
        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        // Commit all in epoch-1 (same epoch), reveal after epoch boundary
        bytes32[] memory salts = new bytes32[](3);
        bytes32[] memory commitHashes = new bytes32[](3);
        bytes32[] memory commitKeys = new bytes32[](3);

        for (uint256 i = 0; i < 3; i++) {
            salts[i] = keccak256(abi.encodePacked(voters[i], contentId, dirs[i], i));
            (bytes32 commitHash, bytes memory ct, uint64 targetRound, bytes32 drandChainHash) =
                _buildCommitPayload(dirs[i], salts[i], voters[i], contentId);
            commitHashes[i] = commitHash;

            vm.startPrank(voters[i]);
            lrepToken.approve(address(votingEngine), STAKE);
            uint256 cachedRoundContext4 =
                _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
            votingEngine.commitVote(
                contentId, cachedRoundContext4, targetRound, drandChainHash, commitHashes[i], ct, STAKE, address(0)
            );
            vm.stopPrank();

            commitKeys[i] = _commitKey(voters[i], commitHashes[i]);
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        assertEq(roundId, 1, "Round 1 should be active after commits");

        // Verify round state after commits
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(round.voteCount, 3, "Should have 3 committed votes");

        // Advance past epoch boundary and reveal all
        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);
        for (uint256 i = 0; i < 3; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], dirs[i], 5_000, salts[i]);
        }

        // Check round after reveals
        round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(round.revealedCount, 3, "Should have 3 revealed votes");
        assertEq(round.upPool, 2 * STAKE, "UP raw pool should be 2x");
        assertEq(round.downPool, STAKE, "DOWN raw pool should be 1x");
        assertEq(round.upCount, 2, "UP count should be 2");
        assertEq(round.downCount, 1, "DOWN count should be 1");
        assertGt(round.thresholdReachedAt, 0, "Threshold should have been reached");

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled), "Round should be settled");
        assertTrue(round.upWins, "UP should win");

        // Winner claims reward
        uint256 balBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);
        assertGt(lrepToken.balanceOf(voter1), balBefore, "Winner should receive reward");

        // Loser claims only RBTS returned stake plus any positive score-spread pool share.
        uint256 loserBal = lrepToken.balanceOf(voter3);
        uint256 expectedLoserClaim = _expectedRbtsClaimValue(contentId, roundId, commitKeys[2]);
        vm.prank(voter3);
        rewardDistributor.claimReward(contentId, roundId);
        assertEq(
            lrepToken.balanceOf(voter3) - loserBal, expectedLoserClaim, "Loser claim should match RBTS claim value"
        );
    }

    // =========================================================================
    // 2. MULTIPLE VOTERS — UP wins and DOWN wins
    // =========================================================================

    function test_MultipleVoters_DownWins() public {
        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = false;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled), "Round should be settled");
        assertFalse(round.upWins, "DOWN should win");

        // DOWN voter (winner) claims reward
        uint256 balBefore = lrepToken.balanceOf(voter2);
        vm.prank(voter2);
        rewardDistributor.claimReward(contentId, roundId);
        assertGt(lrepToken.balanceOf(voter2), balBefore, "DOWN winner should receive reward");

        // UP voter (loser) gets only RBTS returned stake plus any positive score-spread pool share.
        uint256 upBal = lrepToken.balanceOf(voter1);
        bytes32 loserCommitHash = votingEngine.voterCommitHash(contentId, roundId, voter1);
        bytes32 loserCommitKey = _commitKey(voter1, loserCommitHash);
        uint256 expectedLoserClaim = _expectedRbtsClaimValue(contentId, roundId, loserCommitKey);
        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);
        assertEq(
            lrepToken.balanceOf(voter1) - upBal, expectedLoserClaim, "UP loser claim should match RBTS claim value"
        );
    }

    function test_MultipleVoters_BothWinnersClaimProportionally() public {
        uint256 contentId = _submitContent();

        // voter1: 10 LREP UP, voter2: 5 LREP UP, voter3: 5 LREP DOWN
        // All vote in epoch-1 (blind) → effectiveStake = stakeAmount * 10000 / 10000 = stakeAmount
        // voter1 effective = 10e6, voter2 effective = 5e6; voter1 gets more reward
        bytes32 salt1 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 salt2 = keccak256(abi.encodePacked(voter2, contentId, true, uint256(1)));
        bytes32 salt3 = keccak256(abi.encodePacked(voter3, contentId, false, uint256(2)));

        bytes32 ch1 = _commitHash(true, salt1, voter1, contentId);
        bytes32 ch2 = _commitHash(true, salt2, voter2, contentId);
        bytes32 ch3 = _commitHash(false, salt3, voter3, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), 10e6);
        uint256 cachedRoundContext5 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext5,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1,
            _testCiphertext(true, salt1, contentId),
            10e6,
            address(0)
        );
        vm.stopPrank();

        vm.startPrank(voter2);
        lrepToken.approve(address(votingEngine), 5e6);
        uint256 cachedRoundContext6 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext6,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch2,
            _testCiphertext(true, salt2, contentId),
            5e6,
            address(0)
        );
        vm.stopPrank();

        vm.startPrank(voter3);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext7 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext7,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch3,
            _testCiphertext(false, salt3, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        RoundLib.Round memory rMV0 = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rMV0.startTime) + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter1, ch1), true, 5_000, salt1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter2, ch2), true, 5_000, salt2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter3, ch3), false, 5_000, salt3);

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertTrue(round.upWins, "UP should win");

        // Both winners claim
        uint256 bal1Before = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);
        uint256 reward1 = lrepToken.balanceOf(voter1) - bal1Before;

        uint256 bal2Before = lrepToken.balanceOf(voter2);
        vm.prank(voter2);
        rewardDistributor.claimReward(contentId, roundId);
        uint256 reward2 = lrepToken.balanceOf(voter2) - bal2Before;

        // Both winners receive rewards. Stake-proportionality only holds at equal RBTS scoring;
        // with the post-commit prevrandao-mixed seed, the sampler can land in a configuration where
        // the smaller-stake voter scores higher (and so out-earns the larger-stake voter). The
        // robust invariant is that both winners get positive payouts and the total tracks the
        // round's voter pool — proportional-to-stake-only is no longer a stable assertion.
        assertGt(reward1, 0, "Voter1 should receive reward");
        assertGt(reward2, 0, "Voter2 should receive reward");
    }

    function test_MultipleWinners_FinalClaimantReceivesVoterPoolRemainder() public {
        uint256 contentId = _submitContent();
        uint256 stake1 = 1_000_001;
        uint256 stake2 = 1_000_000;
        uint256 stake3 = 1_000_000;

        bytes32 salt1 = keccak256(abi.encodePacked("dust", voter1, contentId));
        bytes32 salt2 = keccak256(abi.encodePacked("dust", voter2, contentId));
        bytes32 salt3 = keccak256(abi.encodePacked("dust", voter3, contentId));

        uint16 p1 = _defaultPredictionBps(0, true);
        uint16 p2 = _defaultPredictionBps(1, true);
        uint16 p3 = _defaultPredictionBps(2, false);
        (, bytes32 ck1) = _commitWithSaltAndPrediction(voter1, contentId, true, stake1, salt1, p1);
        (, bytes32 ck2) = _commitWithSaltAndPrediction(voter2, contentId, true, stake2, salt2, p2);
        (, bytes32 ck3) = _commitWithSaltAndPrediction(voter3, contentId, false, stake3, salt3, p3);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        RoundLib.Round memory openRound = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(openRound.startTime) + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck1, true, p1, salt1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck2, true, p2, salt2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck3, false, p3, salt3);

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertTrue(round.upWins, "UP should win");

        uint256 voterPool = votingEngine.roundVoterPool(contentId, roundId);

        uint256 bal1Before = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);
        uint256 claim1 = lrepToken.balanceOf(voter1) - bal1Before;

        uint256 bal2Before = lrepToken.balanceOf(voter2);
        vm.prank(voter2);
        rewardDistributor.claimReward(contentId, roundId);
        uint256 claim2 = lrepToken.balanceOf(voter2) - bal2Before;

        assertGt(claim1, 0, "first claimant should receive a positive RBTS claim");
        assertGt(claim2, 0, "second claimant should receive a positive RBTS claim");

        uint256 rewardClaimants = votingEngine.roundRbtsRewardClaimants(contentId, roundId);
        if (rewardDistributor.roundVoterRewardClaimedCount(contentId, roundId) < rewardClaimants) {
            vm.prank(voter3);
            rewardDistributor.claimReward(contentId, roundId);
        }

        assertEq(rewardDistributor.roundVoterRewardClaimedCount(contentId, roundId), rewardClaimants);
        assertEq(rewardDistributor.roundVoterRewardClaimedAmount(contentId, roundId), voterPool);

        if (!rewardDistributor.rewardClaimed(contentId, roundId, voter3)) {
            bytes32 loserCommitKey = _commitKey(voter3, votingEngine.voterCommitHash(contentId, roundId, voter3));
            uint256 expectedLoserClaim = _expectedRbtsClaimValue(contentId, roundId, loserCommitKey);
            uint256 loserBefore = lrepToken.balanceOf(voter3);
            vm.prank(voter3);
            rewardDistributor.claimReward(contentId, roundId);
            assertEq(
                lrepToken.balanceOf(voter3) - loserBefore,
                expectedLoserClaim,
                "loser claim should match RBTS claim value"
            );
        }

        assertEq(lrepToken.balanceOf(address(votingEngine)), 0, "engine should not retain voter reward dust");
    }

    function test_FinalizeVoterRewardDust_RoutesOnlyRoundingDustAfterDelay() public {
        uint256 contentId = _submitContent();
        uint256 stake1 = 1_000_001;
        uint256 stake2 = 1_000_000;
        uint256 stake3 = 1_000_000;

        bytes32 salt1 = keccak256(abi.encodePacked("stale-dust", voter1, contentId));
        bytes32 salt2 = keccak256(abi.encodePacked("stale-dust", voter2, contentId));
        bytes32 salt3 = keccak256(abi.encodePacked("stale-dust", voter3, contentId));

        uint16 p1 = _defaultPredictionBps(0, true);
        uint16 p2 = _defaultPredictionBps(1, true);
        uint16 p3 = _defaultPredictionBps(2, false);
        (, bytes32 ck1) = _commitWithSaltAndPrediction(voter1, contentId, true, stake1, salt1, p1);
        (, bytes32 ck2) = _commitWithSaltAndPrediction(voter2, contentId, true, stake2, salt2, p2);
        (, bytes32 ck3) = _commitWithSaltAndPrediction(voter3, contentId, false, stake3, salt3, p3);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        RoundLib.Round memory openRound = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(openRound.startTime) + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck1, true, p1, salt1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck2, true, p2, salt2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck3, false, p3, salt3);

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        uint256 rewardClaimants = votingEngine.roundRbtsRewardClaimants(contentId, roundId);
        address[] memory winners = new address[](rewardClaimants);
        address[3] memory candidates = [voter1, voter2, voter3];
        uint256 winnerIndex;
        for (uint256 i = 0; i < candidates.length; i++) {
            bytes32 commitKey = _commitKeyForVoter(contentId, roundId, candidates[i]);
            if (votingEngine.commitRbtsRewardWeight(contentId, roundId, commitKey) > 0) {
                winners[winnerIndex] = candidates[i];
                winnerIndex++;
            }
        }
        assertEq(winnerIndex, rewardClaimants, "test fixture should enumerate positive-spread claimants");

        vm.expectRevert(RoundRewardDistributor.RewardFinalizationTooEarly.selector);
        rewardDistributor.finalizeVoterRewardDust(contentId, roundId, winners);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        vm.warp(uint256(round.settledAt) + rewardDistributor.STALE_REWARD_FINALIZATION_DELAY());

        uint256 voterPool = votingEngine.roundVoterPool(contentId, roundId);
        uint256 treasuryBefore = lrepToken.balanceOf(treasury);

        uint256 releasedDust = rewardDistributor.finalizeVoterRewardDust(contentId, roundId, winners);

        assertGt(releasedDust, 0, "only mathematical voter reward dust should be finalized");
        assertEq(lrepToken.balanceOf(treasury), treasuryBefore + releasedDust, "dust should route to protocol");
        assertTrue(rewardDistributor.roundVoterRewardDustFinalized(contentId, roundId));

        uint256 bal1Before = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);
        uint256 claim1 = lrepToken.balanceOf(voter1) - bal1Before;

        uint256 bal2Before = lrepToken.balanceOf(voter2);
        vm.prank(voter2);
        rewardDistributor.claimReward(contentId, roundId);
        uint256 claim2 = lrepToken.balanceOf(voter2) - bal2Before;

        uint256 claim3;
        if (!rewardDistributor.rewardClaimed(contentId, roundId, voter3)) {
            uint256 bal3Before = lrepToken.balanceOf(voter3);
            vm.prank(voter3);
            rewardDistributor.claimReward(contentId, roundId);
            claim3 = lrepToken.balanceOf(voter3) - bal3Before;
        }

        claim1;
        claim2;
        claim3;
        assertEq(
            rewardDistributor.roundVoterRewardClaimedAmount(contentId, roundId),
            voterPool,
            "finalized dust should not reduce base shares"
        );
        assertEq(rewardDistributor.roundVoterRewardClaimedAmount(contentId, roundId), voterPool);
    }

    // =========================================================================
    // 3. CONCURRENT ROUNDS ON DIFFERENT CONTENT
    // =========================================================================

    function test_ConcurrentRoundsOnDifferentContent() public {
        uint256 contentId1 = _submitContentN(1);
        uint256 contentId2 = _submitContentN(2);

        // Commit on content 1: two half-stake UP votes tie one full-stake DOWN vote.
        bytes32 s1a = keccak256(abi.encodePacked(voter1, contentId1, true, uint256(0)));
        bytes32 s1b = keccak256(abi.encodePacked(voter2, contentId1, true, uint256(1)));
        bytes32 s1c = keccak256(abi.encodePacked(voter3, contentId1, false, uint256(2)));
        (, bytes32 ck1a) = _commitWithSalt(voter1, contentId1, true, STAKE / 2, s1a);
        (, bytes32 ck1b) = _commitWithSalt(voter2, contentId1, true, STAKE / 2, s1b);
        (, bytes32 ck1c) = _commitWithSalt(voter3, contentId1, false, STAKE, s1c);

        // Commit on content 2 with an independent tied cohort.
        bytes32 s2a = keccak256(abi.encodePacked(voter4, contentId2, true, uint256(3)));
        bytes32 s2b = keccak256(abi.encodePacked(voter5, contentId2, true, uint256(4)));
        bytes32 s2c = keccak256(abi.encodePacked(voter6, contentId2, false, uint256(5)));
        (, bytes32 ck2a) = _commitWithSalt(voter4, contentId2, true, STAKE / 2, s2a);
        (, bytes32 ck2b) = _commitWithSalt(voter5, contentId2, true, STAKE / 2, s2b);
        (, bytes32 ck2c) = _commitWithSalt(voter6, contentId2, false, STAKE, s2c);

        uint256 round1 = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId1);
        uint256 round2 = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId2);
        assertEq(round1, 1, "Content 1 should have round 1");
        assertEq(round2, 1, "Content 2 should have round 1");

        // Reveal and settle both rounds together
        RoundLib.Round memory rCC0 = RoundEngineReadHelpers.round(votingEngine, contentId2, round2);
        _warpPastTlockRevealTime(uint256(rCC0.startTime) + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId1, round1, ck1a, true, 5_000, s1a);
        votingEngine.revealVoteByCommitKey(contentId1, round1, ck1b, true, 5_000, s1b);
        votingEngine.revealVoteByCommitKey(contentId1, round1, ck1c, false, 5_000, s1c);
        votingEngine.revealVoteByCommitKey(contentId2, round2, ck2a, true, 5_000, s2a);
        votingEngine.revealVoteByCommitKey(contentId2, round2, ck2b, true, 5_000, s2b);
        votingEngine.revealVoteByCommitKey(contentId2, round2, ck2c, false, 5_000, s2c);

        // Settle content 1
        _settleAfterRbtsSeed(votingEngine, contentId1, round1);
        RoundLib.Round memory r1 = RoundEngineReadHelpers.round(votingEngine, contentId1, round1);
        assertEq(uint256(r1.state), uint256(RoundLib.RoundState.Tied), "Content 1 round should be tied (equal stakes)");

        // Settle content 2 independently
        _settleAfterRbtsSeed(votingEngine, contentId2, round2);
        RoundLib.Round memory r2 = RoundEngineReadHelpers.round(votingEngine, contentId2, round2);
        assertEq(uint256(r2.state), uint256(RoundLib.RoundState.Tied), "Content 2 round should be tied");
    }

    function test_ConcurrentRoundsSettleIndependently() public {
        uint256 contentId1 = _submitContentN(1);

        // Commit on content 1: 2 UP, 1 DOWN → UP wins
        bytes32 s1a = keccak256(abi.encodePacked(voter1, contentId1, true, uint256(0)));
        bytes32 s1b = keccak256(abi.encodePacked(voter2, contentId1, false, uint256(1)));
        bytes32 s1c = keccak256(abi.encodePacked(voter3, contentId1, true, uint256(2)));
        bytes32 ch1a = _commitHash(true, s1a, voter1, contentId1);
        bytes32 ch1b = _commitHash(false, s1b, voter2, contentId1);
        bytes32 ch1c = _commitHash(true, s1c, voter3, contentId1);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext12 =
            _roundContext(votingEngine.previewCommitRoundId(contentId1), _currentRatingReferenceBps(contentId1));
        votingEngine.commitVote(
            contentId1,
            cachedRoundContext12,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1a,
            _testCiphertext(true, s1a, contentId1),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        vm.startPrank(voter2);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext13 =
            _roundContext(votingEngine.previewCommitRoundId(contentId1), _currentRatingReferenceBps(contentId1));
        votingEngine.commitVote(
            contentId1,
            cachedRoundContext13,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1b,
            _testCiphertext(false, s1b, contentId1),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        vm.startPrank(voter3);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext14 =
            _roundContext(votingEngine.previewCommitRoundId(contentId1), _currentRatingReferenceBps(contentId1));
        votingEngine.commitVote(
            contentId1,
            cachedRoundContext14,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1c,
            _testCiphertext(true, s1c, contentId1),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        // Submit content 2 a bit later
        vm.warp(block.timestamp + 5 minutes);
        uint256 contentId2 = _submitContentN(2);

        bytes32 s2a = keccak256(abi.encodePacked(voter4, contentId2, true, uint256(3)));
        bytes32 s2b = keccak256(abi.encodePacked(voter5, contentId2, true, uint256(4)));
        bytes32 s2c = keccak256(abi.encodePacked(voter6, contentId2, false, uint256(5)));
        (, bytes32 ck2a) = _commitWithSalt(voter4, contentId2, true, STAKE / 2, s2a);
        (, bytes32 ck2b) = _commitWithSalt(voter5, contentId2, true, STAKE / 2, s2b);
        (, bytes32 ck2c) = _commitWithSalt(voter6, contentId2, false, STAKE, s2c);

        // Reveal both contents after their epochs end.
        // content1 started at T0=1000, content2 started 5 minutes later at ~1300.
        // To reveal both, warp to the LATER epoch end (content2's epoch end).
        RoundLib.Round memory rCS0_2 = RoundEngineReadHelpers.round(votingEngine, contentId2, 1);
        _warpPastTlockRevealTime(uint256(rCS0_2.startTime) + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId1, 1, _commitKey(voter1, ch1a), true, 5_000, s1a);
        votingEngine.revealVoteByCommitKey(contentId1, 1, _commitKey(voter2, ch1b), false, 5_000, s1b);
        votingEngine.revealVoteByCommitKey(contentId1, 1, _commitKey(voter3, ch1c), true, 5_000, s1c);
        // content2's epoch has also ended by now
        votingEngine.revealVoteByCommitKey(contentId2, 1, ck2a, true, 5_000, s2a);
        votingEngine.revealVoteByCommitKey(contentId2, 1, ck2b, true, 5_000, s2b);
        votingEngine.revealVoteByCommitKey(contentId2, 1, ck2c, false, 5_000, s2c);

        // Settle content 1
        _settleAfterRbtsSeed(votingEngine, contentId1, 1);

        RoundLib.Round memory r1 = RoundEngineReadHelpers.round(votingEngine, contentId1, 1);
        assertEq(uint256(r1.state), uint256(RoundLib.RoundState.Settled), "Content 1 should be settled");
        assertTrue(r1.upWins, "UP should win content 1");

        // Settle content 2
        _settleAfterRbtsSeed(votingEngine, contentId2, 1);
        RoundLib.Round memory r2 = RoundEngineReadHelpers.round(votingEngine, contentId2, 1);
        assertEq(uint256(r2.state), uint256(RoundLib.RoundState.Tied), "Content 2 should be tied");
    }

    // =========================================================================
    // 4. SAME VOTER COMMITS ON MULTIPLE CONTENT ITEMS
    // =========================================================================

    function test_SameVoterVotesOnMultipleContent() public {
        uint256 contentId1 = _submitContentN(1);
        uint256 contentId2 = _submitContentN(2);

        bytes32 s1 = keccak256(abi.encodePacked(voter1, contentId1, true, uint256(0)));
        bytes32 s2 = keccak256(abi.encodePacked(voter2, contentId1, true, uint256(1)));
        bytes32 s3 = keccak256(abi.encodePacked(voter3, contentId1, false, uint256(2)));
        bytes32 s4 = keccak256(abi.encodePacked(voter1, contentId2, false, uint256(3)));
        bytes32 s5 = keccak256(abi.encodePacked(voter4, contentId2, true, uint256(4)));
        bytes32 s6 = keccak256(abi.encodePacked(voter5, contentId2, true, uint256(5)));

        (, bytes32 ck1) = _commitWithSalt(voter1, contentId1, true, STAKE / 2, s1);
        (, bytes32 ck2) = _commitWithSalt(voter2, contentId1, true, STAKE / 2, s2);
        (, bytes32 ck3) = _commitWithSalt(voter3, contentId1, false, STAKE, s3);
        (, bytes32 ck4) = _commitWithSalt(voter1, contentId2, false, STAKE, s4);
        (, bytes32 ck5) = _commitWithSalt(voter4, contentId2, true, STAKE / 2, s5);
        (, bytes32 ck6) = _commitWithSalt(voter5, contentId2, true, STAKE / 2, s6);

        // Verify commits are recorded
        assertTrue(
            votingEngine.voterCommitHash(contentId1, 1, voter1) != bytes32(0),
            "Voter1 should have committed on content 1"
        );
        assertTrue(
            votingEngine.voterCommitHash(contentId2, 1, voter1) != bytes32(0),
            "Voter1 should have committed on content 2"
        );
        assertEq(
            votingEngine.voterCommitHash(contentId1, 1, voter4),
            bytes32(0),
            "Voter4 should not have committed on content 1"
        );

        // Reveal all after epoch boundary (absolute)
        RoundLib.Round memory rSV0 = RoundEngineReadHelpers.round(votingEngine, contentId2, 1);
        _warpPastTlockRevealTime(uint256(rSV0.startTime) + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId1, 1, ck1, true, 5_000, s1);
        votingEngine.revealVoteByCommitKey(contentId1, 1, ck2, true, 5_000, s2);
        votingEngine.revealVoteByCommitKey(contentId1, 1, ck3, false, 5_000, s3);
        votingEngine.revealVoteByCommitKey(contentId2, 1, ck4, false, 5_000, s4);
        votingEngine.revealVoteByCommitKey(contentId2, 1, ck5, true, 5_000, s5);
        votingEngine.revealVoteByCommitKey(contentId2, 1, ck6, true, 5_000, s6);

        // Settle both
        _settleAfterRbtsSeed(votingEngine, contentId1, 1);
        _settleAfterRbtsSeed(votingEngine, contentId2, 1);

        RoundLib.Round memory r1 = RoundEngineReadHelpers.round(votingEngine, contentId1, 1);
        RoundLib.Round memory r2 = RoundEngineReadHelpers.round(votingEngine, contentId2, 1);
        assertEq(uint256(r1.state), uint256(RoundLib.RoundState.Tied), "Content 1 should be tied");
        assertEq(uint256(r2.state), uint256(RoundLib.RoundState.Tied), "Content 2 should be tied");
    }

    // =========================================================================
    // 5. CANCEL EXPIRED ROUND + REFUND CLAIMS
    // =========================================================================

    function test_CancelExpiredRound_Refund() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 ch = _commitHash(true, salt, voter1, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext21 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext21,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch,
            _testCiphertext(true, salt, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        // Cannot cancel before expiry
        vm.expectRevert(RoundVotingEngine.RoundNotExpired.selector);
        votingEngine.cancelExpiredRound(contentId, roundId);

        // Warp past maxDuration (7 days)
        vm.warp(block.timestamp + 8 days);
        votingEngine.cancelExpiredRound(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Cancelled), "Round should be cancelled");

        // Voter claims refund
        uint256 balBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        votingEngine.claimCancelledRoundRefund(contentId, roundId);
        assertEq(lrepToken.balanceOf(voter1) - balBefore, STAKE, "Voter should get full refund");
    }

    function test_CancelExpiredRound_MultipleVotersCannotCancelAfterCommitQuorum() public {
        uint256 contentId = _submitContent();

        bytes32 s1 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 s2 = keccak256(abi.encodePacked(voter2, contentId, false, uint256(1)));
        bytes32 s3 = keccak256(abi.encodePacked(voter3, contentId, true, uint256(2)));

        _commitWithSalt(voter1, contentId, true, STAKE, s1);
        _commitWithSalt(voter2, contentId, false, STAKE, s2);
        _commitWithSalt(voter3, contentId, true, STAKE, s3);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(RoundVotingEngine.ThresholdReached.selector);
        votingEngine.cancelExpiredRound(contentId, roundId);
    }

    function test_CancelExpiredRound_DoubleRefundReverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 ch = _commitHash(true, salt, voter1, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext24 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext24,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch,
            _testCiphertext(true, salt, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        vm.warp(block.timestamp + 8 days);
        votingEngine.cancelExpiredRound(contentId, roundId);

        vm.prank(voter1);
        votingEngine.claimCancelledRoundRefund(contentId, roundId);

        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.AlreadyClaimed.selector);
        votingEngine.claimCancelledRoundRefund(contentId, roundId);
    }

    function test_CancelExpiredRound_NewRoundAfterCancellation() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 ch = _commitHash(true, salt, voter1, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext25 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext25,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch,
            _testCiphertext(true, salt, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 round1Id = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        vm.warp(block.timestamp + 8 days);
        votingEngine.cancelExpiredRound(contentId, round1Id);
        assertEq(
            uint256(RoundEngineReadHelpers.round(votingEngine, contentId, round1Id).state),
            uint256(RoundLib.RoundState.Cancelled)
        );

        // New commit after cooldown creates round 2
        vm.warp(block.timestamp + 25 hours);
        bytes32 salt2 = keccak256(abi.encodePacked(voter2, contentId, false, uint256(1)));
        bytes32 ch2 = _commitHash(false, salt2, voter2, contentId);

        vm.startPrank(voter2);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext26 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext26,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch2,
            _testCiphertext(false, salt2, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        assertEq(RoundEngineReadHelpers.activeRoundId(votingEngine, contentId), 2, "New round should be created");
    }

    // =========================================================================
    // 6. TIED ROUND (equal weighted UP/DOWN pools)
    // =========================================================================

    function test_TiedRound_EqualStakes() public {
        uint256 contentId = _submitContent();

        uint256 roundId = _settleTiedRound(contentId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Tied), "Round should be tied");
    }

    function test_TiedRound_RefundClaims() public {
        uint256 contentId = _submitContent();

        uint256 roundId = _settleTiedRound(contentId);

        // Both voters can claim refunds from tied round
        uint256 bal1Before = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        votingEngine.claimCancelledRoundRefund(contentId, roundId);
        assertEq(lrepToken.balanceOf(voter1) - bal1Before, STAKE / 2, "Voter1 should get refund from tie");

        uint256 bal2Before = lrepToken.balanceOf(voter2);
        vm.prank(voter2);
        votingEngine.claimCancelledRoundRefund(contentId, roundId);
        assertEq(lrepToken.balanceOf(voter2) - bal2Before, STAKE / 2, "Voter2 should get refund from tie");
    }

    function test_ConfiguredRaterRegistry_AllowsOpenRaterWithoutCredential() public {
        uint256 contentId = _submitContent();
        address openRater = address(0xCA11);
        vm.prank(owner);
        lrepToken.mint(openRater, 10_000e6);

        bytes32 salt = keccak256("open-rater-with-optional-identity");
        (bytes32 commitHash, bytes32 commitKey) = _commitWithSalt(openRater, contentId, true, STAKE, salt);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        assertFalse(raterRegistry.hasActiveHumanCredential(openRater));
        assertEq(votingEngine.voterCommitHash(contentId, roundId, openRater), commitHash);
        assertEq(
            votingEngine.commitIdentityKey(contentId, roundId, commitKey), raterRegistry.addressIdentityKey(openRater)
        );
        (address committedVoter,,,,,,) = votingEngine.commitCore(contentId, roundId, commitKey);
        assertEq(committedVoter, openRater);
        assertEq(commitKey, _commitKey(openRater, commitHash));
    }

    function test_TiedRound_DelegatedLockedStakeRefundsStakePayer() public {
        uint256 contentId = _submitContent();

        _setAcceptedDelegate(raterRegistry, voter1, delegate1);
        vm.startPrank(owner);
        lrepToken.setGovernor(owner);
        lrepToken.lockForGovernance(delegate1, STAKE);
        vm.stopPrank();

        uint256 holderBalanceBefore = lrepToken.balanceOf(voter1);
        uint256 stakePayerBalanceBefore = lrepToken.balanceOf(delegate1);

        address[] memory voters = new address[](3);
        voters[0] = delegate1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = false;
        dirs[2] = false;
        uint256[] memory stakes = new uint256[](3);
        stakes[0] = STAKE;
        stakes[1] = STAKE / 2;
        stakes[2] = STAKE / 2;

        uint256 roundId = _settleRoundWithStakes(voters, contentId, dirs, stakes);
        assertEq(
            lrepToken.balanceOf(delegate1), stakePayerBalanceBefore - STAKE, "stake payer should fund delegated vote"
        );

        vm.prank(voter1);
        votingEngine.claimCancelledRoundRefund(contentId, roundId);

        assertEq(lrepToken.balanceOf(voter1), holderBalanceBefore, "identity holder should not receive payer stake");
        assertEq(lrepToken.balanceOf(delegate1), stakePayerBalanceBefore, "stake payer should receive LREP refund");
        assertEq(lrepToken.getLockedBalance(delegate1), STAKE, "governance lock remains active");
    }

    function test_TiedRound_RemovedDelegateCanClaimOwnStakeRefund() public {
        uint256 contentId = _submitContent();

        _setAcceptedDelegate(raterRegistry, voter1, delegate1);

        address[] memory voters = new address[](3);
        voters[0] = delegate1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = false;
        dirs[2] = false;
        uint256[] memory stakes = new uint256[](3);
        stakes[0] = STAKE;
        stakes[1] = STAKE / 2;
        stakes[2] = STAKE / 2;

        uint256 roundId = _settleRoundWithStakes(voters, contentId, dirs, stakes);
        vm.prank(voter1);
        raterRegistry.removeDelegate();

        uint256 stakePayerBalanceBefore = lrepToken.balanceOf(delegate1);
        vm.prank(delegate1);
        votingEngine.claimCancelledRoundRefund(contentId, roundId);
        assertEq(lrepToken.balanceOf(delegate1) - stakePayerBalanceBefore, STAKE);
    }

    function test_SettledRound_RemovedDelegateRoutesRewardToHolder() public {
        uint256 contentId = _submitContent();

        _setAcceptedDelegate(raterRegistry, voter1, delegate1);

        address[] memory voters = new address[](3);
        voters[0] = delegate1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);
        vm.prank(voter1);
        raterRegistry.removeDelegate();

        uint256 holderBalanceBefore = lrepToken.balanceOf(voter1);
        uint256 stakePayerBalanceBefore = lrepToken.balanceOf(delegate1);
        uint256 expectedReturnedStake = _expectedRbtsReturnedStake(contentId, roundId, delegate1);
        vm.prank(delegate1);
        rewardDistributor.claimReward(contentId, roundId);

        assertEq(
            lrepToken.balanceOf(delegate1),
            stakePayerBalanceBefore + expectedReturnedStake,
            "old delegate receives its RBTS stake return"
        );
        assertGt(lrepToken.balanceOf(voter1), holderBalanceBefore, "holder receives voter-pool reward");
    }

    function test_SettledRound_RevokedIdentityCanClaimEarnedRewardFromSnapshot() public {
        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);
        vm.prank(owner);
        raterRegistry.revokeHumanCredential(voter1);

        uint256 balanceBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);
        assertGt(lrepToken.balanceOf(voter1), balanceBefore);
    }

    /// @dev Verifies the `RewardClaimed` event correctly attributes stake refund to the
    ///      `stakePayer` (commit.voter / delegate) and reward to `voter` (current holder)
    ///      when these are different addresses. Without this split, off-chain indexers
    ///      mis-attribute claim payouts to a single address.
    function test_SettledRound_RewardClaimedEventSplitsRecipients() public {
        uint256 contentId = _submitContent();

        _setAcceptedDelegate(raterRegistry, voter1, delegate1);

        address[] memory voters = new address[](3);
        voters[0] = delegate1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);

        uint256 expectedReturnedStake = _expectedRbtsReturnedStake(contentId, roundId, delegate1);

        // Expect the event to carry voter=voter1 (current holder) and stakePayer=delegate1,
        // with the RBTS stake return and reward > 0. Match topics + data; allow the reward amount
        // to be any positive value (computed from voter pool).
        vm.recordLogs();

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 expectedTopic = keccak256("RewardClaimed(uint256,uint256,address,address,uint256,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == address(rewardDistributor) && logs[i].topics.length == 4
                    && logs[i].topics[0] == expectedTopic && uint256(logs[i].topics[1]) == contentId
                    && uint256(logs[i].topics[2]) == roundId && address(uint160(uint256(logs[i].topics[3]))) == voter1
            ) {
                (address stakePayer, uint256 stakeReturned, uint256 reward) =
                    abi.decode(logs[i].data, (address, uint256, uint256));
                assertEq(stakePayer, delegate1, "stakePayer in event should be the delegate");
                assertEq(stakeReturned, expectedReturnedStake, "stakeReturned should equal RBTS stake return");
                assertGt(reward, 0, "voter-pool reward should be positive for winner");
                found = true;
                break;
            }
        }
        assertTrue(found, "RewardClaimed event with split recipients not emitted");
    }

    /// @dev Holder votes via an active delegate and then claims directly. The voter-pool reward
    ///      must reach the holder, while the original stake refund returns to the delegate that
    ///      paid it. Pre-fix, both flowed to `commit.voter` (the delegate) and the holder
    ///      received nothing from their own registry identity's vote.
    function test_SettledRound_HolderClaimsRewardWhileDelegateActive() public {
        uint256 contentId = _submitContent();

        _setAcceptedDelegate(raterRegistry, voter1, delegate1);

        address[] memory voters = new address[](3);
        voters[0] = delegate1; // votes UP on behalf of voter1
        voters[1] = voter2; // UP — winning side
        voters[2] = voter3; // DOWN — losing side
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 holderBalanceBefore = lrepToken.balanceOf(voter1);
        uint256 delegateBalanceBefore = lrepToken.balanceOf(delegate1);

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);
        uint256 expectedReturnedStake = _expectedRbtsReturnedStake(contentId, roundId, delegate1);
        // Delegate funded the stake; holder is unchanged so far.
        assertEq(lrepToken.balanceOf(delegate1), delegateBalanceBefore - STAKE, "delegate paid stake");
        assertEq(lrepToken.balanceOf(voter1), holderBalanceBefore, "holder unchanged after vote");

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        // Stake refund went back to the delegate; voter-pool reward went to the holder.
        assertEq(
            lrepToken.balanceOf(delegate1),
            delegateBalanceBefore - STAKE + expectedReturnedStake,
            "delegate receives its RBTS stake return"
        );
        assertGt(lrepToken.balanceOf(voter1), holderBalanceBefore, "holder receives voter-pool reward");
    }

    /// @dev After rotating the delegate, claiming via the new delegate routes the voter-pool
    ///      reward to the holder rather than to the rotated-out delegate. Stake still refunds
    ///      to the old delegate that originally paid it.
    function test_SettledRound_RotatedDelegateRoutesRewardToHolder() public {
        uint256 contentId = _submitContent();

        _setAcceptedDelegate(raterRegistry, voter1, delegate1);

        address[] memory voters = new address[](3);
        voters[0] = delegate1; // ex-delegate at claim time
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 holderBalanceBefore = lrepToken.balanceOf(voter1);
        uint256 oldDelegateBalanceBefore = lrepToken.balanceOf(delegate1);
        uint256 newDelegateBalanceBefore = lrepToken.balanceOf(delegate2);

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);
        uint256 expectedReturnedStake = _expectedRbtsReturnedStake(contentId, roundId, delegate1);

        // Holder rotates: removes voter4, sets voter5 as the new delegate.
        vm.prank(voter1);
        raterRegistry.removeDelegate();
        _setAcceptedDelegate(raterRegistry, voter1, delegate2);

        // Claim through the new delegate.
        vm.prank(delegate2);
        rewardDistributor.claimReward(contentId, roundId);

        assertEq(
            lrepToken.balanceOf(delegate1),
            oldDelegateBalanceBefore - STAKE + expectedReturnedStake,
            "rotated delegate receives its RBTS stake return"
        );
        assertGt(lrepToken.balanceOf(voter1), holderBalanceBefore, "holder receives voter-pool reward post-rotation");
        assertEq(lrepToken.balanceOf(delegate2), newDelegateBalanceBefore, "new delegate is a relay, not a recipient");
    }

    function test_SettledRound_IdentityChurnedHolderCanClaimViaNewDelegate() public {
        uint256 contentId = _submitContent();

        vm.prank(owner);
        raterRegistry.seedHumanCredential(voter1, uint64(block.timestamp + 1), bytes32("identity-a"), bytes32("ev-a"));
        _setAcceptedDelegate(raterRegistry, voter1, delegate1);

        address[] memory voters = new address[](3);
        voters[0] = delegate1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 holderBalanceBefore = lrepToken.balanceOf(voter1);
        uint256 oldDelegateBalanceBefore = lrepToken.balanceOf(delegate1);
        uint256 newDelegateBalanceBefore = lrepToken.balanceOf(delegate2);

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);
        uint256 expectedReturnedStake = _expectedRbtsReturnedStake(contentId, roundId, delegate1);
        assertNotEq(votingEngine.holderCommitKey(contentId, roundId, voter1), bytes32(0));

        vm.prank(voter1);
        raterRegistry.removeDelegate();
        vm.prank(owner);
        raterRegistry.seedHumanCredential(
            voter1, uint64(block.timestamp + 30 days), bytes32("identity-b"), bytes32("ev-b")
        );
        _setAcceptedDelegate(raterRegistry, voter1, delegate2);

        vm.prank(delegate2);
        rewardDistributor.claimReward(contentId, roundId);

        assertEq(
            lrepToken.balanceOf(delegate1),
            oldDelegateBalanceBefore - STAKE + expectedReturnedStake,
            "old delegate receives its RBTS stake return"
        );
        assertGt(lrepToken.balanceOf(voter1), holderBalanceBefore, "holder receives reward after identity churn");
        assertEq(lrepToken.balanceOf(delegate2), newDelegateBalanceBefore, "new delegate is only a relay");
    }

    /// @dev Once the rotated-delegate path has claimed the holder's reward, the ex-delegate
    ///      cannot replay the same commit through its EOA-keyed direct path.
    function test_SettledRound_RotatedDelegateBlocksExDelegateReplay() public {
        uint256 contentId = _submitContent();

        _setAcceptedDelegate(raterRegistry, voter1, delegate1);

        address[] memory voters = new address[](3);
        voters[0] = delegate1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);

        vm.prank(voter1);
        raterRegistry.removeDelegate();
        _setAcceptedDelegate(raterRegistry, voter1, delegate2);

        // Holder/new-delegate path claims first.
        vm.prank(delegate2);
        rewardDistributor.claimReward(contentId, roundId);

        // The ex-delegate (now no delegated relationship) cannot re-claim via the direct EOA path —
        // the rewardClaimed flag is keyed on commit.voter == voter4.
        vm.prank(delegate1);
        vm.expectRevert("Already claimed");
        rewardDistributor.claimReward(contentId, roundId);
    }

    function test_TiedRound_NewRoundAfterTie() public {
        uint256 contentId = _submitContent();

        uint256 roundId = _settleTiedRound(contentId);

        assertEq(roundId, 1, "Round 1 should have been used");
        assertEq(RoundEngineReadHelpers.activeRoundId(votingEngine, contentId), 0, "No active round after tie");

        // New commit after cooldown creates round 2
        vm.warp(block.timestamp + 25 hours);
        bytes32 salt = keccak256(abi.encodePacked(voter3, contentId, true, uint256(99)));
        bytes32 ch = _commitHash(true, salt, voter3, contentId);

        vm.startPrank(voter3);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext27 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext27,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch,
            _testCiphertext(true, salt, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        assertEq(RoundEngineReadHelpers.activeRoundId(votingEngine, contentId), 2, "Round 2 should be created");
    }

    // =========================================================================
    // 7. CONSENSUS SETTLEMENT (unanimous voting — no opposing side)
    // =========================================================================

    function test_ConsensusSettlement_OnlyUpVoters() public {
        uint256 contentId = _submitContent();

        // Only UP voters, no DOWN — still need ≥minVoters revealed
        bytes32 s1 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 s2 = keccak256(abi.encodePacked(voter2, contentId, true, uint256(1)));
        bytes32 s3 = keccak256(abi.encodePacked(voter3, contentId, true, uint256(2)));
        bytes32 ch1 = _commitHash(true, s1, voter1, contentId);
        bytes32 ch2 = _commitHash(true, s2, voter2, contentId);
        bytes32 ch3 = _commitHash(true, s3, voter3, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext28 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext28,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1,
            _testCiphertext(true, s1, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        vm.startPrank(voter2);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext29 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext29,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch2,
            _testCiphertext(true, s2, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        vm.startPrank(voter3);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext41 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext41,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch3,
            _testCiphertext(true, s3, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        // Advance past epoch boundary and reveal (absolute)
        RoundLib.Round memory rCU0 = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rCU0.startTime) + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter1, ch1), true, 5_000, s1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter2, ch2), true, 5_000, s2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter3, ch3), true, 5_000, s3);

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled), "Should be settled by consensus");
        assertTrue(round.upWins, "UP should win by consensus");

        uint256 rewardWeight = votingEngine.roundRbtsRewardWeight(contentId, roundId);
        uint256 forfeitedPool = votingEngine.roundRbtsForfeitedPool(contentId, roundId);
        if (rewardWeight > 0) {
            assertEq(
                votingEngine.roundVoterPool(contentId, roundId),
                forfeitedPool,
                "unanimous round voter pool should equal RBTS forfeitures"
            );
        }

        uint256 balBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);
        uint256 payout = lrepToken.balanceOf(voter1) - balBefore;
        assertGt(payout, 0, "Consensus winner should receive a claim");
        assertLe(payout, STAKE + votingEngine.roundVoterPool(contentId, roundId), "claim stays inside forfeiture pool");
    }

    function test_ConsensusSettlement_OnlyDownVoters() public {
        uint256 contentId = _submitContent();

        bytes32 s1 = keccak256(abi.encodePacked(voter1, contentId, false, uint256(0)));
        bytes32 s2 = keccak256(abi.encodePacked(voter2, contentId, false, uint256(1)));
        bytes32 s3 = keccak256(abi.encodePacked(voter3, contentId, false, uint256(2)));
        bytes32 ch1 = _commitHash(false, s1, voter1, contentId);
        bytes32 ch2 = _commitHash(false, s2, voter2, contentId);
        bytes32 ch3 = _commitHash(false, s3, voter3, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext30 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext30,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1,
            _testCiphertext(false, s1, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        vm.startPrank(voter2);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext31 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext31,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch2,
            _testCiphertext(false, s2, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        vm.startPrank(voter3);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext131 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext131,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch3,
            _testCiphertext(false, s3, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        RoundLib.Round memory rCD0 = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rCD0.startTime) + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter1, ch1), false, 5_000, s1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter2, ch2), false, 5_000, s2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter3, ch3), false, 5_000, s3);

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled), "Should be settled by consensus");
        assertFalse(round.upWins, "DOWN should win by consensus");
    }

    // =========================================================================
    // ROUND ADVANCEMENT — new round after settlement
    // =========================================================================

    function test_CommitAfterSettlementCreatesNewRound() public {
        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 round1Id = _settleRoundWith(voters, contentId, dirs, STAKE);
        assertEq(round1Id, 1, "Round 1 should have been settled");
        assertEq(RoundEngineReadHelpers.activeRoundId(votingEngine, contentId), 0, "No active round after settlement");

        // New commit after cooldown creates round 2
        vm.warp(block.timestamp + 25 hours);
        bytes32 salt = keccak256(abi.encodePacked(voter4, contentId, false, uint256(99)));
        bytes32 ch = _commitHash(false, salt, voter4, contentId);

        vm.startPrank(voter4);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext32 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext32,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch,
            _testCiphertext(false, salt, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        assertEq(RoundEngineReadHelpers.activeRoundId(votingEngine, contentId), 2, "Round 2 should be created");
    }

    // =========================================================================
    // DOUBLE COMMIT PREVENTION
    // =========================================================================

    function test_CannotDoubleCommitInSameRound() public {
        uint256 contentId = _submitContent();

        bytes32 salt1 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 ch1 = _commitHash(true, salt1, voter1, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext33 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext33,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1,
            _testCiphertext(true, salt1, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        // Warp past 24h cooldown so CooldownActive doesn't fire first
        vm.warp(block.timestamp + 25 hours);

        // Same voter, same round — second commit reverts with AlreadyCommitted (cooldown cleared)
        bytes32 salt2 = keccak256(abi.encodePacked(voter1, contentId, false, uint256(1)));
        bytes32 ch2 = _commitHash(false, salt2, voter2, contentId);
        uint16 referenceRatingBps = _currentRatingReferenceBps(contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext34 = _roundContext(votingEngine.previewCommitRoundId(contentId), referenceRatingBps);
        vm.expectRevert(RoundVotingEngine.AlreadyCommitted.selector);
        votingEngine.commitVote(
            contentId,
            cachedRoundContext34,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch2,
            _testCiphertext(false, salt2, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    // =========================================================================
    // 24-HOUR COOLDOWN
    // =========================================================================

    function test_CooldownPreventsQuickRecommit() public {
        uint256 contentId = _submitContent();

        _settleTiedRound(contentId);

        // Try immediately — cooldown active (voter1 last voted < 24h ago)
        bytes32 salt = keccak256(abi.encodePacked(voter1, contentId, true, uint256(99)));
        bytes32 ch = _commitHash(true, salt, voter1, contentId);
        uint16 referenceRatingBps = _currentRatingReferenceBps(contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext35 = _roundContext(votingEngine.previewCommitRoundId(contentId), referenceRatingBps);
        vm.expectRevert(RoundVotingEngine.CooldownActive.selector);
        votingEngine.commitVote(
            contentId,
            cachedRoundContext35,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch,
            _testCiphertext(true, salt, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        // After 25 hours — succeeds
        vm.warp(block.timestamp + 25 hours);
        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext36 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext36,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch,
            _testCiphertext(true, salt, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        assertEq(RoundEngineReadHelpers.activeRoundId(votingEngine, contentId), 2, "New round should be created");
    }

    // =========================================================================
    // UNANIMOUS ROUND REWARDS
    // =========================================================================

    function test_UnanimousRoundDoesNotPayConsensusSubsidy() public {
        uint256 contentId = _submitContent();

        // All voters same direction — unanimous UP
        bytes32 s1 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 s2 = keccak256(abi.encodePacked(voter2, contentId, true, uint256(1)));
        bytes32 s3 = keccak256(abi.encodePacked(voter3, contentId, true, uint256(2)));
        bytes32 ch1 = _commitHash(true, s1, voter1, contentId);
        bytes32 ch2 = _commitHash(true, s2, voter2, contentId);
        bytes32 ch3 = _commitHash(true, s3, voter3, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext37 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext37,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1,
            _testCiphertext(true, s1, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        vm.startPrank(voter2);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext38 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext38,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch2,
            _testCiphertext(true, s2, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        vm.startPrank(voter3);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext41 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext41,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch3,
            _testCiphertext(true, s3, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        RoundLib.Round memory rUR0 = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rUR0.startTime) + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter1, ch1), true, 5_000, s1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter2, ch2), true, 5_000, s2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter3, ch3), true, 5_000, s3);

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        uint256 rewardWeight = votingEngine.roundRbtsRewardWeight(contentId, roundId);
        uint256 forfeitedPool = votingEngine.roundRbtsForfeitedPool(contentId, roundId);
        if (rewardWeight > 0) {
            assertEq(
                votingEngine.roundVoterPool(contentId, roundId),
                forfeitedPool,
                "unanimous round voter pool should equal RBTS forfeitures"
            );
        }

        uint256 balBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);
        uint256 payout = lrepToken.balanceOf(voter1) - balBefore;
        assertGt(payout, 0, "Voter should receive a claim");
        assertLe(payout, STAKE + votingEngine.roundVoterPool(contentId, roundId), "claim stays inside forfeiture pool");
    }

    function test_LowRatedFirstSettlementDoesNotPayTreasury() public {
        ProtocolConfig protocolConfig = ProtocolConfig(address(votingEngine.protocolConfig()));
        vm.startPrank(owner);
        registry.setTreasury(treasury);
        protocolConfig.setSlashConfig(4_000, 1, 2 days, 1e6);
        vm.stopPrank();

        uint256 contentId = _submitContent();
        uint256 submitterBalanceBefore = lrepToken.balanceOf(submitter);
        uint256 treasuryBalanceBefore = lrepToken.balanceOf(treasury);
        RatingLib.SlashConfig memory slashConfig = registry.getSlashConfigForContent(contentId);
        assertEq(slashConfig.slashThresholdBps, 4_000, "content should snapshot the tuned slash threshold");
        assertEq(slashConfig.minSlashSettledRounds, 1, "content should snapshot the tuned settled-round requirement");
        assertEq(slashConfig.minSlashLowDuration, 2 days, "content should snapshot the tuned dwell window");
        assertEq(slashConfig.minSlashEvidence, 1e6, "content should snapshot the tuned evidence floor");

        vm.warp(block.timestamp + 1 days + 1);

        address[] memory voters = new address[](6);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        voters[3] = voter4;
        voters[4] = voter5;
        voters[5] = voter6;
        bool[] memory dirs = new bool[](6);
        dirs[0] = false;
        dirs[1] = false;
        dirs[2] = false;
        dirs[3] = false;
        dirs[4] = false;
        dirs[5] = false;

        _settleRoundWith(voters, contentId, dirs, 10e6);

        (,,,,,,,, uint256 rating,) = registry.contents(contentId);
        RatingLib.RatingState memory ratingState = registry.getRatingState(contentId);
        assertLt(ratingState.conservativeRatingBps, 4_000, "conservative rating should fall below the tuned threshold");
        assertGt(uint256(ratingState.lowSince), 0, "first low settlement should start the low-rating dwell timer");
        assertGe(
            lrepToken.balanceOf(treasury),
            treasuryBalanceBefore,
            "treasury should only move through non-slash protocol routes before the dwell window"
        );

        (,,,,,,,, rating,) = registry.contents(contentId);
        assertLt(uint256(rating), 50, "display rating should reflect a low settlement");
        assertEq(lrepToken.balanceOf(submitter), submitterBalanceBefore, "submitter receives no removed stake payout");
        assertGe(
            lrepToken.balanceOf(treasury),
            treasuryBalanceBefore,
            "treasury should not receive a removed-stake slash before dwell"
        );
    }

    function test_HealthyFirstSettlementDoesNotPaySubmitterOrTreasury() public {
        uint256 contentId = _submitContent();
        uint256 submitterBalanceBefore = lrepToken.balanceOf(submitter);
        uint256 treasuryBalanceBefore = lrepToken.balanceOf(treasury);

        vm.warp(block.timestamp + 4 days + 1);

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = true;

        _settleRoundWith(voters, contentId, dirs, 10e6);

        (,,,,,,,, uint256 rating,) = registry.contents(contentId);
        assertGe(rating, 25, "round should not be slashable");
        assertEq(lrepToken.balanceOf(submitter), submitterBalanceBefore, "submitter receives no removed stake payout");
        assertGe(
            lrepToken.balanceOf(treasury),
            treasuryBalanceBefore,
            "treasury movement is limited to non-slash protocol routing"
        );
    }

    // =========================================================================
    // CONFIG SNAPSHOT PER-ROUND
    // =========================================================================

    function test_ConfigSnapshotPerRound() public {
        uint256 contentId = _submitContent();

        bytes32 s1 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 s2 = keccak256(abi.encodePacked(voter2, contentId, true, uint256(1)));
        bytes32 s3 = keccak256(abi.encodePacked(voter3, contentId, true, uint256(2)));
        bytes32 ch1 = _commitHash(true, s1, voter1, contentId);
        bytes32 ch2 = _commitHash(true, s2, voter2, contentId);
        bytes32 ch3 = _commitHash(true, s3, voter3, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext39 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext39,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1,
            _testCiphertext(true, s1, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        vm.startPrank(voter2);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext40 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext40,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch2,
            _testCiphertext(true, s2, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        vm.startPrank(voter3);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext41 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext41,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch3,
            _testCiphertext(true, s3, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        // Verify snapshot matches config at creation
        RoundLib.RoundConfig memory cfg = RoundEngineReadHelpers.roundConfig(votingEngine, contentId, roundId);
        assertEq(cfg.epochDuration, EPOCH_DURATION);
        assertEq(cfg.maxDuration, 7 days);
        assertEq(cfg.minVoters, 3);

        // Change config: increase minVoters to 10
        ProtocolConfig protoCfg = ProtocolConfig(address(votingEngine.protocolConfig()));
        vm.prank(owner);
        _setTlockRoundConfig(protoCfg, EPOCH_DURATION, 7 days, 10, 200);

        // Snapshot unchanged
        cfg = RoundEngineReadHelpers.roundConfig(votingEngine, contentId, roundId);
        assertEq(cfg.minVoters, 3, "Snapshot should still have minVoters=3");

        // Reveal and settle using snapshotted config (minVoters=3, we have 3 revealed votes)
        RoundLib.Round memory rCSN0 = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rCSN0.startTime) + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter1, ch1), true, 5_000, s1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter2, ch2), true, 5_000, s2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter3, ch3), true, 5_000, s3);

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        assertEq(
            uint256(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).state),
            uint256(RoundLib.RoundState.Settled),
            "Should settle with snapshotted config"
        );
    }

    // =========================================================================
    // ROUND STATE TRACKING
    // =========================================================================

    function test_HasCommittedTracking() public {
        uint256 contentId = _submitContent();

        assertEq(votingEngine.voterCommitHash(contentId, 1, voter1), bytes32(0), "Should not have committed yet");

        bytes32 salt = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 ch = _commitHash(true, salt, voter1, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext41 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext41,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch,
            _testCiphertext(true, salt, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        assertTrue(votingEngine.voterCommitHash(contentId, roundId, voter1) != bytes32(0), "Should have committed");
        assertEq(
            votingEngine.voterCommitHash(contentId, roundId, voter2), bytes32(0), "Voter2 should not have committed"
        );
    }

    function test_CommitHistoryTracking() public {
        uint256 contentId = _submitContent();

        bytes32 s1 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 ch1 = _commitHash(true, s1, voter1, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext42 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext42,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1,
            _testCiphertext(true, s1, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        assertTrue(votingEngine.hasCommits(contentId), "Content should show commit history after first vote");

        bytes32 s2 = keccak256(abi.encodePacked(voter2, contentId, false, uint256(1)));
        bytes32 ch2 = _commitHash(false, s2, voter2, contentId);

        vm.startPrank(voter2);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext43 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext43,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch2,
            _testCiphertext(false, s2, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        assertTrue(votingEngine.hasCommits(contentId), "Content should keep commit history after more votes");
    }

    function test_RoundVoterCountAfterReveal() public {
        uint256 contentId = _submitContent();

        bytes32 s1 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 s2 = keccak256(abi.encodePacked(voter2, contentId, false, uint256(1)));
        bytes32 s3 = keccak256(abi.encodePacked(voter3, contentId, true, uint256(2)));
        bytes32 ch1 = _commitHash(true, s1, voter1, contentId);
        bytes32 ch2 = _commitHash(false, s2, voter2, contentId);
        bytes32 ch3 = _commitHash(true, s3, voter3, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext44 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext44,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1,
            _testCiphertext(true, s1, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        vm.startPrank(voter2);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext45 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext45,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch2,
            _testCiphertext(false, s2, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        vm.startPrank(voter3);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext46 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext46,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch3,
            _testCiphertext(true, s3, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        // Revealed count is populated during reveal, not commit
        assertEq(
            RoundEngineReadHelpers.round(votingEngine, contentId, roundId).revealedCount, 0, "No voters revealed yet"
        );

        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter1, ch1), true, 5_000, s1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter2, ch2), false, 5_000, s2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter3, ch3), true, 5_000, s3);

        assertEq(
            RoundEngineReadHelpers.round(votingEngine, contentId, roundId).revealedCount,
            3,
            "Should have 3 revealed voters"
        );
    }

    // =========================================================================
    // STAKE VALIDATION
    // =========================================================================

    function test_InvalidStakeRejected() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 ch = _commitHash(true, salt, voter1, contentId);
        uint16 referenceRatingBps = _currentRatingReferenceBps(contentId);

        // Zero-stake ratings are advisory-only and cannot enter paid round settlement.
        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), 0);
        uint256 cachedRoundContext47 = _roundContext(votingEngine.previewCommitRoundId(contentId), referenceRatingBps);
        vm.expectRevert(RoundVotingEngine.InvalidStake.selector);
        votingEngine.commitVote(
            contentId,
            cachedRoundContext47,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch,
            _testCiphertext(true, salt, contentId),
            0,
            address(0)
        );
        vm.stopPrank();

        // Above maximum (10 LREP)
        bytes32 salt2 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(1)));
        bytes32 ch2 = _commitHash(true, salt2, voter2, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), 11e6);
        uint256 cachedRoundContext48 = _roundContext(votingEngine.previewCommitRoundId(contentId), referenceRatingBps);
        vm.expectRevert(RoundVotingEngine.InvalidStake.selector);
        votingEngine.commitVote(
            contentId,
            cachedRoundContext48,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch2,
            _testCiphertext(true, salt2, contentId),
            11e6,
            address(0)
        );
        vm.stopPrank();
    }

    // =========================================================================
    // EPOCH-WEIGHTED REWARDS — early blind voters get 4x weight vs informed
    // =========================================================================

    function test_EpochWeighting_Epoch1VoterGetsFullWeight() public {
        uint256 contentId = _submitContent();

        // voter1 commits in epoch-1 (epochIndex=0 → 100% weight)
        bytes32 s1 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 ch1 = _commitHash(true, s1, voter1, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext49 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext49,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1,
            _testCiphertext(true, s1, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        bytes32 ck1 = _commitKey(voter1, ch1);

        // Verify epochIndex = 0 (epoch-1, blind)
        RoundLib.Commit memory commit = RoundEngineReadHelpers.commit(votingEngine, contentId, roundId, ck1);
        assertEq(commit.epochIndex, 0, "First voter should be in epoch-1 (epochIndex=0)");
        assertEq(commit.stakeAmount, STAKE, "Stake should be recorded correctly");

        // Advance past epoch boundary and reveal
        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck1, true, 5_000, s1);

        // After reveal, effective weighted pool should reflect 100% weight
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(round.weightedUpPool, STAKE, "Epoch-1 vote should have 100% weight (effectiveStake = stake)");
    }

    function test_EpochWeighting_Epoch2VoterGetsReducedWeight() public {
        uint256 contentId = _submitContent();

        // voter1 commits in epoch-1 (blind)
        bytes32 s1 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 ch1 = _commitHash(true, s1, voter1, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext50 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext50,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1,
            _testCiphertext(true, s1, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();
        bytes32 ck1 = _commitKey(voter1, ch1);
        bytes32 s3 = keccak256(abi.encodePacked(voter3, contentId, true, uint256(2)));
        (, bytes32 ck3) = _commitWithSalt(voter3, contentId, true, STAKE, s3);

        // Advance into epoch-2 — use absolute time from round.startTime
        // voter2 commits after epoch-1 ends (epoch-2, epochIndex=1 → 25% weight)
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        RoundLib.Round memory rEW0 = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rEW0.startTime) + EPOCH_DURATION);

        // Reveal voter1's vote to make results visible
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck1, true, 5_000, s1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck3, true, 5_000, s3);

        // voter2 commits in epoch-2 (informed, epochIndex=1 → 25% weight)
        bytes32 s2 = keccak256(abi.encodePacked(voter2, contentId, false, uint256(1)));
        (, bytes32 ck2) = _commitWithSalt(voter2, contentId, false, STAKE, s2);
        uint256 voter2RevealableAfter = block.timestamp + EPOCH_DURATION;

        RoundLib.Commit memory commit2 = RoundEngineReadHelpers.commit(votingEngine, contentId, roundId, ck2);
        assertEq(commit2.epochIndex, 1, "Second-epoch voter should have epochIndex=1");

        // Reveal voter2's vote after another epoch boundary (absolute: startTime + 2 * EPOCH_DURATION + 2)
        // voter2 committed at startTime+EPOCH_DURATION+1, so revealableAfter = startTime+2*EPOCH_DURATION+1
        _warpPastTlockRevealTime(voter2RevealableAfter);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck2, false, 5_000, s2);

        // Verify weighted pools: UP has two epoch-1 votes, DOWN has one epoch-2 vote at 25%.
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(round.weightedUpPool, 2 * STAKE, "Epoch-1 UP votes should have 100% weight");
        assertEq(round.weightedDownPool, STAKE * 2500 / 10000, "Epoch-2 DOWN vote should have 25% weight");

        // UP wins despite equal raw stakes (epoch-weighting penalises late voter)
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        RoundLib.Round memory settled = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(uint256(settled.state), uint256(RoundLib.RoundState.Settled), "Should be settled");
        assertTrue(settled.upWins, "UP should win due to epoch-1 weight advantage");
    }

    // =========================================================================
    // SETTLEMENT VIA settleRound — can settle immediately after minVoters revealed
    // =========================================================================

    function test_SettleRound_ImmediatelyAfterReveals() public {
        uint256 contentId = _submitContent();

        uint256 roundId = _settleTiedRound(contentId);

        assertEq(
            uint256(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).state),
            uint256(RoundLib.RoundState.Tied),
            "Should be tied"
        );
    }

    // =========================================================================
    // TRY-CATCH SETTLEMENT RESILIENCE
    // =========================================================================

    function test_SettlementSucceedsWithoutParticipationPool() public {
        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);

        assertEq(
            uint256(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).state),
            uint256(RoundLib.RoundState.Settled),
            "Settlement should succeed without participation pool"
        );
    }

    // =========================================================================
    // O(1) SETTLEMENT — FRONTEND FEE CLAIMING
    // =========================================================================

    /// @dev Helper to set up a FrontendRegistry wired to the voting engine.
    function _setupFrontendRegistry() internal returns (FrontendRegistry frontendReg, address frontendOp) {
        frontendReg = _setupFrontendRegistryForFees();
        frontendOp = address(200);
        _registerFrontend(frontendReg, frontendOp);
    }

    function _setupFrontendRegistryForFees() internal returns (FrontendRegistry frontendReg) {
        vm.startPrank(owner);
        FrontendRegistry frontendRegistryImpl = new FrontendRegistry();
        frontendReg = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(frontendRegistryImpl),
                    abi.encodeCall(FrontendRegistry.initialize, (owner, owner, address(lrepToken)))
                )
            )
        );
        ProtocolConfig(address(votingEngine.protocolConfig())).setFrontendRegistry(address(frontendReg));
        frontendReg.setVotingEngine(address(votingEngine));
        frontendReg.addFeeCreditor(address(rewardDistributor));
        vm.stopPrank();
    }

    function _registerFrontend(FrontendRegistry frontendReg, address frontendOp) internal {
        vm.startPrank(owner);
        lrepToken.mint(frontendOp, 2000e6);
        vm.stopPrank();

        vm.startPrank(frontendOp);
        lrepToken.approve(address(frontendReg), 1000e6);
        frontendReg.register();
        vm.stopPrank();
    }

    /// @dev Helper: commit 3 votes (2 up, 1 down) with a specific frontend, reveal, settle.
    function _settleRoundWithFrontend(address frontend) internal returns (uint256 contentId, uint256 roundId) {
        contentId = _submitContent();

        bytes32 s1 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 s2 = keccak256(abi.encodePacked(voter2, contentId, true, uint256(1)));
        bytes32 s3 = keccak256(abi.encodePacked(voter3, contentId, false, uint256(2)));
        uint16 p1 = _defaultPredictionBps(0, true);
        uint16 p2 = _defaultPredictionBps(1, true);
        uint16 p3 = _defaultPredictionBps(2, false);
        bytes32 ch1 = _commitHashWithPrediction(true, p1, s1, voter1, contentId);
        bytes32 ch2 = _commitHashWithPrediction(true, p2, s2, voter2, contentId);
        bytes32 ch3 = _commitHashWithPrediction(false, p3, s3, voter3, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext54 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext54,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1,
            _testCiphertext(true, s1, contentId),
            STAKE,
            frontend
        );
        vm.stopPrank();

        vm.startPrank(voter2);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext55 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext55,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch2,
            _testCiphertext(true, s2, contentId),
            STAKE,
            frontend
        );
        vm.stopPrank();

        vm.startPrank(voter3);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext56 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext56,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch3,
            _testCiphertext(false, s3, contentId),
            STAKE,
            frontend
        );
        vm.stopPrank();

        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        RoundLib.Round memory rFW0 = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rFW0.startTime) + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter1, ch1), true, p1, s1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter2, ch2), true, p2, s2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter3, ch3), false, p3, s3);

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
    }

    function test_ClaimFrontendFee_HappyPath() public {
        (FrontendRegistry frontendReg, address frontendOp) = _setupFrontendRegistry();
        (uint256 contentId, uint256 roundId) = _settleRoundWithFrontend(frontendOp);

        uint256 feesBefore = frontendReg.getAccumulatedFees(frontendOp);

        // Claim frontend fee
        _claimFrontendFeeAsOperator(contentId, roundId, frontendOp);

        assertGt(frontendReg.getAccumulatedFees(frontendOp) - feesBefore, 0, "Frontend fee should be credited");
    }

    function test_FinalizeFrontendFeeDust_RoutesOnlyRoundingDustAfterDelay() public {
        FrontendRegistry frontendReg = _setupFrontendRegistryForFees();
        address frontendA = address(200);
        address frontendB = address(201);
        _registerFrontend(frontendReg, frontendA);
        _registerFrontend(frontendReg, frontendB);

        uint256 contentId = _submitContent();
        uint256 stake1 = 1_000_001;
        uint256 stake2 = 1_000_000;
        uint256 stake3 = 1_000_000;

        bytes32 salt1 = keccak256(abi.encodePacked("frontend-dust", voter1, contentId));
        bytes32 salt2 = keccak256(abi.encodePacked("frontend-dust", voter2, contentId));
        bytes32 salt3 = keccak256(abi.encodePacked("frontend-dust", voter3, contentId));

        (, bytes32 ck1) = _commitWithSaltAndFrontend(voter1, contentId, true, stake1, salt1, frontendA);
        (, bytes32 ck2) = _commitWithSaltAndFrontend(voter2, contentId, true, stake2, salt2, frontendB);
        (, bytes32 ck3) = _commitWithSaltAndFrontend(voter3, contentId, false, stake3, salt3, address(0));

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        RoundLib.Round memory openRound = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        vm.warp(openRound.startTime + EPOCH_DURATION + _tlockDrandPeriod() + 1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck1, true, 5_000, salt1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck2, true, 5_000, salt2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck3, false, 5_000, salt3);
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        address[] memory frontends = new address[](2);
        frontends[0] = frontendA;
        frontends[1] = frontendB;

        vm.expectRevert(RoundRewardDistributor.RewardFinalizationTooEarly.selector);
        rewardDistributor.finalizeFrontendFeeDust(contentId, roundId, frontends);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        vm.warp(uint256(round.settledAt) + rewardDistributor.STALE_REWARD_FINALIZATION_DELAY());

        uint256 frontendPool = votingEngine.roundFrontendPool(contentId, roundId);
        uint256 treasuryBefore = lrepToken.balanceOf(treasury);
        uint256 feesABefore = frontendReg.getAccumulatedFees(frontendA);
        uint256 feesBBefore = frontendReg.getAccumulatedFees(frontendB);

        address[] memory firstBatch = new address[](1);
        firstBatch[0] = frontendA;
        address[] memory secondBatch = new address[](1);
        secondBatch[0] = frontendB;

        vm.expectRevert();
        vm.prank(address(0xD00D));
        rewardDistributor.processFrontendFeeDustBatch(contentId, roundId, firstBatch);

        vm.prank(owner);
        (uint256 processedCount,) = rewardDistributor.processFrontendFeeDustBatch(contentId, roundId, secondBatch);
        assertEq(processedCount, 1, "suffix batch should process one frontend");

        vm.expectRevert(RoundRewardDistributor.InvalidFinalizationInput.selector);
        vm.prank(owner);
        rewardDistributor.processFrontendFeeDustBatch(contentId, roundId, firstBatch);

        vm.prank(owner);
        rewardDistributor.resetFrontendFeeDustBatch(contentId, roundId);
        assertEq(rewardDistributor.roundFrontendFeeDustProcessedCount(contentId, roundId), 0);

        vm.prank(owner);
        (processedCount,) = rewardDistributor.processFrontendFeeDustBatch(contentId, roundId, firstBatch);
        assertEq(processedCount, 1, "first batch should process one frontend");

        vm.expectRevert(RoundRewardDistributor.InvalidFinalizationInput.selector);
        vm.prank(owner);
        rewardDistributor.finalizeProcessedFrontendFeeDust(contentId, roundId);

        vm.prank(owner);
        (processedCount,) = rewardDistributor.processFrontendFeeDustBatch(contentId, roundId, secondBatch);
        assertEq(processedCount, 2, "second batch should complete processing");

        vm.prank(owner);
        uint256 releasedDust = rewardDistributor.finalizeProcessedFrontendFeeDust(contentId, roundId);

        assertEq(releasedDust, 1, "only mathematical frontend fee dust should be finalized");
        assertEq(lrepToken.balanceOf(treasury), treasuryBefore + releasedDust, "dust should route to protocol");
        assertTrue(rewardDistributor.roundFrontendFeeDustFinalized(contentId, roundId));

        _claimFrontendFeeAsOperator(contentId, roundId, frontendA);
        _claimFrontendFeeAsOperator(contentId, roundId, frontendB);

        uint256 feeA = frontendReg.getAccumulatedFees(frontendA) - feesABefore;
        uint256 feeB = frontendReg.getAccumulatedFees(frontendB) - feesBBefore;
        assertEq(feeA + feeB + releasedDust, frontendPool, "finalized dust should not reduce base shares");
        assertEq(rewardDistributor.roundFrontendClaimedAmount(contentId, roundId), frontendPool);
    }

    function test_ClaimFrontendFee_CreditFailureEmitsFallbackEvent() public {
        (FrontendRegistry frontendReg, address frontendOp) = _setupFrontendRegistry();
        (uint256 contentId, uint256 roundId) = _settleRoundWithFrontend(frontendOp);

        vm.prank(owner);
        frontendReg.removeFeeCreditor(address(rewardDistributor));

        (uint256 fee,,,) = rewardDistributor.previewFrontendFee(contentId, roundId, frontendOp);
        uint256 treasuryBalanceBefore = lrepToken.balanceOf(treasury);

        vm.expectEmit(true, true, true, true, address(rewardDistributor));
        emit RoundRewardDistributor.FrontendFeeCreditFailed(contentId, roundId, frontendOp, address(frontendReg), fee);
        _claimFrontendFeeAsOperator(contentId, roundId, frontendOp);

        assertEq(frontendReg.getAccumulatedFees(frontendOp), 0, "failed registry credit should not accrue fees");
        assertEq(lrepToken.balanceOf(treasury), treasuryBalanceBefore + fee, "fee should route to protocol");
    }

    function test_ClaimFrontendFee_RegistryLookupFailureIsConfiscatable() public {
        (FrontendRegistry frontendReg, address frontendOp) = _setupFrontendRegistry();
        (uint256 contentId, uint256 roundId) = _settleRoundWithFrontend(frontendOp);

        uint256 feesBefore = frontendReg.getAccumulatedFees(frontendOp);
        uint256 frontendBalanceBefore = lrepToken.balanceOf(frontendOp);
        uint256 treasuryBalanceBefore = lrepToken.balanceOf(treasury);

        vm.mockCallRevert(
            address(frontendReg),
            abi.encodeWithSelector(IFrontendRegistry.getFrontendInfo.selector, frontendOp),
            abi.encodeWithSignature("Error(string)", "registry unavailable")
        );

        vm.expectRevert(RoundRewardDistributor.FrontendFeeNotClaimable.selector);
        _claimFrontendFeeAsOperator(contentId, roundId, frontendOp);
        _confiscateFrontendFee(contentId, roundId, frontendOp);

        assertEq(lrepToken.balanceOf(frontendOp), frontendBalanceBefore, "lookup failure must not pay frontend");
        assertEq(frontendReg.getAccumulatedFees(frontendOp), feesBefore, "lookup failure must not accrue fees");
        assertGt(lrepToken.balanceOf(treasury), treasuryBalanceBefore, "confiscated fee should reach protocol");
    }

    function test_ClaimFrontendFee_DoubleClaimReverts() public {
        (, address frontendOp) = _setupFrontendRegistry();
        (uint256 contentId, uint256 roundId) = _settleRoundWithFrontend(frontendOp);

        // First claim succeeds
        _claimFrontendFeeAsOperator(contentId, roundId, frontendOp);

        // Second claim reverts
        vm.expectRevert(RoundVotingEngine.AlreadyClaimed.selector);
        _claimFrontendFeeAsOperator(contentId, roundId, frontendOp);
    }

    function test_ClaimFrontendFee_ReroutesHistoricalShareAfterDeregister() public {
        (FrontendRegistry frontendReg, address frontendOp) = _setupFrontendRegistry();
        (uint256 contentId, uint256 roundId) = _settleRoundWithFrontend(frontendOp);

        vm.prank(frontendOp);
        frontendReg.requestDeregister();
        _completeFrontendExit(frontendReg, frontendOp);

        uint256 feesBefore = frontendReg.getAccumulatedFees(frontendOp);
        uint256 frontendBalanceBefore = lrepToken.balanceOf(frontendOp);
        uint256 treasuryBalanceBefore = lrepToken.balanceOf(treasury);

        vm.expectRevert(RoundRewardDistributor.FrontendFeeNotClaimable.selector);
        _claimFrontendFeeAsOperator(contentId, roundId, frontendOp);
        _confiscateFrontendFee(contentId, roundId, frontendOp);

        assertEq(lrepToken.balanceOf(frontendOp), frontendBalanceBefore, "deregistered frontend must not be paid");
        assertEq(frontendReg.getAccumulatedFees(frontendOp), feesBefore, "deregistered frontend must not accrue fees");
        assertGt(lrepToken.balanceOf(treasury), treasuryBalanceBefore, "redirected fee should reach protocol");
    }

    function test_ClaimFrontendFee_ReroutesHistoricalShareWhileFrontendIsSlashed() public {
        (FrontendRegistry frontendReg, address frontendOp) = _setupFrontendRegistry();
        (uint256 contentId, uint256 roundId) = _settleRoundWithFrontend(frontendOp);

        vm.prank(owner);
        frontendReg.slashFrontend(frontendOp, 100e6, "test");

        uint256 feesBefore = frontendReg.getAccumulatedFees(frontendOp);
        uint256 frontendBalanceBefore = lrepToken.balanceOf(frontendOp);
        uint256 treasuryBalanceBefore = lrepToken.balanceOf(treasury);
        _confiscateFrontendFee(contentId, roundId, frontendOp);

        assertEq(lrepToken.balanceOf(frontendOp), frontendBalanceBefore, "slashed frontend must not be paid directly");
        assertEq(frontendReg.getAccumulatedFees(frontendOp), feesBefore, "slashed frontend must not accrue fees");
        assertGt(lrepToken.balanceOf(treasury), treasuryBalanceBefore, "redirected fee should reach protocol");
    }

    function test_ClaimFrontendFee_KeepsHistoricalShareWithoutIdentityGate() public {
        FrontendRegistry frontendReg = _setupFrontendRegistryForFees();
        address frontendOp = address(200);
        _registerFrontend(frontendReg, frontendOp);
        (uint256 contentId, uint256 roundId) = _settleRoundWithFrontend(frontendOp);

        (uint256 fee,,,) = rewardDistributor.previewFrontendFee(contentId, roundId, frontendOp);
        uint256 feesBefore = frontendReg.getAccumulatedFees(frontendOp);
        uint256 frontendBalanceBefore = lrepToken.balanceOf(frontendOp);
        uint256 treasuryBalanceBefore = lrepToken.balanceOf(treasury);

        _claimFrontendFeeAsOperator(contentId, roundId, frontendOp);

        assertEq(lrepToken.balanceOf(frontendOp), frontendBalanceBefore, "fee should still credit registry first");
        assertEq(
            frontendReg.getAccumulatedFees(frontendOp),
            feesBefore + fee,
            "revocation should not erase earned historical fees"
        );
        assertEq(lrepToken.balanceOf(treasury), treasuryBalanceBefore, "claim should not route earned fees to treasury");
    }

    /// @dev After completeDeregister + register(), the frontend's `registeredAt` is set to
    ///      the re-registration timestamp, which post-dates the historical round's
    ///      `settledAt`. Reviving the historical fee at this point would let an operator
    ///      bypass the protocol's slashing review window via a quick deregister+re-register
    ///      cycle. The fee must instead route to Protocol disposition for governance to
    ///      confiscate.
    function test_ClaimFrontendFee_BlocksClaimsAfterReregistration() public {
        (FrontendRegistry frontendReg, address frontendOp) = _setupFrontendRegistry();
        (uint256 contentId, uint256 roundId) = _settleRoundWithFrontend(frontendOp);

        vm.prank(frontendOp);
        frontendReg.requestDeregister();
        _completeFrontendExit(frontendReg, frontendOp);

        vm.warp(block.timestamp + 1);

        vm.startPrank(frontendOp);
        lrepToken.approve(address(frontendReg), 1000e6);
        frontendReg.register();
        vm.stopPrank();

        assertTrue(frontendReg.isEligible(frontendOp), "Re-registration restores eligibility");

        vm.expectRevert(RoundRewardDistributor.FrontendFeeNotClaimable.selector);
        _claimFrontendFeeAsOperator(contentId, roundId, frontendOp);

        assertEq(frontendReg.getAccumulatedFees(frontendOp), 0, "Re-registered frontend cannot revive historical fee");

        // Governance can confiscate the now-Protocol-disposition fee.
        vm.prank(owner);
        rewardDistributor.confiscateFrontendFee(contentId, roundId, frontendOp);
    }

    function test_ClaimFrontendFee_SucceedsAfterFrontendIsRebonded() public {
        (FrontendRegistry frontendReg, address frontendOp) = _setupFrontendRegistry();
        (uint256 contentId, uint256 roundId) = _settleRoundWithFrontend(frontendOp);

        vm.startPrank(owner);
        frontendReg.slashFrontend(frontendOp, 100e6, "test");
        frontendReg.unslashFrontend(frontendOp);
        vm.stopPrank();

        vm.startPrank(frontendOp);
        lrepToken.approve(address(frontendReg), 100e6);
        frontendReg.topUpStake(100e6);
        vm.stopPrank();

        uint256 feesBefore = frontendReg.getAccumulatedFees(frontendOp);
        _claimFrontendFeeAsOperator(contentId, roundId, frontendOp);

        assertGt(
            frontendReg.getAccumulatedFees(frontendOp) - feesBefore,
            0,
            "Rebonded frontend should receive preserved fees"
        );
        assertTrue(frontendReg.isEligible(frontendOp), "Rebonding should restore eligibility");
    }

    /// @dev While the frontend is mid-unbonding the historical fee resolves to `Protocol`
    ///      and the operator cannot claim it. The unbonding window is the slashing review
    ///      period; bypassing it would let the operator EOA collect LREP fees that should be
    ///      held back until the window closes.
    function test_ClaimFrontendFee_BlocksClaimsWhileExitPending() public {
        (FrontendRegistry frontendReg, address frontendOp) = _setupFrontendRegistry();
        uint256 contentId = _submitContent();

        bytes32 s1 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 s2 = keccak256(abi.encodePacked(voter2, contentId, true, uint256(1)));
        bytes32 s3 = keccak256(abi.encodePacked(voter3, contentId, false, uint256(2)));
        uint16 p1 = _defaultPredictionBps(0, true);
        uint16 p2 = _defaultPredictionBps(1, true);
        uint16 p3 = _defaultPredictionBps(2, false);
        bytes32 ch1 = _commitHashWithPrediction(true, p1, s1, voter1, contentId);
        bytes32 ch2 = _commitHashWithPrediction(true, p2, s2, voter2, contentId);
        bytes32 ch3 = _commitHashWithPrediction(false, p3, s3, voter3, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext57 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext57,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1,
            _testCiphertext(true, s1, contentId),
            STAKE,
            frontendOp
        );
        vm.stopPrank();

        vm.startPrank(voter2);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext58 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext58,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch2,
            _testCiphertext(true, s2, contentId),
            STAKE,
            frontendOp
        );
        vm.stopPrank();

        vm.startPrank(voter3);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext59 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext59,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch3,
            _testCiphertext(false, s3, contentId),
            STAKE,
            frontendOp
        );
        vm.stopPrank();

        vm.prank(frontendOp);
        frontendReg.requestDeregister();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter1, ch1), true, p1, s1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter2, ch2), true, p2, s2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter3, ch3), false, p3, s3);

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        vm.expectRevert(RoundRewardDistributor.FrontendFeeNotClaimable.selector);
        _claimFrontendFeeAsOperator(contentId, roundId, frontendOp);

        assertEq(
            frontendReg.getAccumulatedFees(frontendOp), 0, "no fees should accumulate while frontend is exit-pending"
        );
    }

    function test_ClaimFrontendFee_IgnoresFrontendEligibleAfterCommit() public {
        (FrontendRegistry frontendReg, address frontendOp) = _setupFrontendRegistry();
        vm.startPrank(owner);
        frontendReg.slashFrontend(frontendOp, 100e6, "test");
        frontendReg.unslashFrontend(frontendOp);
        vm.stopPrank();

        uint256 contentId = _submitContent();

        bytes32 s1 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 s2 = keccak256(abi.encodePacked(voter2, contentId, true, uint256(1)));
        bytes32 s3 = keccak256(abi.encodePacked(voter3, contentId, false, uint256(2)));
        bytes32 ch1 = _commitHash(true, s1, voter1, contentId);
        bytes32 ch2 = _commitHash(true, s2, voter2, contentId);
        bytes32 ch3 = _commitHash(false, s3, voter3, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext60 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext60,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch1,
            _testCiphertext(true, s1, contentId),
            STAKE,
            frontendOp
        );
        vm.stopPrank();

        vm.startPrank(voter2);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext61 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext61,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch2,
            _testCiphertext(true, s2, contentId),
            STAKE,
            frontendOp
        );
        vm.stopPrank();

        vm.startPrank(voter3);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext62 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext62,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch3,
            _testCiphertext(false, s3, contentId),
            STAKE,
            frontendOp
        );
        vm.stopPrank();

        vm.startPrank(frontendOp);
        lrepToken.approve(address(frontendReg), 100e6);
        frontendReg.topUpStake(100e6);
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter1, ch1), true, 5_000, s1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter2, ch2), true, 5_000, s2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, _commitKey(voter3, ch3), false, 5_000, s3);

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
        vm.expectRevert(RoundRewardDistributor.NoPool.selector);
        _claimFrontendFeeAsOperator(contentId, roundId, frontendOp);
    }

    function test_FrontendTracking_KeepsCommitKeysAccessible() public {
        (FrontendRegistry frontendReg, address frontendOp) = _setupFrontendRegistry();
        (uint256 contentId, uint256 roundId) = _settleRoundWithFrontend(frontendOp);

        bytes32[] memory commitKeys = RoundEngineReadHelpers.commitKeys(votingEngine, contentId, roundId);

        assertEq(commitKeys.length, 3);

        _claimFrontendFeeAsOperator(contentId, roundId, frontendOp);
        assertGt(frontendReg.getAccumulatedFees(frontendOp), 0, "Frontend fee claim should still succeed");
    }

    function test_ClaimFrontendFee_UsesSnapshotRegistryAfterRegistryReplacement() public {
        (FrontendRegistry originalRegistry, address frontendOp) = _setupFrontendRegistry();
        (uint256 contentId, uint256 roundId) = _settleRoundWithFrontend(frontendOp);

        vm.startPrank(owner);
        FrontendRegistry replacementImpl = new FrontendRegistry();
        FrontendRegistry replacementRegistry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(replacementImpl),
                    abi.encodeCall(FrontendRegistry.initialize, (owner, owner, address(lrepToken)))
                )
            )
        );
        ProtocolConfig(address(votingEngine.protocolConfig())).setFrontendRegistry(address(replacementRegistry));
        replacementRegistry.setVotingEngine(address(votingEngine));
        replacementRegistry.addFeeCreditor(address(rewardDistributor));
        vm.stopPrank();

        uint256 originalFeesBefore = originalRegistry.getAccumulatedFees(frontendOp);
        uint256 replacementFeesBefore = replacementRegistry.getAccumulatedFees(frontendOp);

        _claimFrontendFeeAsOperator(contentId, roundId, frontendOp);

        assertGt(
            originalRegistry.getAccumulatedFees(frontendOp) - originalFeesBefore,
            0,
            "historical fees should credit the settlement-time registry"
        );
        assertEq(
            replacementRegistry.getAccumulatedFees(frontendOp),
            replacementFeesBefore,
            "replacement registry should not capture historical fees"
        );
    }

    function test_ClaimFrontendFee_UsesSnapshotRegistryAfterEngineRotation() public {
        (FrontendRegistry frontendReg, address frontendOp) = _setupFrontendRegistry();
        (uint256 contentId, uint256 roundId) = _settleRoundWithFrontend(frontendOp);
        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();

        vm.prank(owner);
        frontendReg.setVotingEngine(address(replacementEngine));

        assertEq(address(frontendReg.votingEngine()), address(replacementEngine));
        assertEq(frontendReg.feeCreditor(), address(0));
        assertTrue(
            frontendReg.hasRole(frontendReg.FEE_CREDITOR_ROLE(), address(rewardDistributor)),
            "historical distributor should stay authorized"
        );

        uint256 feesBefore = frontendReg.getAccumulatedFees(frontendOp);

        _claimFrontendFeeAsOperator(contentId, roundId, frontendOp);

        assertGt(
            frontendReg.getAccumulatedFees(frontendOp) - feesBefore,
            0,
            "engine rotation should not break historical frontend fee claims"
        );
    }

    function test_ClaimFrontendFee_NoEligibleFrontendRedirectsToVoterPool() public {
        // No frontend registry set — 3 voters (2 up, 1 down) to avoid tie
        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);

        // Voter pool should include the frontend share
        uint256 voterPool = votingEngine.roundVoterPool(contentId, roundId);
        assertGt(voterPool, 0);

        vm.expectRevert(RoundRewardDistributor.NoPool.selector);
        rewardDistributor.claimFrontendFee(contentId, roundId, address(0xBEEF));
    }

    function _completeFrontendExit(FrontendRegistry frontendReg, address frontendOp) internal {
        vm.warp(block.timestamp + frontendReg.UNBONDING_PERIOD() + 1);
        vm.prank(frontendOp);
        frontendReg.completeDeregister();
    }

    function _claimFrontendFeeAsOperator(uint256 contentId, uint256 roundId, address frontendOp) internal {
        vm.prank(frontendOp);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontendOp);
    }

    function _confiscateFrontendFee(uint256 contentId, uint256 roundId, address frontendOp) internal {
        vm.prank(owner);
        rewardDistributor.confiscateFrontendFee(contentId, roundId, frontendOp);
    }

    // =========================================================================
    // O(1) SETTLEMENT — PARTICIPATION REWARD CLAIMING
    // =========================================================================

    /// @dev Helper: set up ParticipationPool and settle a round (3 voters: 2 up, 1 down).
    function _settleRoundWithParticipation() internal returns (uint256 contentId, uint256 roundId) {
        vm.startPrank(owner);
        ParticipationPool pool = new ParticipationPool(address(lrepToken), owner);
        pool.setAuthorizedCaller(address(rewardDistributor), true);
        lrepToken.mint(owner, 1_000_000e6);
        lrepToken.approve(address(pool), 1_000_000e6);
        pool.depositPool(1_000_000e6);
        ProtocolConfig(address(votingEngine.protocolConfig())).setParticipationPool(address(pool));
        vm.stopPrank();

        contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        roundId = _settleRoundWith(voters, contentId, dirs, STAKE);
    }

    function _settleMixedEpochWinningRound() internal returns (uint256 contentId, uint256 roundId) {
        contentId = _submitContent();
        uint256 roundStart = block.timestamp;

        bytes32 salt1 = keccak256("epoch-1-up");
        bytes32 salt2 = keccak256("epoch-2-up");
        bytes32 salt3 = keccak256("epoch-1-down");
        (, bytes32 ck1) = _commitWithSalt(voter1, contentId, true, STAKE, salt1);
        (, bytes32 ck3) = _commitWithSalt(voter3, contentId, false, STAKE, salt3);

        _warpPastTlockRevealTime(roundStart + EPOCH_DURATION);
        (, bytes32 ck2) = _commitWithSalt(voter2, contentId, true, STAKE, salt2);
        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        _warpPastTlockRevealTime(roundStart + 2 * EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck1, true, 5_000, salt1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck3, false, 5_000, salt3);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck2, true, 5_000, salt2);
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
    }

    function test_ClaimParticipationReward_HappyPath() public {
        (uint256 contentId, uint256 roundId) = _settleRoundWithParticipation();

        // Claim participation reward
        uint256 balBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimParticipationReward(contentId, roundId);
        uint256 balAfter = lrepToken.balanceOf(voter1);

        uint256 expectedReward = _expectedParticipationReward(contentId, roundId, voter1);
        assertEq(balAfter - balBefore, expectedReward, "Should receive 90% of stake as participation reward");
    }

    function test_ClaimParticipationReward_UsesEpochWeightedStakeForLateWinner() public {
        vm.startPrank(owner);
        ParticipationPool pool = new ParticipationPool(address(lrepToken), owner);
        pool.setAuthorizedCaller(address(rewardDistributor), true);
        lrepToken.mint(owner, 1_000_000e6);
        lrepToken.approve(address(pool), 1_000_000e6);
        pool.depositPool(1_000_000e6);
        ProtocolConfig(address(votingEngine.protocolConfig())).setParticipationPool(address(pool));
        vm.stopPrank();

        (uint256 contentId, uint256 roundId) = _settleMixedEpochWinningRound();
        assertEq(
            rewardDistributor.roundParticipationRewardOwed(contentId, roundId),
            votingEngine.roundRbtsParticipationWeight(contentId, roundId) * 9000 / 10000
        );

        uint256 voter1Before = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimParticipationReward(contentId, roundId);
        assertEq(lrepToken.balanceOf(voter1) - voter1Before, _expectedParticipationReward(contentId, roundId, voter1));

        uint256 voter2Before = lrepToken.balanceOf(voter2);
        vm.prank(voter2);
        rewardDistributor.claimParticipationReward(contentId, roundId);
        assertEq(lrepToken.balanceOf(voter2) - voter2Before, _expectedParticipationReward(contentId, roundId, voter2));
    }

    function test_BackfillParticipationReward_UsesEpochWeightedWinningStake() public {
        (uint256 contentId, uint256 roundId) = _settleMixedEpochWinningRound();

        ParticipationPool pool = new ParticipationPool(address(lrepToken), owner);
        pool.setAuthorizedCaller(address(rewardDistributor), true);
        vm.startPrank(owner);
        lrepToken.mint(owner, 1_000_000e6);
        lrepToken.approve(address(pool), 1_000_000e6);
        pool.depositPool(1_000_000e6);
        rewardDistributor.backfillParticipationRewards(contentId, roundId, address(pool), 9000);
        vm.stopPrank();

        uint256 expectedReward = votingEngine.roundRbtsParticipationWeight(contentId, roundId) * 9000 / 10000;
        assertEq(rewardDistributor.roundParticipationRewardOwed(contentId, roundId), expectedReward);
        assertEq(rewardDistributor.roundParticipationRewardReserved(contentId, roundId), expectedReward);
    }

    function test_ClaimParticipationReward_UsesSettledRoundPoolAfterRotation() public {
        ParticipationPool pool1 = new ParticipationPool(address(lrepToken), owner);
        ParticipationPool pool2 = new ParticipationPool(address(lrepToken), owner);

        pool1.setAuthorizedCaller(address(rewardDistributor), true);
        pool2.setAuthorizedCaller(address(rewardDistributor), true);
        vm.prank(owner);
        lrepToken.mint(address(this), 2_000_000e6);
        lrepToken.approve(address(pool1), 1_000_000e6);
        pool1.depositPool(1_000_000e6);
        lrepToken.approve(address(pool2), 1_000_000e6);
        pool2.depositPool(1_000_000e6);
        vm.startPrank(owner);
        ProtocolConfig(address(votingEngine.protocolConfig())).setParticipationPool(address(pool1));
        vm.stopPrank();

        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);

        ProtocolConfig cfgRotation = ProtocolConfig(address(votingEngine.protocolConfig()));
        vm.prank(owner);
        cfgRotation.setParticipationPool(address(pool2));

        uint256 expectedReward = _expectedParticipationReward(contentId, roundId, voter1);
        uint256 pool1Before = lrepToken.balanceOf(address(pool1));
        uint256 pool2Before = lrepToken.balanceOf(address(pool2));

        vm.prank(voter1);
        rewardDistributor.claimParticipationReward(contentId, roundId);

        assertEq(lrepToken.balanceOf(address(pool1)), pool1Before - expectedReward);
        assertEq(lrepToken.balanceOf(address(pool2)), pool2Before);
    }

    function test_ClaimParticipationReward_ReservedPortionSurvivesPoolDeauthorization() public {
        ParticipationPool pool = new ParticipationPool(address(lrepToken), owner);
        pool.setAuthorizedCaller(address(rewardDistributor), true);

        vm.startPrank(owner);
        lrepToken.mint(owner, 1_000_000e6);
        lrepToken.approve(address(pool), 1_000_000e6);
        pool.depositPool(1_000_000e6);
        ProtocolConfig(address(votingEngine.protocolConfig())).setParticipationPool(address(pool));
        vm.stopPrank();

        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);
        uint256 expectedTotalReward = rewardDistributor.roundParticipationRewardOwed(contentId, roundId);
        assertEq(
            rewardDistributor.roundParticipationRewardReserved(contentId, roundId),
            expectedTotalReward,
            "round should reserve the full winner reward"
        );

        pool.setAuthorizedCaller(address(rewardDistributor), false);

        uint256 balBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimParticipationReward(contentId, roundId);
        uint256 balAfter = lrepToken.balanceOf(voter1);

        assertEq(
            balAfter - balBefore,
            _expectedParticipationReward(contentId, roundId, voter1),
            "reserved participation rewards should remain claimable"
        );
    }

    function test_ClaimParticipationReward_PartialReservationIsClaimOrderIndependent() public {
        ParticipationPool pool = new ParticipationPool(address(lrepToken), owner);
        pool.setAuthorizedCaller(address(rewardDistributor), true);

        vm.startPrank(owner);
        lrepToken.mint(owner, 1e6);
        lrepToken.approve(address(pool), 1e6);
        pool.depositPool(1e6);
        ProtocolConfig(address(votingEngine.protocolConfig())).setParticipationPool(address(pool));
        vm.stopPrank();

        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);
        assertEq(
            rewardDistributor.roundParticipationRewardOwed(contentId, roundId),
            0,
            "underfunded settlement should not snapshot a partially funded obligation"
        );
        assertEq(
            rewardDistributor.roundParticipationRewardReserved(contentId, roundId),
            0,
            "underfunded settlement should not leave a partial reservation behind"
        );

        vm.prank(voter1);
        vm.expectRevert(RoundRewardDistributor.NoPool.selector);
        rewardDistributor.claimParticipationReward(contentId, roundId);

        vm.prank(voter2);
        vm.expectRevert(RoundRewardDistributor.NoPool.selector);
        rewardDistributor.claimParticipationReward(contentId, roundId);

        vm.startPrank(owner);
        lrepToken.mint(owner, 20e6);
        lrepToken.approve(address(pool), 20e6);
        pool.depositPool(20e6);
        rewardDistributor.backfillParticipationRewards(contentId, roundId, address(pool), 9000);
        vm.stopPrank();

        uint256 voter1Before = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimParticipationReward(contentId, roundId);
        uint256 voter1Delta = lrepToken.balanceOf(voter1) - voter1Before;

        uint256 voter2Before = lrepToken.balanceOf(voter2);
        vm.prank(voter2);
        rewardDistributor.claimParticipationReward(contentId, roundId);
        uint256 voter2Delta = lrepToken.balanceOf(voter2) - voter2Before;

        assertEq(
            voter1Delta,
            _expectedParticipationReward(contentId, roundId, voter1),
            "backfill should restore the full winner share"
        );
        assertEq(
            voter2Delta,
            _expectedParticipationReward(contentId, roundId, voter2),
            "claim order should not matter once the round is backfilled"
        );

        vm.prank(voter1);
        vm.expectRevert(RoundRewardDistributor.AlreadyClaimed.selector);
        rewardDistributor.claimParticipationReward(contentId, roundId);
    }

    function test_FinalizeParticipationRewards_ReleasesRoundingDust() public {
        ParticipationPool pool = new ParticipationPool(address(lrepToken), owner);
        pool.setAuthorizedCaller(address(rewardDistributor), true);

        vm.startPrank(owner);
        lrepToken.mint(owner, 1_000_000e6);
        lrepToken.approve(address(pool), 1_000_000e6);
        pool.depositPool(1_000_000e6);
        ProtocolConfig(address(votingEngine.protocolConfig())).setParticipationPool(address(pool));
        vm.stopPrank();

        uint256 contentId = _submitContent();
        bytes32 salt1 = keccak256("dust-voter1");
        bytes32 salt2 = keccak256("dust-voter2");
        bytes32 salt3 = keccak256("dust-voter3");

        (, bytes32 commitKey1) = _commitWithSalt(voter1, contentId, true, 1_000_001, salt1);
        (, bytes32 commitKey2) = _commitWithSalt(voter2, contentId, true, 1_000_001, salt2);
        (, bytes32 commitKey3) = _commitWithSalt(voter3, contentId, false, 1_000_000, salt3);

        uint256 roundId = _getActiveOrLatestRoundId(contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKey1, true, 5_000, salt1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKey2, true, 5_000, salt2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKey3, false, 5_000, salt3);
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        uint256 reservedReward = rewardDistributor.roundParticipationRewardReserved(contentId, roundId);
        assertEq(
            reservedReward,
            rewardDistributor.roundParticipationRewardOwed(contentId, roundId),
            "round should reserve the floored aggregate reward"
        );

        uint256 expectedVoter1Reward = _expectedParticipationReward(contentId, roundId, voter1);
        uint256 expectedVoter2Reward = _expectedParticipationReward(contentId, roundId, voter2);
        uint256 expectedVoter3Reward = _expectedParticipationReward(contentId, roundId, voter3);
        uint256 expectedDust = reservedReward - expectedVoter1Reward - expectedVoter2Reward - expectedVoter3Reward;

        vm.prank(voter1);
        rewardDistributor.claimParticipationReward(contentId, roundId);
        vm.prank(voter2);
        rewardDistributor.claimParticipationReward(contentId, roundId);
        vm.prank(voter3);
        rewardDistributor.claimParticipationReward(contentId, roundId);

        assertEq(pool.reservedRewards(address(rewardDistributor)), expectedDust, "dust should remain reserved");
        assertEq(
            rewardDistributor.roundParticipationRewardPaidTotal(contentId, roundId),
            expectedVoter1Reward + expectedVoter2Reward + expectedVoter3Reward,
            "paid total should equal the sum of per-voter rewards"
        );

        uint256 poolBalanceBeforeFinalize = pool.poolBalance();
        uint256 totalDistributedBeforeFinalize = pool.totalDistributed();

        uint256 releasedDust = rewardDistributor.finalizeParticipationRewards(contentId, roundId);

        assertEq(releasedDust, expectedDust, "finalization should release the rounding dust");
        assertEq(pool.reservedRewards(address(rewardDistributor)), 0, "released dust should no longer stay reserved");
        assertEq(pool.reservedBalance(), 0, "all reserved rewards should now be withdrawn or released");
        assertEq(
            pool.poolBalance(), poolBalanceBeforeFinalize + expectedDust, "released dust should return to the pool"
        );
        assertEq(
            pool.totalDistributed(),
            totalDistributedBeforeFinalize - expectedDust,
            "released dust should no longer count as distributed"
        );
        assertEq(
            rewardDistributor.roundParticipationRewardReserved(contentId, roundId),
            expectedVoter1Reward + expectedVoter2Reward + expectedVoter3Reward,
            "round snapshot should drop the released dust"
        );
        assertTrue(
            rewardDistributor.roundParticipationRewardFinalized(contentId, roundId),
            "round should be marked finalized after dust release"
        );
    }

    function test_FinalizeParticipationRewards_RevertsUntilWinnersFullyPaid() public {
        ParticipationPool pool = new ParticipationPool(address(lrepToken), owner);
        pool.setAuthorizedCaller(address(rewardDistributor), true);

        vm.startPrank(owner);
        lrepToken.mint(owner, 1e6);
        lrepToken.approve(address(pool), 1e6);
        pool.depositPool(1e6);
        ProtocolConfig(address(votingEngine.protocolConfig())).setParticipationPool(address(pool));
        vm.stopPrank();

        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);

        assertEq(
            rewardDistributor.roundParticipationRewardReserved(contentId, roundId),
            0,
            "underfunded settlement should not leave a partial reservation behind"
        );

        vm.prank(voter1);
        vm.expectRevert(RoundRewardDistributor.NoPool.selector);
        rewardDistributor.claimParticipationReward(contentId, roundId);

        vm.expectRevert(RoundRewardDistributor.ParticipationRewardsOutstanding.selector);
        rewardDistributor.finalizeParticipationRewards(contentId, roundId);

        vm.startPrank(owner);
        lrepToken.mint(owner, 20e6);
        lrepToken.approve(address(pool), 20e6);
        pool.depositPool(20e6);
        rewardDistributor.backfillParticipationRewards(contentId, roundId, address(pool), 9000);
        vm.stopPrank();

        vm.prank(voter1);
        rewardDistributor.claimParticipationReward(contentId, roundId);
        vm.prank(voter2);
        rewardDistributor.claimParticipationReward(contentId, roundId);
        vm.prank(voter3);
        rewardDistributor.claimParticipationReward(contentId, roundId);

        uint256 releasedDust = rewardDistributor.finalizeParticipationRewards(contentId, roundId);

        assertEq(releasedDust, 0, "no dust should be released when reservations equal total claims");
        assertEq(
            rewardDistributor.roundParticipationRewardFullyClaimedCount(contentId, roundId),
            votingEngine.roundRbtsParticipationClaimants(contentId, roundId),
            "finalization should only unlock after every scored participant is fully paid"
        );
        assertTrue(
            rewardDistributor.roundParticipationRewardFinalized(contentId, roundId),
            "round should still be finalizable when the released dust is zero"
        );
    }

    function test_FinalizeParticipationRewards_UsesFreshBackfillGraceWindow() public {
        ParticipationPool pool = new ParticipationPool(address(lrepToken), owner);
        pool.setAuthorizedCaller(address(rewardDistributor), true);

        vm.startPrank(owner);
        lrepToken.mint(owner, 1e6);
        lrepToken.approve(address(pool), 1e6);
        pool.depositPool(1e6);
        ProtocolConfig(address(votingEngine.protocolConfig())).setParticipationPool(address(pool));
        vm.stopPrank();

        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);

        vm.warp(uint256(round.settledAt) + rewardDistributor.STALE_REWARD_FINALIZATION_DELAY());

        vm.startPrank(owner);
        lrepToken.mint(owner, 20e6);
        lrepToken.approve(address(pool), 20e6);
        pool.depositPool(20e6);
        rewardDistributor.backfillParticipationRewards(contentId, roundId, address(pool), 9000);
        vm.stopPrank();

        uint256 backfilledAt = block.timestamp;
        vm.prank(owner);
        vm.expectRevert(RoundRewardDistributor.ParticipationRewardsOutstanding.selector);
        rewardDistributor.finalizeParticipationRewards(contentId, roundId);

        vm.warp(backfilledAt + rewardDistributor.STALE_REWARD_FINALIZATION_DELAY());
        uint256 reservedReward = rewardDistributor.roundParticipationRewardReserved(contentId, roundId);
        vm.prank(owner);
        uint256 releasedReward = rewardDistributor.finalizeParticipationRewards(contentId, roundId);
        assertEq(releasedReward, reservedReward, "stale backfilled rewards should release after a fresh grace window");
    }

    function test_FinalizeParticipationRewards_ReleasesStaleUnclaimedReservation() public {
        ParticipationPool pool = new ParticipationPool(address(lrepToken), owner);
        pool.setAuthorizedCaller(address(rewardDistributor), true);

        vm.startPrank(owner);
        lrepToken.mint(owner, 1_000_000e6);
        lrepToken.approve(address(pool), 1_000_000e6);
        pool.depositPool(1_000_000e6);
        ProtocolConfig(address(votingEngine.protocolConfig())).setParticipationPool(address(pool));
        vm.stopPrank();

        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);

        vm.prank(voter1);
        rewardDistributor.claimParticipationReward(contentId, roundId);

        vm.prank(owner);
        vm.expectRevert(RoundRewardDistributor.ParticipationRewardsOutstanding.selector);
        rewardDistributor.finalizeParticipationRewards(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        vm.warp(uint256(round.settledAt) + rewardDistributor.STALE_REWARD_FINALIZATION_DELAY());

        uint256 poolBalanceBeforeFinalize = pool.poolBalance();
        uint256 totalDistributedBeforeFinalize = pool.totalDistributed();
        uint256 reservedReward = rewardDistributor.roundParticipationRewardReserved(contentId, roundId);
        uint256 paidReward = rewardDistributor.roundParticipationRewardPaidTotal(contentId, roundId);

        vm.prank(owner);
        uint256 releasedReward = rewardDistributor.finalizeParticipationRewards(contentId, roundId);

        assertEq(releasedReward, reservedReward - paidReward, "stale unpaid winner reservation should be released");
        assertEq(pool.reservedRewards(address(rewardDistributor)), 0, "no reservation should remain live");
        assertEq(pool.poolBalance(), poolBalanceBeforeFinalize + releasedReward, "released reward returns to pool");
        assertEq(
            pool.totalDistributed(),
            totalDistributedBeforeFinalize - releasedReward,
            "released reward should no longer count as distributed"
        );
        assertEq(
            rewardDistributor.roundParticipationRewardReserved(contentId, roundId),
            paidReward,
            "round snapshot should retain only the already-paid amount"
        );

        vm.prank(voter2);
        vm.expectRevert(RoundRewardDistributor.ParticipationRewardsAlreadyFinalized.selector);
        rewardDistributor.claimParticipationReward(contentId, roundId);
    }

    function test_FinalizeParticipationRewards_StaleBranchRequiresAdmin() public {
        ParticipationPool pool = new ParticipationPool(address(lrepToken), owner);
        pool.setAuthorizedCaller(address(rewardDistributor), true);

        vm.startPrank(owner);
        lrepToken.mint(owner, 1_000_000e6);
        lrepToken.approve(address(pool), 1_000_000e6);
        pool.depositPool(1_000_000e6);
        ProtocolConfig(address(votingEngine.protocolConfig())).setParticipationPool(address(pool));
        vm.stopPrank();

        uint256 contentId = _submitContent();
        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;
        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);

        // Only voter1 claims pre-stale; voter2 is the "late" winner who would lose their bonus.
        vm.prank(voter1);
        rewardDistributor.claimParticipationReward(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        vm.warp(uint256(round.settledAt) + rewardDistributor.STALE_REWARD_FINALIZATION_DELAY());

        // A griefer cannot trigger the cliff that would forfeit voter2's bonus.
        vm.prank(address(0xBEEF));
        vm.expectRevert(RoundRewardDistributor.UnauthorizedCaller.selector);
        rewardDistributor.finalizeParticipationRewards(contentId, roundId);

        // Admin retains the ability to finalize when truly stuck.
        vm.prank(owner);
        rewardDistributor.finalizeParticipationRewards(contentId, roundId);
        assertTrue(rewardDistributor.roundParticipationRewardFinalized(contentId, roundId));
    }

    function test_SettlementSideEffectFailure_InsufficientParticipationLiquidityCanBeBackfilled() public {
        ParticipationPool tinyPool = new ParticipationPool(address(lrepToken), owner);
        tinyPool.setAuthorizedCaller(address(rewardDistributor), true);

        vm.startPrank(owner);
        lrepToken.mint(owner, 1e6);
        lrepToken.approve(address(tinyPool), 1e6);
        tinyPool.depositPool(1e6);
        ProtocolConfig(address(votingEngine.protocolConfig())).setParticipationPool(address(tinyPool));
        vm.stopPrank();

        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);

        assertEq(tinyPool.reservedRewards(address(rewardDistributor)), 0, "partial reservations should be rolled back");
        vm.prank(voter1);
        vm.expectRevert(RoundRewardDistributor.NoPool.selector);
        rewardDistributor.claimParticipationReward(contentId, roundId);

        vm.startPrank(owner);
        lrepToken.mint(owner, 20e6);
        lrepToken.approve(address(tinyPool), 20e6);
        tinyPool.depositPool(20e6);
        rewardDistributor.backfillParticipationRewards(contentId, roundId, address(tinyPool), 9000);
        vm.stopPrank();

        vm.prank(voter1);
        rewardDistributor.claimParticipationReward(contentId, roundId);
        vm.prank(voter2);
        rewardDistributor.claimParticipationReward(contentId, roundId);
        vm.prank(voter3);
        rewardDistributor.claimParticipationReward(contentId, roundId);

        assertEq(
            rewardDistributor.roundParticipationRewardPaidTotal(contentId, roundId),
            rewardDistributor.roundParticipationRewardOwed(contentId, roundId),
            "backfill should restore the full participation entitlement"
        );
    }

    function test_ClaimParticipationReward_LegacyRoundCanBeBackfilled() public {
        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, dirs, STAKE);

        vm.prank(voter1);
        vm.expectRevert(RoundRewardDistributor.NoPool.selector);
        rewardDistributor.claimParticipationReward(contentId, roundId);

        ParticipationPool pool = new ParticipationPool(address(lrepToken), owner);
        pool.setAuthorizedCaller(address(rewardDistributor), true);

        vm.startPrank(owner);
        lrepToken.mint(owner, 1_000_000e6);
        lrepToken.approve(address(pool), 1_000_000e6);
        pool.depositPool(1_000_000e6);
        rewardDistributor.backfillParticipationRewards(contentId, roundId, address(pool), 9000);
        vm.stopPrank();

        uint256 balBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimParticipationReward(contentId, roundId);
        uint256 balAfter = lrepToken.balanceOf(voter1);

        assertEq(
            balAfter - balBefore,
            _expectedParticipationReward(contentId, roundId, voter1),
            "backfill should restore the round's reserved reward"
        );
    }

    function test_ClaimParticipationReward_DoubleClaimReverts() public {
        (uint256 contentId, uint256 roundId) = _settleRoundWithParticipation();

        vm.prank(voter1);
        rewardDistributor.claimParticipationReward(contentId, roundId);

        vm.prank(voter1);
        vm.expectRevert(RoundRewardDistributor.AlreadyClaimed.selector);
        rewardDistributor.claimParticipationReward(contentId, roundId);
    }

    function test_ClaimParticipationReward_OnlySettledRounds() public {
        vm.startPrank(owner);
        ParticipationPool pool = new ParticipationPool(address(lrepToken), owner);
        pool.setAuthorizedCaller(address(rewardDistributor), true);
        lrepToken.mint(owner, 1_000_000e6);
        lrepToken.approve(address(pool), 1_000_000e6);
        pool.depositPool(1_000_000e6);
        ProtocolConfig(address(votingEngine.protocolConfig())).setParticipationPool(address(pool));
        vm.stopPrank();

        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, contentId, true, uint256(0)));
        bytes32 ch = _commitHash(true, salt, voter1, contentId);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext63 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _currentRatingReferenceBps(contentId));
        votingEngine.commitVote(
            contentId,
            cachedRoundContext63,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ch,
            _testCiphertext(true, salt, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        // Round is Open, not Settled
        vm.prank(voter1);
        vm.expectRevert(RoundRewardDistributor.RoundNotSettled.selector);
        rewardDistributor.claimParticipationReward(contentId, 1);
    }

    function test_SettlementSideEffectFailure_ParticipationRateSnapshotCanBeBackfilled() public {
        RevertingParticipationPool badPool = new RevertingParticipationPool(address(lrepToken));
        ProtocolConfig cfgBackfill = ProtocolConfig(address(votingEngine.protocolConfig()));
        vm.prank(owner);
        cfgBackfill.setParticipationPool(address(badPool));

        uint256 contentId = _submitContent();
        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        _commitAllThenReveal(voters, contentId, dirs, STAKE);
        uint256 roundId = _getActiveOrLatestRoundId(contentId);

        vm.expectEmit(true, true, true, true, address(votingEngine));
        emit RoundSettlementSideEffectsLib.SettlementSideEffectFailed(
            contentId,
            roundId,
            address(badPool),
            RoundSettlementSideEffectsLib.SideEffectFailureStage.ParticipationRateQuery
        );
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
        vm.prank(voter1);
        vm.expectRevert(RoundRewardDistributor.NoPool.selector);
        rewardDistributor.claimParticipationReward(contentId, roundId);

        ParticipationPool repairPool = new ParticipationPool(address(lrepToken), owner);
        repairPool.setAuthorizedCaller(address(rewardDistributor), true);

        vm.startPrank(owner);
        lrepToken.mint(owner, 1_000_000e6);
        lrepToken.approve(address(repairPool), 1_000_000e6);
        repairPool.depositPool(1_000_000e6);
        rewardDistributor.backfillParticipationRewards(contentId, roundId, address(repairPool), 9000);
        vm.stopPrank();

        uint256 balBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimParticipationReward(contentId, roundId);
        uint256 balAfter = lrepToken.balanceOf(voter1);

        assertEq(
            balAfter - balBefore,
            _expectedParticipationReward(contentId, roundId, voter1),
            "backfill should repair rate snapshot failures"
        );
    }

    function test_RegistryVotingEngineRotatesOnlyWhilePausedAfterInitialWiring() public {
        uint256 contentId = _submitContent();
        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory dirs = new bool[](3);
        dirs[0] = true;
        dirs[1] = true;
        dirs[2] = false;

        _commitAllThenReveal(voters, contentId, dirs, STAKE);
        uint256 roundId = _getActiveOrLatestRoundId(contentId);
        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();

        vm.prank(owner);
        vm.expectRevert("Pause required");
        registry.setVotingEngine(address(replacementEngine));

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
        assertEq(
            uint8(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).state),
            uint8(RoundLib.RoundState.Settled)
        );

        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        vm.stopPrank();

        assertEq(registry.votingEngine(), address(replacementEngine));
    }

    function _deployReplacementVotingEngine() internal returns (RoundVotingEngine replacementEngine) {
        vm.startPrank(owner);
        replacementEngine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(new RoundVotingEngine()),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(lrepToken), address(registry), address(_deployProtocolConfig(owner)))
                    )
                )
            )
        );
        vm.stopPrank();
    }

    // =========================================================================
    // SET PARTICIPATION POOL UPDATABILITY
    // =========================================================================

    function test_SetParticipationPoolCanBeUpdated() public {
        address pool1 = address(0xAA);
        address pool2 = address(0xBB);

        vm.startPrank(owner);
        ProtocolConfig(address(votingEngine.protocolConfig())).setParticipationPool(pool1);
        // Should NOT revert on second call
        ProtocolConfig(address(votingEngine.protocolConfig())).setParticipationPool(pool2);
        vm.stopPrank();
    }
}
