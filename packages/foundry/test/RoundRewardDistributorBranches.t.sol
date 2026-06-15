// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { LaunchDistributionPool } from "../contracts/LaunchDistributionPool.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { ILaunchDistributionPool } from "../contracts/interfaces/ILaunchDistributionPool.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { TlockVoteLib } from "../contracts/libraries/TlockVoteLib.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { MockWorldIDVerifier } from "../contracts/mocks/MockWorldIDVerifier.sol";

contract MockRevertingLaunchDistributionPool {
    error LaunchCreditRejected();

    RaterRegistry public immutable raterRegistry;

    constructor(RaterRegistry raterRegistry_) {
        raterRegistry = raterRegistry_;
    }

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

contract MockRewardDistributorConfidentialityProtocolConfig {
    address public raterRegistry;
    address public confidentialityEscrow;

    constructor(address raterRegistry_, address confidentialityEscrow_) {
        raterRegistry = raterRegistry_;
        confidentialityEscrow = confidentialityEscrow_;
    }
}

contract MockRewardDistributorConfidentialityNexus {
    mapping(uint8 => mapping(bytes32 => bool)) internal nexus;
    address internal immutable registry;
    address internal immutable protocolConfig;

    constructor(address registry_) {
        registry = registry_;
        protocolConfig = address(new MockRewardDistributorConfidentialityProtocolConfig(registry_, address(this)));
    }

    function setNexus(uint8 provider, bytes32 nullifierHash, bool value) external {
        nexus[provider][nullifierHash] = value;
    }

    function hasConfidentialityNexus(uint8 provider, bytes32 nullifierHash) external view returns (bool) {
        return nexus[provider][nullifierHash];
    }

    function confidentialityEscrowConfigShape() external view returns (address registry_, address protocolConfig_) {
        return (registry, protocolConfig);
    }
}

contract ClaimingBundleObserver {
    uint16 public defaultFrontendFeeBps = 300;
    uint256 public nextRewardPoolId = 1;
    RoundVotingEngine public immutable votingEngine;
    RoundRewardDistributor public immutable rewardDistributor;
    bool public observedSettled;
    bool public claimSucceeded;
    uint256 public observedVoterPool;
    uint256 public observedFrontendPool;
    bytes public claimFailure;

    constructor(RoundVotingEngine votingEngine_, RoundRewardDistributor rewardDistributor_) {
        votingEngine = votingEngine_;
        rewardDistributor = rewardDistributor_;
    }

    function createSubmissionRewardPoolFromRegistry(
        uint256,
        address,
        address,
        uint8,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint8
    ) external returns (uint256 rewardPoolId) {
        rewardPoolId = nextRewardPoolId++;
    }

    function createSubmissionBundleFromRegistry(
        uint256,
        uint256[] calldata,
        address,
        uint8,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint8
    ) external returns (uint256 rewardPoolId) {
        rewardPoolId = nextRewardPoolId++;
    }

    function recordBundleQuestionTerminal(uint256 contentId, uint256 roundId, bool settled) external {
        observedSettled = settled;
        (,,,, observedVoterPool) = votingEngine.rbtsRoundState(contentId, roundId);
        (observedFrontendPool,,,) = votingEngine.frontendFeeState(contentId, roundId, address(0));
        if (!settled) return;

        try rewardDistributor.claimReward(contentId, roundId) {
            claimSucceeded = true;
        } catch (bytes memory reason) {
            claimFailure = reason;
        }
    }
}

/// @title RoundRewardDistributor branch coverage tests (tlock commit-reveal)
contract RoundRewardDistributorBranchesTest is VotingTestBase {
    LoopReputation public lrepToken;
    ContentRegistry public registry;
    RoundVotingEngine public votingEngine;
    RoundRewardDistributor public rewardDistributor;
    RaterRegistry public raterRegistry;
    MockWorldIDVerifier public worldIdRouter;
    LaunchDistributionPool public launchPool;

    address public owner = address(1);
    address public submitter = address(2);
    address public voter1 = address(3);
    address public voter2 = address(4);
    address public voter3 = address(5);
    address public voter4 = address(6);
    address public voter5 = address(7);
    address public voter6 = address(8);
    address public voter7 = address(10);
    address public voter8 = address(11);
    address public keeper = address(9);
    address public treasury = address(100);

    uint256 public constant T0 = 1000;
    uint256 public constant STAKE = 5e6;
    uint256 public constant EPOCH_DURATION = 5 minutes;
    uint256 internal constant ROUND_RBTS_SCORED_SLOT = 11;
    uint256 internal constant COMMIT_RBTS_SCORE_BPS_SLOT = 23;

    event LaunchRaterRewardCreditFailed(
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 indexed commitKey,
        address rater,
        address launchPool,
        bytes reason
    );

    function setUp() public {
        _resetVotingTestFixture();
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
        registry.setProtocolConfig(address(config));
        config.setRewardDistributor(address(rewardDistributor));
        config.setCategoryRegistry(address(mockCategoryRegistry));
        config.setTreasury(treasury);
        // 4 params: epochDuration, maxDuration, minVoters, maxVoters
        _setTlockRoundConfig(config, EPOCH_DURATION, 7 days, 3, 100);

        worldIdRouter = new MockWorldIDVerifier();
        raterRegistry = new RaterRegistry(
            owner,
            owner,
            address(worldIdRouter),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
        launchPool = new LaunchDistributionPool(address(lrepToken), address(raterRegistry), owner);
        raterRegistry.grantRole(raterRegistry.LAUNCH_CONSUMER_ROLE(), address(launchPool));
        launchPool.setAuthorizedCaller(address(rewardDistributor), true);
        lrepToken.mint(owner, launchPool.TOTAL_POOL_AMOUNT());
        lrepToken.approve(address(launchPool), launchPool.TOTAL_POOL_AMOUNT());
        launchPool.depositPool(launchPool.TOTAL_POOL_AMOUNT());
        config.setRaterRegistry(address(raterRegistry));
        config.setLaunchDistributionPool(address(launchPool));

        lrepToken.mint(owner, 1_000_000e6);
        lrepToken.approve(address(votingEngine), 500_000e6);

        address[10] memory users = [submitter, voter1, voter2, voter3, voter4, voter5, voter6, voter7, voter8, keeper];
        for (uint256 i = 0; i < users.length; i++) {
            lrepToken.mint(users[i], 10_000e6);
        }

        vm.stopPrank();

        _checkpointVotingTestState();
    }

    function tearDown() public {
        _restoreVotingTestCheckpoint();
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
            _roundContext(_previewCommitRoundId(votingEngine, contentId), _defaultRatingReferenceBps());
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
        uint256 roundId = _previewCommitRoundId(votingEngine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(votingEngine, contentId);
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
            uint256 seedBlock = block.number + 1;
            vm.roll(seedBlock);
            try votingEngine.settleRound(contentId, roundId) { } catch { }
            RoundLib.Round memory r3 = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
            if (r3.state == RoundLib.RoundState.Open) {
                vm.roll(seedBlock + 1);
                try votingEngine.settleRound(contentId, roundId) { } catch { }
            }
        }
    }

    function _roundMappingSlot(uint256 baseSlot, uint256 contentId, uint256 roundId) internal pure returns (bytes32) {
        return keccak256(abi.encode(roundId, keccak256(abi.encode(contentId, baseSlot))));
    }

    function _commitMappingSlot(uint256 baseSlot, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(commitKey, _roundMappingSlot(baseSlot, contentId, roundId)));
    }

    function _writeRoundRbtsScored(uint256 contentId, uint256 roundId, bool scored) internal {
        vm.store(
            address(votingEngine),
            _roundMappingSlot(ROUND_RBTS_SCORED_SLOT, contentId, roundId),
            bytes32(uint256(scored ? 1 : 0))
        );
    }

    function _writeCommitRbtsScoreBps(uint256 contentId, uint256 roundId, bytes32 commitKey, uint16 scoreBps) internal {
        vm.store(
            address(votingEngine),
            _commitMappingSlot(COMMIT_RBTS_SCORE_BPS_SLOT, contentId, roundId, commitKey),
            bytes32(uint256(scoreBps))
        );
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
        uint256[5] memory proof;
        vm.prank(account);
        raterRegistry.attestHumanCredentialWithV4Proof(uint256(nullifier), 1, uint64(block.timestamp + 365 days), proof);
    }

    function _deployReplacementRaterRegistry() internal returns (RaterRegistry replacementRegistry) {
        replacementRegistry = new RaterRegistry(
            owner,
            owner,
            address(worldIdRouter),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
    }

    function _rotateLaunchRaterRegistry(RaterRegistry replacementRegistry) internal {
        bytes32 launchConsumerRole = replacementRegistry.LAUNCH_CONSUMER_ROLE();
        vm.prank(owner);
        replacementRegistry.grantRole(launchConsumerRole, address(launchPool));
        vm.prank(owner);
        launchPool.setRaterRegistry(address(replacementRegistry));
        ProtocolConfig config = ProtocolConfig(address(votingEngine.protocolConfig()));
        vm.prank(owner);
        config.setRaterRegistry(address(replacementRegistry));
    }

    function _seedRateLoopHuman(address account, bytes32 anchorId) internal {
        _seedRateLoopHumanFresh(account, anchorId);
        _ageLaunchAnchorCredential();
    }

    function _seedRateLoopHumanFresh(address account, bytes32 anchorId) internal {
        vm.prank(owner);
        raterRegistry.seedHumanCredential(
            account, uint64(block.timestamp + 365 days), anchorId, keccak256("rateloop-seed")
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
        view
        returns (bytes32)
    {
        return raterRegistry.launchHumanIdentityKey(provider, nullifier);
    }

    function _launchRewardPolicyWithAnchorFanout(uint16 maxDistinctRatersPerVerifiedAnchor)
        internal
        view
        returns (ILaunchDistributionPool.LaunchRewardPolicy memory policy)
    {
        policy = ILaunchDistributionPool.LaunchRewardPolicy({
            minQualifyingScoreBps: launchPool.MIN_QUALIFYING_SCORE_BPS(),
            minVoters: launchPool.MIN_EARNED_REWARD_VOTERS(),
            minVerifiedHumans: launchPool.MIN_EARNED_REWARD_VERIFIED_HUMANS(),
            minDistinctVerifiedAnchors: launchPool.MIN_EARNED_REWARD_DISTINCT_VERIFIED_ANCHORS(),
            minDistinctAnchorRounds: launchPool.MIN_EARNED_REWARD_DISTINCT_ANCHOR_ROUNDS(),
            minLaunchCreditStake: launchPool.MIN_LAUNCH_CREDIT_STAKE(),
            maxDistinctRatersPerVerifiedAnchor: maxDistinctRatersPerVerifiedAnchor,
            maxUnverifiedCreditsPerRound: launchPool.MAX_UNVERIFIED_LAUNCH_CREDITS_PER_ROUND(),
            unverifiedEarnedRaterCapBps: launchPool.DEFAULT_UNVERIFIED_EARNED_RATER_CAP_BPS(),
            minAnchorCredentialAgeSeconds: launchPool.MIN_ANCHOR_CREDENTIAL_AGE_SECONDS(),
            eligibilityRatingCount: launchPool.ELIGIBILITY_RATING_COUNT(),
            rewardingRatingCount: launchPool.REWARDING_RATING_COUNT(),
            requireNoPendingCleanup: true
        });
    }

    function _ageLaunchAnchorCredential() internal {
        vm.warp(block.timestamp + launchPool.MIN_ANCHOR_CREDENTIAL_AGE_SECONDS());
    }

    function test_SettleRound_BundleObserverSeesInitializedRewardPoolsBeforeClaim() public {
        ClaimingBundleObserver observer = new ClaimingBundleObserver(votingEngine, rewardDistributor);
        vm.prank(owner);
        lrepToken.mint(address(observer), 10_000e6);

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/observer", "goal", "goal", "tags", 0);
        vm.stopPrank();
        uint256 contentId = 1;
        _linkBundleRoundObserver(registry, contentId, address(observer));

        address[8] memory voters = [address(observer), voter2, voter3, voter4, voter5, voter6, voter7, voter8];
        bool[8] memory directions = [true, true, false, true, true, true, false, false];
        uint16[8] memory ratings = [uint16(8_000), 8_000, 2_000, 8_000, 8_000, 8_000, 2_000, 2_000];
        bytes32[8] memory commitKeys;
        bytes32[8] memory salts;
        for (uint256 i = 0; i < voters.length; i++) {
            (commitKeys[i], salts[i]) = _commitPrediction(voters[i], contentId, ratings[i], STAKE);
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);
        for (uint256 i = 0; i < voters.length; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], ratings[i], salts[i]);
        }

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        assertTrue(observer.observedSettled(), "observer saw settled terminal");
        assertGt(observer.observedVoterPool(), 0, "voter pool initialized before observer callback");
        assertTrue(observer.claimSucceeded(), "observer claim succeeds after pools are initialized");
        assertTrue(rewardDistributor.rewardClaimed(contentId, roundId, address(observer)), "observer claim recorded");
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
            keccak256(abi.encodePacked(voter3, _voterCommitHash(votingEngine, contentId, roundId, voter3)));
        uint256 rbtsStakeReturned = _commitRbtsStakeReturned(votingEngine, contentId, roundId, voter3CommitKey);

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
        _writeRoundRbtsScored(contentId, roundId, false);

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

        RaterRegistry replacementRegistry = _deployReplacementRaterRegistry();
        _rotateLaunchRaterRegistry(replacementRegistry);

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertEq(launchPool.qualifyingRatingCount(voter1), 1);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 1);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 1);
        assertEq(
            launchPool.verifiedAnchorDistinctRaterCount(
                _credentialKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, anchorId)
            ),
            1
        );
    }

    function test_ClaimReward_SkipsVerifiedHumanAnchorBannedInCurrentRegistry() public {
        bytes32 anchorId = bytes32("current-banned-anchor-voter-2");
        _verifyHuman(voter2, anchorId);
        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();
        assertEq(votingEngine.roundRaterRegistrySnapshot(contentId, roundId), address(raterRegistry));

        RaterRegistry replacementRegistry = _deployReplacementRaterRegistry();
        MockRewardDistributorConfidentialityNexus nexus =
            new MockRewardDistributorConfidentialityNexus(address(replacementRegistry));
        nexus.setNexus(uint8(RaterRegistry.HumanCredentialProvider.WorldIdV4), anchorId, true);
        vm.prank(owner);
        replacementRegistry.setConfidentialityEscrow(address(nexus));
        vm.prank(owner);
        replacementRegistry.banIdentity(
            RaterRegistry.HumanCredentialProvider.WorldIdV4,
            anchorId,
            uint64(block.timestamp + 30 days),
            "current registry ban",
            keccak256("current-registry-ban")
        );

        _rotateLaunchRaterRegistry(replacementRegistry);

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        bytes32 launchAnchorId = _credentialKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, anchorId);
        assertEq(launchPool.qualifyingRatingCount(voter1), 0);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 0);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 0);
        assertEq(launchPool.verifiedAnchorDistinctRaterCount(launchAnchorId), 0);
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
        _seedRateLoopHuman(voter2, bytes32("rateloop-anchor-voter-2"));
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

        bytes32 worldIdAnchor = _credentialKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, sharedAnchor);
        bytes32 seededAnchor = _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, sharedAnchor);
        assertEq(launchPool.qualifyingRatingCount(voter1), 1);
        assertEq(launchPool.raterDistinctVerifiedAnchorCount(voter1), 2);
        assertEq(launchPool.raterDistinctAnchorRoundCount(voter1), 1);
        assertEq(launchPool.verifiedAnchorDistinctRaterCount(worldIdAnchor), 1);
        assertEq(launchPool.verifiedAnchorDistinctRaterCount(seededAnchor), 1);
        assertEq(launchPool.verifiedAnchorDistinctRaterCount(sharedAnchor), 0);
    }

    function test_ClaimReward_RecordsLaunchCreditWhenAnchorExpiresAfterRoundStartBeforeClaim() public {
        uint64 expiresAt = _seedRateLoopHumanExpiringAfterMinAge(voter2, bytes32("expiring-rateloop-anchor"));
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
        _seedRateLoopHumanFresh(voter2, bytes32("fresh-rateloop-anchor-voter-2"));
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
        uint256 roundId = _previewCommitRoundId(votingEngine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(votingEngine, contentId);
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
            keccak256(abi.encodePacked(voter1, _voterCommitHash(votingEngine, contentId, roundId, voter1)));
        MockRevertingLaunchDistributionPool revertingLaunchPool = new MockRevertingLaunchDistributionPool(raterRegistry);

        ProtocolConfig config = ProtocolConfig(address(votingEngine.protocolConfig()));
        vm.prank(owner);
        config.setLaunchDistributionPool(address(revertingLaunchPool));

        vm.expectEmit(true, true, true, false, address(rewardDistributor));
        emit LaunchRaterRewardCreditFailed(
            contentId, roundId, voter1CommitKey, voter1, address(revertingLaunchPool), ""
        );

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        (address pendingRecipient, uint96 pendingStake) =
            rewardDistributor.pendingLaunchCreditRetry(contentId, roundId, voter1CommitKey);
        assertEq(pendingRecipient, voter1, "external failure remains retryable");
        assertEq(pendingStake, STAKE, "retry captures stake");
    }

    function test_ClaimReward_DoesNotRetryDeterministicLaunchPolicyNoop() public {
        _verifyHuman(voter2, bytes32("anchor-voter-2"));
        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();
        bytes32 voter1CommitKey =
            keccak256(abi.encodePacked(voter1, _voterCommitHash(votingEngine, contentId, roundId, voter1)));

        _writeCommitRbtsScoreBps(contentId, roundId, voter1CommitKey, uint16(launchPool.MIN_QUALIFYING_SCORE_BPS() - 1));

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertFalse(launchPool.earnedRewardCreditRecorded(contentId, roundId, voter1CommitKey));
        (address pendingRecipient, uint96 pendingStake) =
            rewardDistributor.pendingLaunchCreditRetry(contentId, roundId, voter1CommitKey);
        assertEq(pendingRecipient, address(0), "policy no-op should not be retryable");
        assertEq(pendingStake, 0, "policy no-op stores no retry stake");
    }

    function test_ClaimReward_StoresRetryWhenUnverifiedCapNoopCanClearAfterVerification() public {
        _verifyHuman(voter2, bytes32("anchor-voter-2"));
        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();
        bytes32 voter1CommitKey =
            keccak256(abi.encodePacked(voter1, _voterCommitHash(votingEngine, contentId, roundId, voter1)));

        bytes32[] memory anchorIds = new bytes32[](1);
        anchorIds[0] = _credentialKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, bytes32("anchor-voter-2"));
        uint256 maxCredits = launchPool.MAX_UNVERIFIED_LAUNCH_CREDITS_PER_ROUND();
        for (uint256 i = 0; i < maxCredits; i++) {
            vm.prank(address(rewardDistributor));
            launchPool.recordEarnedRaterRewardWithSourceReady(
                address(uint160(0x5000 + i)),
                contentId,
                roundId,
                keccak256(abi.encode("unverified-cap", i)),
                8_000,
                3,
                true,
                STAKE,
                anchorIds,
                uint64(block.timestamp)
            );
            assertEq(launchPool.roundUnverifiedLaunchCreditCount(contentId, roundId), i + 1);
        }

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertFalse(launchPool.earnedRewardCreditRecorded(contentId, roundId, voter1CommitKey));
        (address pendingRecipient, uint96 pendingStake) =
            rewardDistributor.pendingLaunchCreditRetry(contentId, roundId, voter1CommitKey);
        assertEq(pendingRecipient, voter1, "unverified cap miss should remain retryable");
        assertEq(pendingStake, STAKE, "retry captures stake");

        _verifyHumanFresh(voter1, bytes32("voter-1-verified-after-claim"));

        rewardDistributor.retryLaunchRaterRewardCredit(contentId, roundId, voter1CommitKey);

        assertTrue(launchPool.earnedRewardCreditRecorded(contentId, roundId, voter1CommitKey));
        assertTrue(launchPool.raterRoundCreditRecorded(voter1, contentId, roundId));
        assertEq(launchPool.roundUnverifiedLaunchCreditCount(contentId, roundId), maxCredits);
        (pendingRecipient, pendingStake) =
            rewardDistributor.pendingLaunchCreditRetry(contentId, roundId, voter1CommitKey);
        assertEq(pendingRecipient, address(0), "retry clears recipient");
        assertEq(pendingStake, 0, "retry clears stake");
    }

    function test_ClaimReward_StoresRetryWhenAnchorFanoutNoopCanClearLater() public {
        bytes32 anchorNullifier = bytes32("fanout-anchor-voter-2");
        _verifyHuman(voter2, anchorNullifier);
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _launchRewardPolicyWithAnchorFanout(1);
        vm.prank(owner);
        launchPool.setLaunchRewardPolicy(policy);

        (uint256 contentId, uint256 roundId) = _setupSettledPredictionRound();
        bytes32 voter1CommitKey =
            keccak256(abi.encodePacked(voter1, _voterCommitHash(votingEngine, contentId, roundId, voter1)));
        bytes32 anchorId = _credentialKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, anchorNullifier);
        bytes32[] memory anchorIds = new bytes32[](1);
        anchorIds[0] = anchorId;

        vm.prank(address(rewardDistributor));
        launchPool.recordEarnedRaterRewardWithSourceReady(
            address(0x5000),
            contentId + 100,
            roundId,
            keccak256("fanout-existing-credit"),
            8_000,
            3,
            true,
            STAKE,
            anchorIds,
            uint64(block.timestamp)
        );
        assertEq(launchPool.verifiedAnchorDistinctRaterCount(anchorId), 1);

        vm.prank(voter1);
        rewardDistributor.claimReward(contentId, roundId);

        assertFalse(launchPool.earnedRewardCreditRecorded(contentId, roundId, voter1CommitKey));
        (address pendingRecipient, uint96 pendingStake) =
            rewardDistributor.pendingLaunchCreditRetry(contentId, roundId, voter1CommitKey);
        assertEq(pendingRecipient, voter1, "anchor fanout miss should remain retryable");
        assertEq(pendingStake, STAKE, "retry captures stake");

        policy.maxDistinctRatersPerVerifiedAnchor = 2;
        vm.prank(owner);
        launchPool.setLaunchRewardPolicy(policy);
        rewardDistributor.retryLaunchRaterRewardCredit(contentId, roundId, voter1CommitKey);

        assertTrue(launchPool.earnedRewardCreditRecorded(contentId, roundId, voter1CommitKey));
        assertTrue(launchPool.raterRoundCreditRecorded(voter1, contentId, roundId));
        assertEq(launchPool.verifiedAnchorDistinctRaterCount(anchorId), 2);
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
