// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VotingTestBase} from "./helpers/VotingTestHelpers.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ContentRegistry} from "../contracts/ContentRegistry.sol";
import {LaunchDistributionPool} from "../contracts/LaunchDistributionPool.sol";
import {LoopReputation} from "../contracts/LoopReputation.sol";
import {RoundVotingEngine} from "../contracts/RoundVotingEngine.sol";
import {ProtocolConfig} from "../contracts/ProtocolConfig.sol";
import {RaterRegistry} from "../contracts/RaterRegistry.sol";
import {RoundRewardDistributor} from "../contracts/RoundRewardDistributor.sol";
import {RoundLib} from "../contracts/libraries/RoundLib.sol";
import {RoundEngineReadHelpers} from "./helpers/RoundEngineReadHelpers.sol";
import {TlockVoteLib} from "../contracts/libraries/TlockVoteLib.sol";
import {HumanReputation} from "../contracts/HumanReputation.sol";
import {MockCategoryRegistry} from "../contracts/mocks/MockCategoryRegistry.sol";
import {MockWorldIDRouter} from "../contracts/mocks/MockWorldIDRouter.sol";

contract MockRaterDeclarationStatusForRewards {
    mapping(address => bool) public hasActiveAiDeclaration;

    function setActiveAiDeclaration(address rater, bool active) external {
        hasActiveAiDeclaration[rater] = active;
    }
}

