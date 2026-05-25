// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { stdStorage, StdStorage } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { LaunchDistributionPool } from "../contracts/LaunchDistributionPool.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { TlockVoteLib } from "../contracts/libraries/TlockVoteLib.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { MockWorldIDRouter } from "../contracts/mocks/MockWorldIDRouter.sol";

contract MockRevertingLaunchDistributionPool {
    error LaunchCreditRejected();

    function launchAnchorCredentialAgeSeconds() external pure returns (uint32) {
        return 0;
    }

    function recordEarnedRaterRewardWithSourceReady(
        address,
        uint256,
        uint256,
        bytes32,
        uint16,
        uint16,
        bool,
        uint256,
        bytes32[] calldata,
        uint64
    ) external pure returns (uint256) {
        revert LaunchCreditRejected();
    }
}

/// @title RoundRewardDistributor branch coverage tests (tlock commit-reveal)
contract RoundRewardDistributorBranchesTest is VotingTestBase {
    using stdStorage for StdStorage;

    LoopReputation public lrepToken;
    ContentRegistry public registry;
    RoundVotingEngine public votingEngine;
    RoundRewardDistributor public rewardDistributor;
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

    event LaunchRaterRewardCreditFailed(
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 indexed commitKey,
        address rater,
        address launchPool,
        bytes reason
    );

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
        MockCategoryRegistry mockCategoryRegistry = new MockCategoryRegistry();
        mockCategoryRegistry.seedDefaultTestCategories();
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig config = ProtocolConfig(address(votingEngine.protocolConfig()));
        config.setRewardDistributor(address(rewardDistributor));
        config.setCategoryRegistry(address(mockCategoryRegistry));
        config.setTreasury(treasury);
        // 4 params: epochDuration, maxDuration, minVoters, maxVoters
        _setTlockRoundConfig(config, EPOCH_DURATION, 7 days, 3, 200);

        worldIdRouter = new MockWorldIDRouter();
        raterRegistry = new RaterRegistry(owner, owner, address(worldIdRouter), bytes32("rate-loop"), 1, 365 days);
        launchPool = new LaunchDistributionPool(address(lrepToken), address(raterRegistry), owner);
        launchPool.setAuthorizedCaller(address(rewardDistributor), true);
        lrepToken.mint(owner, launchPool.TOTAL_POOL_AMOUNT());
        lrepToken.approve(address(launchPool), launchPool.TOTAL_POOL_AMOUNT());
        launchPool.depositPool(launchPool.TOTAL_POOL_AMOUNT());
        config.setRaterRegistry(address(raterRegistry));
        config.setLaunchDistributionPool(address(launchPool));

        lrepToken.mint(owner, 1_000_000e6);
        lrepToken.approve(address(votingEngine), 500_000e6);

        address[5] memory users = [submitter, voter1, voter2, voter3, keeper];
        for (uint256 i = 0; i < users.length; i++) {
            lrepToken.mint(users[i], 10_000e6);
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
        _openRoundForTest(votingEngine, contentId, voter);
        vm.prank(voter);
        lrepToken.approve(address(votingEngine), stake);
        uint256 cachedRoundContext1 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter);
        votingEngine.commitVote(
            contentId, cachedRoundContext1, _tlockCommitTargetRound(), _tlockDrandChainHash(), ch, ct, stake, address(0)
        );
        ck = _commitKey(voter, ch);
        _rememberTestReveal(ck, isUp, salt);
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

        _openRoundForTest(votingEngine, contentId, voter);
        vm.startPrank(voter);
        lrepToken.approve(address(votingEngine), stake);
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
        _rememberTestReveal(commitKey, isUp, salt);
    }

    function _revealAll(uint256 contentId, uint256 roundId) internal {
        bytes32[] memory keys = RoundEngineReadHelpers.commitKeys(votingEngine, contentId, roundId);
        for (uint256 i = 0; i < keys.length; i++) {
            RoundLib.Commit memory c = RoundEngineReadHelpers.commit(votingEngine, contentId, roundId, keys[i]);
            if (!c.revealed && c.stakeAmount > 0) {
                (bool isUp, bytes32 salt, bool exists) = _testRevealPayload(keys[i]);
                if (exists) {
                    try votingEngine.revealVoteByCommitKey(contentId, roundId, keys[i], isUp, 5_000, salt) { } catch { }
                }
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
            vm.roll(block.number + 1);
            try votingEngine.settleRound(contentId, roundId) { } catch { }
        }
    }

    function _setupSettledRound() internal returns (uint256 contentId, uint256 roundId) {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
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
        lrepToken.approve(address(registry), 10e6);
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
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
    }

    function _verifyHuman(address account, bytes32 nullifier) internal {
        _verifyHumanFresh(account, nullifier);
        _ageLaunchAnchorCredential();
    }

    function _verifyHumanFresh(address account, bytes32 nullifier) internal {
        uint256[8] memory proof;
        vm.prank(account);
        raterRegistry.attestHumanCredentialWithProof(1, uint256(nullifier), proof);
    }

    function _seedRateLoopHuman(address account, bytes32 anchorId) internal {
        _seedRateLoopHumanFresh(account, anchorId);
        _ageLaunchAnchorCredential();
    }

    function _seedRateLoopHumanFresh(address account, bytes32 anchorId) internal {
        vm.prank(owner);
        raterRegistry.seedHumanCredential(
            account, uint64(block.timestamp + 365 days), anchorId, keccak256("curyo-seed")
        );
    }

    function _seedRateLoopHumanExpiringAfterMinAge(address account, bytes32 anchorId)
        internal
        returns (uint64 expiresAt)
    {
        expiresAt = uint64(block.timestamp + launchPool.MIN_ANCHOR_CREDENTIAL_AGE_SECONDS() + 1 minutes);
        vm.prank(owner);
        raterRegistry.seedHumanCredential(account, expiresAt, anchorId, keccak256("seeded-human-expiring"));
        _ageLaunchAnchorCredential();
    }

    function _credentialKey(RaterRegistry.HumanCredentialProvider provider, bytes32 nullifier)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(provider, nullifier));
    }

    function _ageLaunchAnchorCredential() internal {
        vm.warp(block.timestamp + launchPool.MIN_ANCHOR_CREDENTIAL_AGE_SECONDS());
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
        lrepToken.approve(address(registry), 10e6);
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

        uint256 balBefore = lrepToken.balanceOf(voter3);
        vm.prank(voter3);
        rewardDistributor.claimReward(contentId, roundId);
        uint256 balAfter = lrepToken.balanceOf(voter3);

        uint256 claimedAmount = balAfter - balBefore;
        assertGt(rbtsStakeReturned, 0, "RBTS returns scored stake");
        assertGe(claimedAmount, rbtsStakeReturned, "claim includes scored stake return");
        assertGt(claimedAmount, STAKE / 20, "not capped at old loser rebate");
    }

    function test_ClaimReward_UnscoredRoundReverts() public {
        (uint256 contentId, uint256 roundId) = _setupSettledRound();
        stdstore.target(address(votingEngine)).sig("roundRbtsScored(uint256,uint256)").with_key(contentId)
            .with_key(roundId).checked_write(false);

        vm.prank(voter1);
        vm.expectRevert(RoundRewardDistributor.RoundNotSettled.selector);
        rewardDistributor.claimReward(contentId, roundId);
    }

    function test_ClaimReward_WinnerGetsReward() public {
        (uint256 contentId, uint256 roundId) = _setupSettledRound();

        uint256 balBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);
        uint256 balAfter = lrepToken.balanceOf(voter1);

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
    }

    function test_ClaimReward_UsesRoundRaterRegistrySnapshotForVerifiedHumanAnchor() public {
        bytes32 anchorId = bytes32("snapshot-anchor-voter-2");
        _verifyHuman(voter2, anchorId);
        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();
        assertEq(votingEngine.roundRaterRegistrySnapshot(contentId, roundId), address(raterRegistry));

        RaterRegistry replacementRegistry =
            new RaterRegistry(owner, owner, address(worldIdRouter), bytes32("replacement-rate-loop"), 2, 365 days);
        ProtocolConfig config = ProtocolConfig(address(votingEngine.protocolConfig()));
        vm.prank(owner);
        config.setRaterRegistry(address(replacementRegistry));

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertEq(launchPool.qualifyingRatingCount(voter1), 1);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 1);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 1);
        assertEq(
            launchPool.verifiedAnchorDistinctRaterCount(
                _credentialKey(RaterRegistry.HumanCredentialProvider.WorldId, anchorId)
            ),
            1
        );
    }

    function test_ClaimReward_DoesNotRecordLaunchCreditWithFreshVerifiedHumanAnchor() public {
        _verifyHumanFresh(voter2, bytes32("fresh-anchor-voter-2"));
        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertEq(launchPool.qualifyingRatingCount(voter1), 0);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 0);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 0);
    }

    function test_ClaimReward_RecordsLaunchCreditWithRateLoopSeededHumanAnchor() public {
        _seedRateLoopHuman(voter2, bytes32("curyo-anchor-voter-2"));
        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertEq(launchPool.qualifyingRatingCount(voter1), 1);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 1);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 1);
    }

    function test_ClaimReward_NamespacesLaunchAnchorsByProvider() public {
        bytes32 sharedAnchor = bytes32("shared-launch-anchor");
        _verifyHuman(voter2, sharedAnchor);
        _seedRateLoopHuman(voter3, sharedAnchor);
        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        bytes32 worldIdAnchor = _credentialKey(RaterRegistry.HumanCredentialProvider.WorldId, sharedAnchor);
        bytes32 seededAnchor = _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, sharedAnchor);
        assertEq(launchPool.qualifyingRatingCount(voter1), 1);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 2);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 1);
        assertEq(launchPool.verifiedAnchorDistinctRaterCount(worldIdAnchor), 1);
        assertEq(launchPool.verifiedAnchorDistinctRaterCount(seededAnchor), 1);
        assertEq(launchPool.verifiedAnchorDistinctRaterCount(sharedAnchor), 0);
    }

    function test_ClaimReward_RecordsLaunchCreditWhenAnchorExpiresAfterRoundStartBeforeClaim() public {
        uint64 expiresAt = _seedRateLoopHumanExpiringAfterMinAge(voter2, bytes32("expiring-curyo-anchor"));
        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);

        assertGt(expiresAt, round.startTime, "credential valid at round start");
        assertLt(expiresAt, block.timestamp, "credential expired before claim");

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertEq(launchPool.qualifyingRatingCount(voter1), 1);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 1);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 1);
    }

    function test_ClaimReward_DoesNotRecordLaunchCreditWithFreshRateLoopSeededHumanAnchor() public {
        _seedRateLoopHumanFresh(voter2, bytes32("fresh-curyo-anchor-voter-2"));
        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertEq(launchPool.qualifyingRatingCount(voter1), 0);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 0);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 0);
    }

    function test_ClaimReward_ZeroStakeCountedVoteRejectedBeforeLaunchCredit() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/zero-stake-counted", "goal", "goal", "tags", 0);
        vm.stopPrank();

        uint256 contentId = 1;
        uint16 predictedRatingBps = 8_000;
        bytes32 salt = keccak256(abi.encodePacked(voter1, predictedRatingBps, block.timestamp));
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
            voter1,
            contentId,
            roundId,
            referenceRatingBps,
            targetRound,
            drandChainHash,
            ciphertext
        );

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), 0);
        vm.expectRevert(RoundVotingEngine.InvalidStake.selector);
        votingEngine.commitVote(
            contentId,
            _roundContext(roundId, referenceRatingBps),
            targetRound,
            drandChainHash,
            commitHash,
            ciphertext,
            0,
            address(0)
        );
        vm.stopPrank();

        assertEq(RoundEngineReadHelpers.activeRoundId(votingEngine, contentId), 0);
        assertEq(launchPool.qualifyingRatingCount(voter1), 0);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 0);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 0);
    }

    function test_ClaimReward_EmitsLaunchCreditFailureWithoutBlockingClaim() public {
        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();
        bytes32 voter1CommitKey =
            keccak256(abi.encodePacked(voter1, votingEngine.voterCommitHash(contentId, roundId, voter1)));
        MockRevertingLaunchDistributionPool revertingLaunchPool = new MockRevertingLaunchDistributionPool();

        ProtocolConfig config = ProtocolConfig(address(votingEngine.protocolConfig()));
        vm.prank(owner);
        config.setLaunchDistributionPool(address(revertingLaunchPool));

        vm.expectEmit(true, true, true, false, address(rewardDistributor));
        emit LaunchRaterRewardCreditFailed(
            contentId, roundId, voter1CommitKey, voter1, address(revertingLaunchPool), ""
        );

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);
    }

    function test_ClaimReward_DoesNotRecordLaunchCreditWithoutIndependentVerifiedAnchor() public {
        _verifyHuman(voter1, bytes32("claimant-voter-1"));
        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertEq(launchPool.qualifyingRatingCount(voter1), 0);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 0);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 0);
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
                (address(0), address(lrepToken), address(votingEngine), address(registry))
            )
        );
    }

    function test_Initialize_ZeroLrepToken_Reverts() public {
        RoundRewardDistributor impl = new RoundRewardDistributor();
        vm.expectRevert("Invalid LREP token");
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
                RoundRewardDistributor.initialize, (owner, address(lrepToken), address(0), address(registry))
            )
        );
    }

    function test_Initialize_ZeroRegistry_Reverts() public {
        RoundRewardDistributor impl = new RoundRewardDistributor();
        vm.expectRevert("Invalid registry");
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(
                RoundRewardDistributor.initialize, (owner, address(lrepToken), address(votingEngine), address(0))
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
                        (owner, address(lrepToken), address(registry), address(_deployProtocolConfig(owner)))
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
                        (owner, address(lrepToken), address(emptyOldEngine), address(registry))
                    )
                )
            )
        );
        vm.prank(owner);
        lrepToken.transfer(address(emptyOldEngine), 1);
        assertEq(lrepToken.balanceOf(address(emptyOldEngine)), 1);

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
    // stranded LREP recovery
    // =========================================================================

    function test_SweepStrandedLrepToTreasury_TransfersFullBalance() public {
        ProtocolConfig protocolConfig = ProtocolConfig(address(votingEngine.protocolConfig()));
        address updatedTreasury = address(101);
        vm.prank(owner);
        protocolConfig.setTreasury(updatedTreasury);

        vm.prank(owner);
        lrepToken.mint(address(rewardDistributor), 7e6);

        uint256 treasuryBefore = lrepToken.balanceOf(updatedTreasury);

        vm.prank(owner);
        uint256 swept = rewardDistributor.sweepStrandedLrepToTreasury();

        assertEq(swept, 7e6);
        assertEq(lrepToken.balanceOf(address(rewardDistributor)), 0);
        assertEq(lrepToken.balanceOf(updatedTreasury), treasuryBefore + 7e6);
    }

    function test_SweepStrandedLrepToTreasury_UsesInitializedProtocolTreasury() public view {
        assertEq(ProtocolConfig(address(votingEngine.protocolConfig())).treasury(), treasury);
    }

    function test_SweepStrandedLrepToTreasury_NoBalance_Reverts() public {
        vm.expectRevert(RoundRewardDistributor.NoStrandedLrep.selector);
        vm.prank(owner);
        rewardDistributor.sweepStrandedLrepToTreasury();
    }

    function test_SweepStrandedLrepToTreasury_NonAdmin_Reverts() public {
        vm.prank(owner);
        lrepToken.mint(address(rewardDistributor), 1e6);

        vm.expectRevert();
        vm.prank(voter1);
        rewardDistributor.sweepStrandedLrepToTreasury();
    }

    function test_SweepStrandedLrepToTreasury_UsesProtocolTreasuryWhenRegistryDiffers() public {
        address registryTreasury = address(0xCAFE);
        vm.startPrank(owner);
        registry.setTreasury(registryTreasury);
        ProtocolConfig(address(votingEngine.protocolConfig())).setTreasury(treasury);
        vm.stopPrank();

        vm.prank(owner);
        lrepToken.mint(address(rewardDistributor), 2e6);

        uint256 protocolTreasuryBefore = lrepToken.balanceOf(treasury);
        uint256 registryTreasuryBefore = lrepToken.balanceOf(registryTreasury);

        vm.prank(owner);
        rewardDistributor.sweepStrandedLrepToTreasury();

        assertEq(lrepToken.balanceOf(treasury), protocolTreasuryBefore + 2e6);
        assertEq(lrepToken.balanceOf(registryTreasury), registryTreasuryBefore);
    }
}