/// @title RoundRewardDistributor branch coverage tests (tlock commit-reveal)
contract RoundRewardDistributorBranchesTest is VotingTestBase {
    HumanReputation public hrepToken;
    ContentRegistry public registry;
    RoundVotingEngine public votingEngine;
    RoundRewardDistributor public rewardDistributor;
    LoopReputation public lrepToken;
    RaterRegistry public raterRegistry;
    MockWorldIDRouter public worldIdRouter;
    LaunchDistributionPool public launchPool;

    address public owner = address(1);
    address public submitter = address(2);
    address public voter1 = address(3);
    address public voter2 = address(4);
    address public voter3 = address(5);
    address public keeper = address(9);
    address public treasury = address(100);

    uint256 public constant T0 = 1000;
    uint256 public constant STAKE = 5e6;
    uint256 public constant EPOCH_DURATION = 5 minutes;

    function setUp() public {
        vm.warp(T0);
        vm.startPrank(owner);

        hrepToken = new HumanReputation(owner, owner);
        hrepToken.grantRole(hrepToken.MINTER_ROLE(), owner);

        ContentRegistry registryImpl = new ContentRegistry();
        RoundVotingEngine engineImpl = new RoundVotingEngine();
        RoundRewardDistributor distImpl = new RoundRewardDistributor();

        registry = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(hrepToken)))
                )
            )
        );
        votingEngine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(engineImpl),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(hrepToken), address(registry), address(_deployProtocolConfig(owner)))
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
                        (owner, address(hrepToken), address(votingEngine), address(registry))
                    )
                )
            )
        );

        registry.setVotingEngine(address(votingEngine));
        MockCategoryRegistry mockCategoryRegistry = new MockCategoryRegistry();
        mockCategoryRegistry.seedDefaultTestCategories();
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig config = ProtocolConfig(address(votingEngine.protocolConfig()));
        config.setRewardDistributor(address(rewardDistributor));
        config.setCategoryRegistry(address(mockCategoryRegistry));
        config.setTreasury(treasury);
        // 4 params: epochDuration, maxDuration, minVoters, maxVoters
        _setTlockRoundConfig(config, EPOCH_DURATION, 7 days, 3, 200);

        lrepToken = new LoopReputation(owner, owner);
        worldIdRouter = new MockWorldIDRouter();
        raterRegistry = new RaterRegistry(owner, owner, address(worldIdRouter), bytes32("rate-loop"), 1, 365 days);
        launchPool = new LaunchDistributionPool(address(lrepToken), address(raterRegistry), owner);
        launchPool.setAuthorizedCaller(address(rewardDistributor), true);
        lrepToken.mint(owner, launchPool.TOTAL_POOL_AMOUNT());
        lrepToken.approve(address(launchPool), launchPool.TOTAL_POOL_AMOUNT());
        launchPool.depositPool(launchPool.TOTAL_POOL_AMOUNT());
        config.setRaterRegistry(address(raterRegistry));
        config.setLaunchDistributionPool(address(launchPool));

        hrepToken.mint(owner, 1_000_000e6);
        hrepToken.approve(address(votingEngine), 500_000e6);
        votingEngine.addToConsensusReserve(500_000e6);

        address[5] memory users = [submitter, voter1, voter2, voter3, keeper];
        for (uint256 i = 0; i < users.length; i++) {
            hrepToken.mint(users[i], 10_000e6);
        }

        vm.stopPrank();
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    function _commit(address voter, uint256 contentId, bool isUp, uint256 stake)
        internal
        returns (bytes32 ck, bytes32 salt)
    {
        salt = keccak256(abi.encodePacked(voter, contentId));
        bytes32 ch = _commitHash(isUp, salt, voter, contentId);
        bytes memory ct = _testCiphertext(isUp, salt, contentId);
        vm.prank(voter);
        hrepToken.approve(address(votingEngine), stake);
        uint256 cachedRoundContext1 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter);
        votingEngine.commitVote(
            contentId, cachedRoundContext1, _tlockCommitTargetRound(), _tlockDrandChainHash(), ch, ct, stake, address(0)
        );
        ck = _commitKey(voter, ch);
    }

    function _vote(address voter, uint256 contentId, bool isUp) internal {
        _commit(voter, contentId, isUp, STAKE);
    }

    function _commitPrediction(address voter, uint256 contentId, uint16 predictedRatingBps, uint256 stake)
        internal
        returns (bytes32 commitKey, bytes32 salt)
    {
        salt = keccak256(abi.encodePacked(voter, predictedRatingBps, block.timestamp));
        uint256 roundId = votingEngine.previewCommitRoundId(contentId);
        uint16 referenceRatingBps = votingEngine.previewCommitReferenceRatingBps(contentId);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bool isUp = predictedRatingBps >= 5_000;
        bytes memory ciphertext = _testCiphertext(isUp, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = TlockVoteLib.buildExpectedRbtsCommitHash(
            isUp,
            predictedRatingBps,
            salt,
            voter,
            contentId,
            roundId,
            referenceRatingBps,
            targetRound,
            drandChainHash,
            ciphertext
        );

        commitKey = _commitKey(voter, commitHash);

        vm.startPrank(voter);
        hrepToken.approve(address(votingEngine), stake);
        votingEngine.commitVote(
            contentId,
            _roundContext(roundId, referenceRatingBps),
            targetRound,
            drandChainHash,
            commitHash,
            ciphertext,
            stake,
            address(0)
        );
        vm.stopPrank();
    }

    function _revealAll(uint256 contentId, uint256 roundId) internal {
        bytes32[] memory keys = RoundEngineReadHelpers.commitKeys(votingEngine, contentId, roundId);
        for (uint256 i = 0; i < keys.length; i++) {
            RoundLib.Commit memory c = RoundEngineReadHelpers.commit(votingEngine, contentId, roundId, keys[i]);
            if (!c.revealed && c.stakeAmount > 0) {
                (bool isUp, bytes32 salt) = _decodeTestCiphertext(c.ciphertext);
                try votingEngine.revealVoteByCommitKey(contentId, roundId, keys[i], isUp, 5_000, salt) {} catch {}
            }
        }
    }

    function _forceSettle(uint256 contentId) internal {
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        if (roundId == 0) return;

        RoundLib.Round memory r = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r.startTime) + EPOCH_DURATION);
        _revealAll(contentId, roundId);

        RoundLib.Round memory r2 = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        if (r2.thresholdReachedAt > 0) {
            try votingEngine.settleRound(contentId, roundId) {} catch {}
        }
    }

    function _setupSettledRound() internal returns (uint256 contentId, uint256 roundId) {
        vm.startPrank(submitter);
        hrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/1", "goal", "goal", "tags", 0);
        vm.stopPrank();
        contentId = 1;

        _vote(voter1, contentId, true);
        _vote(voter2, contentId, true);
        _vote(voter3, contentId, false);

        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        _forceSettle(contentId);
    }

    function _setupSettledPredictionRound() internal returns (uint256 contentId, uint256 roundId) {
        return _setupSettledPredictionRoundWithStakes(STAKE, STAKE, STAKE);
    }

    function _setupSettledPredictionRoundWithStakes(uint256 voter1Stake, uint256 voter2Stake, uint256 voter3Stake)
        internal
        returns (uint256 contentId, uint256 roundId)
    {
        vm.startPrank(submitter);
        hrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/prediction", "goal", "goal", "tags", 0);
        vm.stopPrank();
        contentId = 1;

        (bytes32 ck1, bytes32 s1) = _commitPrediction(voter1, contentId, 8_000, voter1Stake);
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, 8_000, voter2Stake);
        (bytes32 ck3, bytes32 s3) = _commitPrediction(voter3, contentId, 7_000, voter3Stake);

        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH_DURATION);

        votingEngine.revealVoteByCommitKey(contentId, roundId, ck1, true, 8_000, s1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck2, true, 8_000, s2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck3, true, 7_000, s3);
        votingEngine.settleRound(contentId, roundId);
    }

    function _verifyHuman(address account, bytes32 nullifier) internal {
        uint256[8] memory proof;
        vm.prank(account);
        raterRegistry.attestHumanCredentialWithProof(1, uint256(nullifier), proof);
    }

    // =========================================================================
    // claimReward BRANCHES
    // =========================================================================

    function test_ClaimReward_AlreadyClaimed_Reverts() public {
        (uint256 contentId, uint256 roundId) = _setupSettledRound();

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        vm.prank(voter1);
        vm.expectRevert("Already claimed");
        rewardDistributor.claimReward(contentId, roundId);
    }

    function test_ClaimReward_RoundNotSettled_Reverts() public {
        vm.startPrank(submitter);
        hrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/1", "goal", "goal", "tags", 0);
        vm.stopPrank();

        _vote(voter1, 1, true);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, 1);

        vm.prank(voter1);
        vm.expectRevert("Round not settled");
        rewardDistributor.claimReward(1, roundId);
    }

    function test_ClaimReward_NoVoteFound_Reverts() public {
        (uint256 contentId, uint256 roundId) = _setupSettledRound();

        // keeper never committed
        vm.prank(keeper);
        vm.expectRevert("No vote found");
        rewardDistributor.claimReward(contentId, roundId);
    }

    function test_ClaimReward_RbtsScoredVoterGetsStakeReturnAndReward() public {
        (uint256 contentId, uint256 roundId) = _setupSettledRound();
        bytes32 voter3CommitKey =
            keccak256(abi.encodePacked(voter3, votingEngine.voterCommitHash(contentId, roundId, voter3)));
        uint256 rbtsStakeReturned = votingEngine.commitRbtsStakeReturned(contentId, roundId, voter3CommitKey);

        uint256 balBefore = hrepToken.balanceOf(voter3);
        vm.prank(voter3);
        rewardDistributor.claimReward(contentId, roundId);
        uint256 balAfter = hrepToken.balanceOf(voter3);

        uint256 claimedAmount = balAfter - balBefore;
        assertGt(rbtsStakeReturned, 0, "RBTS returns scored stake");
        assertGe(claimedAmount, rbtsStakeReturned, "claim includes scored stake return");
        assertGt(claimedAmount, STAKE / 20, "not capped at old loser rebate");
    }

    function test_ClaimReward_WinnerGetsReward() public {
        (uint256 contentId, uint256 roundId) = _setupSettledRound();

        uint256 balBefore = hrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);
        uint256 balAfter = hrepToken.balanceOf(voter1);

        assertGt(balAfter, balBefore); // winner gets stake + reward
    }

    function test_ClaimReward_RecordsLaunchCreditWithVerifiedHumanAnchor() public {
        _verifyHuman(voter2, bytes32("anchor-voter-2"));
        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertEq(launchPool.qualifyingRatingCount(voter1), 1);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 1);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 1);
        assertEq(lrepToken.balanceOf(voter1), 0);
    }

    function test_ClaimReward_ZeroStakeVoteCanRecordLaunchCredit() public {
        _verifyHuman(voter2, bytes32("anchor-voter-2"));
        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRoundWithStakes(0, STAKE, STAKE);
        bytes32 voter1CommitKey =
            keccak256(abi.encodePacked(voter1, votingEngine.voterCommitHash(contentId, roundId, voter1)));

        uint256 hrepBefore = hrepToken.balanceOf(voter1);
        uint256 lrepBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertGe(
            votingEngine.commitRbtsScoreBps(contentId, roundId, voter1CommitKey),
            launchPool.MIN_QUALIFYING_SCORE_BPS(),
            "zero-stake vote has qualifying RBTS score"
        );
        assertEq(votingEngine.commitRbtsRewardWeight(contentId, roundId, voter1CommitKey), 0);
        assertEq(votingEngine.commitRbtsStakeReturned(contentId, roundId, voter1CommitKey), 0);
        assertEq(votingEngine.commitRbtsForfeitedStake(contentId, roundId, voter1CommitKey), 0);
        assertEq(hrepToken.balanceOf(voter1), hrepBefore, "zero-stake claim has no HREP payout");
        assertEq(lrepToken.balanceOf(voter1), lrepBefore, "single launch credit does not pay yet");
        assertTrue(launchPool.earnedRewardCreditRecorded(contentId, roundId, voter1CommitKey));
        assertEq(launchPool.qualifyingRatingCount(voter1), 1);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 1);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 1);
    }

    function test_ClaimReward_DoesNotRecordLaunchCreditWithoutIndependentVerifiedAnchor() public {
        _verifyHuman(voter1, bytes32("claimant-voter-1"));
        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertEq(launchPool.qualifyingRatingCount(voter1), 0);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 0);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 0);
        assertEq(lrepToken.balanceOf(voter1), 0);
    }

    function test_ClaimReward_AgentDeclarationSnapshotDoesNotAnchorLaunchCreditAfterRetirement() public {
        _verifyHuman(voter2, bytes32("anchor-voter-2"));
        MockRaterDeclarationStatusForRewards declarationStatus = new MockRaterDeclarationStatusForRewards();
        declarationStatus.setActiveAiDeclaration(voter2, true);
        ProtocolConfig config = ProtocolConfig(address(votingEngine.protocolConfig()));
        vm.prank(owner);
        config.setRaterDeclarationRegistry(address(declarationStatus));

        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();
        bytes32 voter2CommitKey =
            keccak256(abi.encodePacked(voter2, votingEngine.voterCommitHash(contentId, roundId, voter2)));
        assertTrue(votingEngine.commitHadActiveAiDeclaration(contentId, roundId, voter2CommitKey));

        declarationStatus.setActiveAiDeclaration(voter2, false);

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertEq(launchPool.qualifyingRatingCount(voter1), 0);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 0);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 0);
        assertEq(lrepToken.balanceOf(voter1), 0);
    }

    function test_ClaimReward_AgentDeclarationDoesNotAnchorLaunchCredit() public {
        _verifyHuman(voter2, bytes32("anchor-voter-2"));
        MockRaterDeclarationStatusForRewards declarationStatus = new MockRaterDeclarationStatusForRewards();
        declarationStatus.setActiveAiDeclaration(voter2, true);
        ProtocolConfig config = ProtocolConfig(address(votingEngine.protocolConfig()));
        vm.prank(owner);
        config.setRaterDeclarationRegistry(address(declarationStatus));

        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();
        bytes32 voter2CommitKey =
            keccak256(abi.encodePacked(voter2, votingEngine.voterCommitHash(contentId, roundId, voter2)));
        assertTrue(votingEngine.commitHadActiveAiDeclaration(contentId, roundId, voter2CommitKey));

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertEq(launchPool.qualifyingRatingCount(voter1), 0);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 0);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 0);
        assertEq(lrepToken.balanceOf(voter1), 0);
    }

    // =========================================================================
    // initialize BRANCHES
    // =========================================================================

    function test_Initialize_ZeroGovernance_Reverts() public {
        RoundRewardDistributor impl = new RoundRewardDistributor();
        vm.expectRevert("Invalid governance");
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(
                RoundRewardDistributor.initialize,
                (address(0), address(hrepToken), address(votingEngine), address(registry))
            )
        );
    }

    function test_Initialize_ZeroHrepToken_Reverts() public {
        RoundRewardDistributor impl = new RoundRewardDistributor();
        vm.expectRevert("Invalid HREP token");
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(
                RoundRewardDistributor.initialize, (owner, address(0), address(votingEngine), address(registry))
            )
        );
    }

    function test_Initialize_ZeroVotingEngine_Reverts() public {
        RoundRewardDistributor impl = new RoundRewardDistributor();
        vm.expectRevert("Invalid voting engine");
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(
                RoundRewardDistributor.initialize, (owner, address(hrepToken), address(0), address(registry))
            )
        );
    }

    function test_Initialize_ZeroRegistry_Reverts() public {
        RoundRewardDistributor impl = new RoundRewardDistributor();
        vm.expectRevert("Invalid registry");
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(
                RoundRewardDistributor.initialize, (owner, address(hrepToken), address(votingEngine), address(0))
            )
        );
    }

    function test_SetVotingEngine_RevertsForReplacement() public {
        address newEngine = address(0xBEEF);

        vm.prank(owner);
        vm.expectRevert("Voting engine immutable");
        rewardDistributor.setVotingEngine(newEngine);
    }

    function test_SetVotingEngine_RevertsForReplacementAfterDrainAndDust() public {
        RoundVotingEngine engineImpl = new RoundVotingEngine();
        RoundVotingEngine emptyOldEngine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(engineImpl),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(hrepToken), address(registry), address(_deployProtocolConfig(owner)))
                    )
                )
            )
        );
        address newEngine = address(0xBEEF);
        RoundRewardDistributor impl = new RoundRewardDistributor();
        RoundRewardDistributor freshDistributor = RoundRewardDistributor(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(
                        RoundRewardDistributor.initialize,
                        (owner, address(hrepToken), address(emptyOldEngine), address(registry))
                    )
                )
            )
        );
        vm.prank(owner);
        hrepToken.transfer(address(emptyOldEngine), 1);
        assertEq(hrepToken.balanceOf(address(emptyOldEngine)), 1);

        vm.prank(owner);
        vm.expectRevert("Voting engine immutable");
        freshDistributor.setVotingEngine(newEngine);

        assertEq(address(freshDistributor.votingEngine()), address(emptyOldEngine));
    }

    function test_SetVotingEngine_AllowsCurrentEngineNoop() public {
        vm.prank(owner);
        rewardDistributor.setVotingEngine(address(votingEngine));

        assertEq(address(rewardDistributor.votingEngine()), address(votingEngine));
    }

    function test_SetVotingEngine_ZeroAddressReverts() public {
        vm.prank(owner);
        vm.expectRevert("Invalid voting engine");
        rewardDistributor.setVotingEngine(address(0));
    }

    function test_SetVotingEngine_OnlyAdmin() public {
        vm.prank(voter1);
        vm.expectRevert();
        rewardDistributor.setVotingEngine(address(0xBEEF));
    }

    // =========================================================================
    // stranded HREP recovery
    // =========================================================================

    function test_SweepStrandedHrepToTreasury_TransfersFullBalance() public {
        ProtocolConfig protocolConfig = ProtocolConfig(address(votingEngine.protocolConfig()));
        address updatedTreasury = address(101);
        vm.prank(owner);
        protocolConfig.setTreasury(updatedTreasury);

        vm.prank(owner);
        hrepToken.mint(address(rewardDistributor), 7e6);

        uint256 treasuryBefore = hrepToken.balanceOf(updatedTreasury);

        vm.prank(owner);
        uint256 swept = rewardDistributor.sweepStrandedHrepToTreasury();

        assertEq(swept, 7e6);
        assertEq(hrepToken.balanceOf(address(rewardDistributor)), 0);
        assertEq(hrepToken.balanceOf(updatedTreasury), treasuryBefore + 7e6);
    }

    function test_SweepStrandedHrepToTreasury_UsesInitializedProtocolTreasury() public view {
        assertEq(ProtocolConfig(address(votingEngine.protocolConfig())).treasury(), treasury);
    }

    function test_SweepStrandedHrepToTreasury_NoBalance_Reverts() public {
        vm.expectRevert(RoundRewardDistributor.NoStrandedHrep.selector);
        vm.prank(owner);
        rewardDistributor.sweepStrandedHrepToTreasury();
    }

    function test_SweepStrandedHrepToTreasury_NonAdmin_Reverts() public {
        vm.prank(owner);
        hrepToken.mint(address(rewardDistributor), 1e6);

        vm.expectRevert();
        vm.prank(voter1);
        rewardDistributor.sweepStrandedHrepToTreasury();
    }

    function test_SweepStrandedHrepToTreasury_UsesProtocolTreasuryWhenRegistryDiffers() public {
        address registryTreasury = address(0xCAFE);
        vm.startPrank(owner);
        registry.setTreasury(registryTreasury);
        ProtocolConfig(address(votingEngine.protocolConfig())).setTreasury(treasury);
        vm.stopPrank();

        vm.prank(owner);
        hrepToken.mint(address(rewardDistributor), 2e6);

        uint256 protocolTreasuryBefore = hrepToken.balanceOf(treasury);
        uint256 registryTreasuryBefore = hrepToken.balanceOf(registryTreasury);

        vm.prank(owner);
        rewardDistributor.sweepStrandedHrepToTreasury();

        assertEq(hrepToken.balanceOf(treasury), protocolTreasuryBefore + 2e6);
        assertEq(hrepToken.balanceOf(registryTreasury), registryTreasuryBefore);
    }
}
