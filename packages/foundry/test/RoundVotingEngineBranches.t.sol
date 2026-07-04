// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { AdvisoryVoteRecorder } from "../contracts/AdvisoryVoteRecorder.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { RoundVotingEngineRbtsSettlementModule } from "../contracts/RoundVotingEngineRbtsSettlementModule.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RoundCreationLib } from "../contracts/libraries/RoundCreationLib.sol";
import { RoundRbtsSettlementSnapshotLib } from "../contracts/libraries/RoundRbtsSettlementSnapshotLib.sol";
import { RewardMath } from "../contracts/libraries/RewardMath.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { TlockVoteLib } from "../contracts/libraries/TlockVoteLib.sol";
import { VotePreflightLib } from "../contracts/libraries/VotePreflightLib.sol";
import { IClusterPayoutOracle } from "../contracts/interfaces/IClusterPayoutOracle.sol";
import { IRaterIdentityRegistry } from "../contracts/interfaces/IRaterIdentityRegistry.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { MockRaterIdentityRegistry } from "./mocks/MockRaterIdentityRegistry.sol";
import { MockQuestionRewardPoolEscrow } from "./mocks/MockQuestionRewardPoolEscrow.sol";
import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { MockWorldIDVerifier } from "../contracts/mocks/MockWorldIDVerifier.sol";

contract MockUnmarkedRbtsSettlementModule {
    function ping() external pure returns (uint256) {
        return 1;
    }
}

contract MockAdvisoryLaunchDistributionPool {
    RaterRegistry public immutable raterRegistry;
    uint16 public maxUnverifiedCreditsPerRound;
    uint256 public advisoryRecordCallCount;
    address public roundClusterReadyAtSource;
    IClusterPayoutOracle public clusterPayoutOracle;
    mapping(address => bool) public authorizedCallers;

    constructor(uint16 cap, address raterRegistry_) {
        raterRegistry = RaterRegistry(raterRegistry_);
        maxUnverifiedCreditsPerRound = cap;
    }

    function setAuthorizedCaller(address caller, bool authorized) external {
        authorizedCallers[caller] = authorized;
    }

    function setRoundClusterReadyAtSource(address source) external {
        roundClusterReadyAtSource = source;
    }

    function setClusterPayoutOracle(address oracle) external {
        clusterPayoutOracle = IClusterPayoutOracle(oracle);
    }

    function setMaxUnverifiedCreditsPerRound(uint16 cap) external {
        maxUnverifiedCreditsPerRound = cap;
    }

    function launchAnchorCredentialAgeSeconds() external pure returns (uint32) {
        return 1 days;
    }

    function launchRewardPolicy()
        external
        view
        returns (
            uint16 minQualifyingScoreBps,
            uint16 minVoters,
            uint16 minVerifiedHumans,
            uint16 minDistinctVerifiedAnchors,
            uint16 minDistinctAnchorRounds,
            uint64 minLaunchCreditStake,
            uint16 maxDistinctRatersPerVerifiedAnchor,
            uint16 maxUnverifiedCreditsPerRound_,
            uint16 unverifiedEarnedRaterCapBps,
            uint32 minAnchorCredentialAgeSeconds,
            uint32 eligibilityRatingCount,
            uint32 rewardingRatingCount,
            bool requireNoPendingCleanup
        )
    {
        return (0, 3, 0, 0, 0, 0, 1, maxUnverifiedCreditsPerRound, 0, 1 days, 1, 1, false);
    }

    function recordAdvisoryRaterRewardWithSourceReady(
        address,
        uint256,
        uint256,
        bytes32,
        uint16,
        uint16,
        bool,
        bytes32[] calldata,
        uint64
    ) external returns (bool, uint256) {
        advisoryRecordCallCount += 1;
        return (true, 0);
    }
}

contract LockingLoopGovernor {
    LoopReputation public immutable reputationToken;

    constructor(LoopReputation token) {
        reputationToken = token;
    }

    function lock(address account, uint256 amount, uint256 unlockTime) external {
        reputationToken.lockForGovernanceUntil(account, amount, unlockTime);
    }
}

contract RevertingBundleObserver {
    uint16 public defaultFrontendFeeBps = 300;
    address public registry;
    address public votingEngine;
    bool public shouldRevert = true;
    uint256 public observedContentId;
    uint256 public observedRoundId;
    bool public observedSettled;
    uint256 public notifyCount;

    error ObserverUnavailable();

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function setConfigShape(address registry_, address votingEngine_) external {
        registry = registry_;
        votingEngine = votingEngine_;
    }

    function questionRewardPoolEscrowConfigShape() external view returns (address, address) {
        return (registry, votingEngine);
    }

    function recordBundleQuestionTerminal(uint256 contentId, uint256 roundId, bool settled) external {
        if (shouldRevert) revert ObserverUnavailable();
        observedContentId = contentId;
        observedRoundId = roundId;
        observedSettled = settled;
        notifyCount++;
    }
}

contract MockEip2935History {
    bytes32 public historyHash;

    function setHistoryHash(bytes32 value) external {
        historyHash = value;
    }

    fallback() external {
        bytes32 value = historyHash;
        assembly ("memory-safe") {
            mstore(0, value)
            return(0, 32)
        }
    }
}

contract MockClusterPayoutOracleForRoundVotingEngine {
    mapping(uint8 => address) public roundPayoutSnapshotConsumer;
    mapping(bytes32 => IClusterPayoutOracle.RoundPayoutSnapshot) internal snapshots;
    address public frontendRegistry;
    bool public allowZeroEffectiveWeight;
    bool public revertSnapshotKey;
    uint64 public constant FINALIZATION_VETO_WINDOW = 0;

    constructor(address frontendRegistry_) {
        frontendRegistry = frontendRegistry_;
    }

    function setRoundPayoutSnapshotConsumer(uint8 domain, address consumer) external {
        roundPayoutSnapshotConsumer[domain] = consumer;
    }

    function roundPayoutSnapshotKey(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (bytes32)
    {
        if (revertSnapshotKey) revert("snapshot key unavailable");
        return keccak256(abi.encode(domain, rewardPoolId, contentId, roundId));
    }

    function roundPayoutSnapshotProposedAt(uint8, uint256, uint256, uint256) external pure returns (uint64) {
        return 0;
    }

    function configureFinalizedRbtsSnapshot(
        uint256 contentId,
        uint256 roundId,
        uint32 rawEligibleVoters,
        uint32 effectiveParticipantUnits,
        uint256 totalClaimWeight
    ) external {
        bytes32 snapshotKey = this.roundPayoutSnapshotKey(5, 0, contentId, roundId);
        snapshots[snapshotKey] = IClusterPayoutOracle.RoundPayoutSnapshot({
            snapshotKey: snapshotKey,
            domain: 5,
            correlationEpochId: 1,
            finalizedAt: block.timestamp == 0 ? 0 : uint64(block.timestamp - 1),
            rawEligibleVoters: rawEligibleVoters,
            effectiveParticipantUnits: effectiveParticipantUnits,
            rewardPoolId: 0,
            contentId: contentId,
            roundId: roundId,
            totalClaimWeight: totalClaimWeight,
            weightRoot: keccak256("rbts-weight-root"),
            reasonRoot: keccak256("rbts-reason-root"),
            status: IClusterPayoutOracle.SnapshotStatus.Finalized
        });
    }

    function configureRbtsSnapshotStatus(
        uint256 contentId,
        uint256 roundId,
        uint32 rawEligibleVoters,
        uint32 effectiveParticipantUnits,
        uint256 totalClaimWeight,
        IClusterPayoutOracle.SnapshotStatus status
    ) external {
        bytes32 snapshotKey = this.roundPayoutSnapshotKey(5, 0, contentId, roundId);
        snapshots[snapshotKey] = IClusterPayoutOracle.RoundPayoutSnapshot({
            snapshotKey: snapshotKey,
            domain: 5,
            correlationEpochId: 1,
            finalizedAt: status == IClusterPayoutOracle.SnapshotStatus.Finalized
                ? (block.timestamp == 0 ? 0 : uint64(block.timestamp - 1))
                : 0,
            rawEligibleVoters: rawEligibleVoters,
            effectiveParticipantUnits: effectiveParticipantUnits,
            rewardPoolId: 0,
            contentId: contentId,
            roundId: roundId,
            totalClaimWeight: totalClaimWeight,
            weightRoot: keccak256("rbts-weight-root"),
            reasonRoot: keccak256("rbts-reason-root"),
            status: status
        });
    }

    function getRoundPayoutSnapshot(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (IClusterPayoutOracle.RoundPayoutSnapshot memory)
    {
        return snapshots[this.roundPayoutSnapshotKey(domain, rewardPoolId, contentId, roundId)];
    }

    function isRoundPayoutSnapshotFinalized(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (bool)
    {
        return snapshots[this.roundPayoutSnapshotKey(domain, rewardPoolId, contentId, roundId)].status
            == IClusterPayoutOracle.SnapshotStatus.Finalized;
    }

    function isRoundPayoutSnapshotRejectedByCorrelationEpoch(uint8, uint256, uint256, uint256)
        external
        pure
        returns (bool)
    {
        return false;
    }

    function roundPayoutSnapshotConsumerFor(uint8 domain, uint256, uint256, uint256) external view returns (address) {
        return roundPayoutSnapshotConsumer[domain];
    }

    function roundPayoutSnapshotProposalDigest(bytes32 snapshotKey) external pure returns (bytes32) {
        return keccak256(abi.encode(snapshotKey, "digest"));
    }

    function rejectedRoundPayoutSnapshotDigests(bytes32, bytes32) external pure returns (bool) {
        return false;
    }

    function rejectedRoundPayoutSnapshotRoots(bytes32, bytes32) external pure returns (bool) {
        return false;
    }

    function finalizationVetoWindow() external pure returns (uint64) {
        return FINALIZATION_VETO_WINDOW;
    }

    function correlationEpochVetoDeadline(uint64) external pure returns (uint256) {
        return 0;
    }

    function roundPayoutSnapshotVetoDeadline(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        public
        view
        returns (uint256)
    {
        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot =
            snapshots[this.roundPayoutSnapshotKey(domain, rewardPoolId, contentId, roundId)];
        return uint256(snapshot.finalizedAt) + uint256(FINALIZATION_VETO_WINDOW);
    }

    function isRoundPayoutSnapshotOutsideVetoWindow(
        uint8 domain,
        uint256 rewardPoolId,
        uint256 contentId,
        uint256 roundId
    ) external view returns (bool) {
        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot =
            snapshots[this.roundPayoutSnapshotKey(domain, rewardPoolId, contentId, roundId)];
        return snapshot.status == IClusterPayoutOracle.SnapshotStatus.Finalized
            && block.timestamp >= roundPayoutSnapshotVetoDeadline(domain, rewardPoolId, contentId, roundId);
    }

    function setAllowZeroEffectiveWeight(bool value) external {
        allowZeroEffectiveWeight = value;
    }

    function setRevertSnapshotKey(bool value) external {
        revertSnapshotKey = value;
    }

    function verifyPayoutWeight(IClusterPayoutOracle.PayoutWeight calldata payout, bytes32[] calldata)
        external
        view
        returns (bool)
    {
        return payout.domain == 5 && payout.rewardPoolId == 0 && payout.baseWeight > 0
            && (payout.effectiveWeight > 0 || allowZeroEffectiveWeight) && payout.effectiveWeight <= payout.baseWeight;
    }
}

// =========================================================================
// TEST CONTRACT
// =========================================================================

contract RoundVotingEngineBranchesTest is VotingTestBase {
    address internal constant EIP2935_HISTORY_STORAGE = 0x0000F90827F1C53a10cb7A02335B175320002935;

    LoopReputation public lrepToken;
    ContentRegistry public registry;
    AdvisoryVoteRecorder public advisoryRecorder;
    RoundVotingEngine public engine;
    RoundRewardDistributor public rewardDistributor;
    MockRaterIdentityRegistry public mockRaterIdentityRegistry;
    FrontendRegistry public frontendRegistry;
    address internal protocolConfigAddress;

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
    address public frontend1 = address(200);
    address public delegate1 = address(201);

    uint256 public constant STAKE = 5e6; // 5 LREP
    uint256 public constant T0 = 1_000_000; // setUp warp time
    uint256 public constant EPOCH = 1 hours; // epochDuration
    bytes32 internal constant ROLE_UPDATED_TOPIC = keccak256("RoleUpdated(bytes32,address,bool)");
    uint256 internal constant SCORE_SPREAD_TEST_REVEALS = 8;
    uint8 internal constant COMMIT_STATUS_OPEN = 0;
    uint8 internal constant COMMIT_STATUS_STARTS_NEXT_ROUND = 1;
    uint8 internal constant COMMIT_STATUS_ROUND_FULL = 2;
    uint8 internal constant COMMIT_STATUS_WAITING_FOR_SETTLEMENT = 3;
    uint8 internal constant COMMIT_STATUS_WAITING_FOR_REVEAL_GRACE = 4;

    struct RbtsSettlementPayload {
        IClusterPayoutOracle.PayoutWeight[] payoutWeights;
        bytes32[][] proofs;
    }

    function _tlockDrandChainHash() internal pure override returns (bytes32) {
        return DEFAULT_DRAND_CHAIN_HASH;
    }

    function _tlockDrandGenesisTime() internal pure override returns (uint64) {
        return DEFAULT_DRAND_GENESIS_TIME;
    }

    function _tlockDrandPeriod() internal pure override returns (uint64) {
        return DEFAULT_DRAND_PERIOD;
    }

    function _installMockEip2935History(bytes32 historyHash) internal {
        vm.etch(EIP2935_HISTORY_STORAGE, address(new MockEip2935History()).code);
        MockEip2935History(payable(EIP2935_HISTORY_STORAGE)).setHistoryHash(historyHash);
    }

    function _tlockEpochDuration() internal pure override returns (uint256) {
        return EPOCH;
    }

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

        // Foundry tests use structurally valid AGE/tlock envelopes here rather than real decryptable ciphertexts.
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
        engine.setRbtsSettlementModule(address(new RoundVotingEngineRbtsSettlementModule()));
        protocolConfigAddress = address(engine.protocolConfig());
        advisoryRecorder = new AdvisoryVoteRecorder(address(engine), address(registry), owner);
        ProtocolConfig(protocolConfigAddress).setAdvisoryVoteRecorder(address(advisoryRecorder));

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
        registry.setProtocolConfig(protocolConfigAddress);
        MockCategoryRegistry mockCategoryRegistry = new MockCategoryRegistry();
        mockCategoryRegistry.seedDefaultTestCategories();
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(protocolConfigAddress).setRewardDistributor(address(rewardDistributor));
        ProtocolConfig(protocolConfigAddress).setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(protocolConfigAddress).setTreasury(treasury);
        _setTlockDrandConfig(
            ProtocolConfig(protocolConfigAddress),
            DEFAULT_DRAND_CHAIN_HASH,
            DEFAULT_DRAND_GENESIS_TIME,
            DEFAULT_DRAND_PERIOD
        );

        // epochDuration=1h, maxDuration=1h, minVoters=3, maxVoters=100
        _setTlockRoundConfig(ProtocolConfig(protocolConfigAddress), 1 hours, 1 hours, 3, 100);

        mockRaterIdentityRegistry = new MockRaterIdentityRegistry();

        FrontendRegistry frImpl = new FrontendRegistry();
        frontendRegistry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(frImpl), abi.encodeCall(FrontendRegistry.initialize, (owner, owner, address(lrepToken)))
                )
            )
        );
        frontendRegistry.setVotingEngine(address(engine));
        frontendRegistry.addFeeCreditor(address(rewardDistributor));
        mockRaterIdentityRegistry.setHolder(frontend1);
        ProtocolConfig(protocolConfigAddress).setFrontendRegistry(address(frontendRegistry));
        ProtocolConfig(protocolConfigAddress).setRaterRegistry(address(mockRaterIdentityRegistry));
        MockClusterPayoutOracleForRoundVotingEngine testOracle =
            new MockClusterPayoutOracleForRoundVotingEngine(address(frontendRegistry));
        MockQuestionRewardPoolEscrow defaultRewardEscrow = _newMockQuestionRewardPoolEscrow(registry);
        testOracle.setRoundPayoutSnapshotConsumer(3, address(registry));
        testOracle.setRoundPayoutSnapshotConsumer(5, address(engine));
        testOracle.setRoundPayoutSnapshotConsumer(1, address(defaultRewardEscrow));
        testOracle.setRoundPayoutSnapshotConsumer(4, address(defaultRewardEscrow));
        ProtocolConfig(protocolConfigAddress).setClusterPayoutOracle(address(testOracle));
        registry.setQuestionRewardPoolEscrow(address(defaultRewardEscrow));

        lrepToken.mint(owner, 2_000_000e6);
        lrepToken.approve(address(engine), 500_000e6);

        address[11] memory users =
            [submitter, voter1, voter2, voter3, voter4, voter5, voter6, voter7, voter8, frontend1, delegate1];
        for (uint256 i = 0; i < users.length; i++) {
            lrepToken.mint(users[i], 10_000e6);
        }

        vm.stopPrank();

        _checkpointVotingTestState();
    }

    function tearDown() public {
        _restoreVotingTestCheckpoint();
    }

    function _setMockAdvisoryLaunchPool(uint16 cap) internal returns (MockAdvisoryLaunchDistributionPool launchPool) {
        return _setMockAdvisoryLaunchPoolForRegistry(cap, address(mockRaterIdentityRegistry));
    }

    function _setMockAdvisoryLaunchPoolForRegistry(uint16 cap, address raterRegistry_)
        internal
        returns (MockAdvisoryLaunchDistributionPool launchPool)
    {
        launchPool = new MockAdvisoryLaunchDistributionPool(cap, raterRegistry_);
        launchPool.setAuthorizedCaller(address(rewardDistributor), true);
        launchPool.setAuthorizedCaller(address(advisoryRecorder), true);
        launchPool.setRoundClusterReadyAtSource(address(engine));
        address oracle = ProtocolConfig(protocolConfigAddress).clusterPayoutOracle();
        launchPool.setClusterPayoutOracle(oracle);
        MockClusterPayoutOracleForRoundVotingEngine(oracle).setRoundPayoutSnapshotConsumer(2, address(launchPool));
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress).setLaunchDistributionPool(address(launchPool));
    }

    function _installPublicRatingClusterPayoutOracle()
        internal
        returns (MockClusterPayoutOracleForRoundVotingEngine oracle)
    {
        oracle = new MockClusterPayoutOracleForRoundVotingEngine(address(frontendRegistry));
        oracle.setRoundPayoutSnapshotConsumer(3, address(registry));
        oracle.setRoundPayoutSnapshotConsumer(5, address(engine));
        address questionRewardPoolEscrow = registry.questionRewardPoolEscrow();
        if (questionRewardPoolEscrow != address(0)) {
            oracle.setRoundPayoutSnapshotConsumer(1, questionRewardPoolEscrow);
            oracle.setRoundPayoutSnapshotConsumer(4, questionRewardPoolEscrow);
        }
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress).setClusterPayoutOracle(address(oracle));
    }

    function _applyFullWeightRbtsSettlementSnapshot(
        MockClusterPayoutOracleForRoundVotingEngine oracle,
        uint256 contentId,
        uint256 roundId,
        bytes32[] memory commitKeys
    ) internal {
        RbtsSettlementPayload memory payload = _fullWeightRbtsSettlementPayload(oracle, contentId, roundId, commitKeys);
        engine.applyRbtsSettlementSnapshot(contentId, roundId, payload.payoutWeights, payload.proofs);
    }

    function _expectFullWeightRbtsSettlementSnapshotRevert(uint256 contentId, uint256 roundId, bytes4 selector)
        internal
    {
        RbtsSettlementPayload memory payload = _fullWeightRbtsSettlementPayload(
            MockClusterPayoutOracleForRoundVotingEngine(ProtocolConfig(protocolConfigAddress).clusterPayoutOracle()),
            contentId,
            roundId,
            RoundEngineReadHelpers.commitKeys(engine, contentId, roundId)
        );
        vm.expectRevert(selector);
        engine.applyRbtsSettlementSnapshot(contentId, roundId, payload.payoutWeights, payload.proofs);
    }

    function _fullWeightRbtsSettlementPayload(
        MockClusterPayoutOracleForRoundVotingEngine oracle,
        uint256 contentId,
        uint256 roundId,
        bytes32[] memory commitKeys
    ) internal returns (RbtsSettlementPayload memory payload) {
        payload.payoutWeights = _fullWeightRbtsSettlementWeights(contentId, roundId, commitKeys);
        payload.proofs = new bytes32[][](payload.payoutWeights.length);
        uint256 totalClaimWeight;
        uint32 effectiveParticipantUnits;
        for (uint256 i = 0; i < payload.payoutWeights.length; i++) {
            totalClaimWeight += payload.payoutWeights[i].effectiveWeight;
            effectiveParticipantUnits += payload.payoutWeights[i].independenceBps;
        }

        oracle.configureFinalizedRbtsSnapshot(
            contentId, roundId, uint32(payload.payoutWeights.length), effectiveParticipantUnits, totalClaimWeight
        );
    }

    function _fullWeightRbtsSettlementWeights(uint256 contentId, uint256 roundId, bytes32[] memory commitKeys)
        internal
        view
        returns (IClusterPayoutOracle.PayoutWeight[] memory payoutWeights)
    {
        bytes32[] memory sortedCommitKeys = _sortedCommitKeys(commitKeys);

        payoutWeights = new IClusterPayoutOracle.PayoutWeight[](sortedCommitKeys.length);
        for (uint256 i = 0; i < sortedCommitKeys.length; i++) {
            bytes32 commitKey = sortedCommitKeys[i];
            uint256 baseWeight = _commitRbtsScoringWeight(engine, contentId, roundId, commitKey);
            payoutWeights[i] = IClusterPayoutOracle.PayoutWeight({
                domain: 5,
                rewardPoolId: 0,
                contentId: contentId,
                roundId: roundId,
                commitKey: commitKey,
                identityKey: _commitIdentityKey(engine, contentId, roundId, commitKey),
                account: _commitIdentityHolder(engine, contentId, roundId, commitKey),
                baseWeight: baseWeight,
                independenceBps: 10_000,
                effectiveWeight: baseWeight,
                reasonHash: keccak256("full-weight-rbts-test")
            });
        }
    }

    function _applyFullWeightRbtsSettlementSnapshot(uint256 contentId, uint256 roundId) internal {
        _applyFullWeightRbtsSettlementSnapshot(
            MockClusterPayoutOracleForRoundVotingEngine(ProtocolConfig(protocolConfigAddress).clusterPayoutOracle()),
            contentId,
            roundId,
            RoundEngineReadHelpers.commitKeys(engine, contentId, roundId)
        );
    }

    function test_SetRbtsSettlementModuleRejectsUnmarkedCode() public {
        MockUnmarkedRbtsSettlementModule unmarked = new MockUnmarkedRbtsSettlementModule();

        vm.prank(owner);
        vm.expectRevert(RoundVotingEngine.InvalidAddress.selector);
        engine.setRbtsSettlementModule(address(unmarked));
    }

    function _sortedCommitKeys(bytes32[] memory commitKeys) internal pure returns (bytes32[] memory sortedCommitKeys) {
        sortedCommitKeys = new bytes32[](commitKeys.length);
        for (uint256 i = 0; i < commitKeys.length; i++) {
            sortedCommitKeys[i] = commitKeys[i];
        }
        for (uint256 i = 1; i < sortedCommitKeys.length; i++) {
            bytes32 key = sortedCommitKeys[i];
            uint256 j = i;
            while (j > 0 && sortedCommitKeys[j - 1] > key) {
                sortedCommitKeys[j] = sortedCommitKeys[j - 1];
                unchecked {
                    --j;
                }
            }
            sortedCommitKeys[j] = key;
        }
    }

    function test_SetRoleRotatesPauser() public {
        bytes32 pauserRole = keccak256("PAUSER_ROLE");
        address newPauser = address(0xBEEF);

        vm.expectRevert(RoundVotingEngine.Unauthorized.selector);
        vm.prank(voter1);
        engine.setRole(pauserRole, newPauser, true);

        vm.recordLogs();
        vm.prank(owner);
        engine.setRole(pauserRole, newPauser, true);
        _assertRoleUpdatedLog(vm.getRecordedLogs(), pauserRole, newPauser, true);

        vm.recordLogs();
        vm.prank(owner);
        engine.setRole(pauserRole, newPauser, true);
        assertEq(vm.getRecordedLogs().length, 0);

        vm.prank(newPauser);
        engine.pause();
        assertTrue(engine.paused());

        vm.recordLogs();
        vm.prank(owner);
        engine.setRole(pauserRole, newPauser, false);
        _assertRoleUpdatedLog(vm.getRecordedLogs(), pauserRole, newPauser, false);

        vm.expectRevert(RoundVotingEngine.Unauthorized.selector);
        vm.prank(newPauser);
        engine.unpause();

        vm.prank(owner);
        engine.unpause();
        assertFalse(engine.paused());
    }

    function test_SetRoleCannotRevokeOwnDefaultAdmin() public {
        vm.expectRevert();
        vm.prank(owner);
        engine.setRole(bytes32(0), owner, false);

        vm.recordLogs();
        vm.prank(owner);
        engine.setRole(keccak256("PAUSER_ROLE"), address(0xCAFE), true);
        _assertRoleUpdatedLog(vm.getRecordedLogs(), keccak256("PAUSER_ROLE"), address(0xCAFE), true);
    }

    function test_InitializeEmitsRoleUpdatedForGenesisRoles() public {
        RoundVotingEngine impl = new RoundVotingEngine();

        vm.recordLogs();
        RoundVotingEngine freshEngine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(lrepToken), address(registry), protocolConfigAddress)
                    )
                )
            )
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();

        _assertContainsRoleUpdatedLog(logs, bytes32(0), owner, true);
        _assertContainsRoleUpdatedLog(logs, keccak256("PAUSER_ROLE"), owner, true);

        vm.prank(owner);
        freshEngine.pause();
        assertTrue(freshEngine.paused());
    }

    function _assertRoleUpdatedLog(Vm.Log[] memory logs, bytes32 role, address account, bool enabled) internal pure {
        assertEq(logs.length, 1);
        _assertRoleUpdatedLog(logs[0], role, account, enabled);
    }

    function _assertContainsRoleUpdatedLog(Vm.Log[] memory logs, bytes32 role, address account, bool enabled)
        internal
        pure
    {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length == 4 && logs[i].topics[0] == ROLE_UPDATED_TOPIC && logs[i].topics[1] == role) {
                address logAccount = address(uint160(uint256(logs[i].topics[2])));
                if (logAccount == account && logs[i].topics[3] == bytes32(uint256(enabled ? 1 : 0))) return;
            }
        }
        revert("RoleUpdated log missing");
    }

    function _assertRoleUpdatedLog(Vm.Log memory log, bytes32 role, address account, bool enabled) internal pure {
        assertEq(log.topics.length, 4);
        assertEq(log.topics[0], ROLE_UPDATED_TOPIC);
        assertEq(log.topics[1], role);
        assertEq(log.topics[2], bytes32(uint256(uint160(account))));
        assertEq(log.topics[3], bytes32(uint256(enabled ? 1 : 0)));
        assertEq(log.data.length, 0);
    }

    // =========================================================================
    // TEST HELPERS
    // =========================================================================

    function _previewCommitAvailability(uint256 contentId)
        internal
        view
        returns (bool canCommit, uint8 status, uint256 roundId, uint16 referenceRatingBps, bool willStartNewRound)
    {
        uint256 currentRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 previewRoundId = _previewCommitRoundId(engine, contentId);
        if (currentRoundId == 0 || previewRoundId != currentRoundId) {
            status = COMMIT_STATUS_STARTS_NEXT_ROUND;
        } else {
            RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, currentRoundId);
            RoundLib.RoundConfig memory cfg = RoundEngineReadHelpers.roundConfig(engine, contentId, currentRoundId);
            uint16 revealQuorum = cfg.minVoters < 3 ? 3 : cfg.minVoters;
            if (round.thresholdReachedAt != 0 || round.revealedCount >= revealQuorum) {
                status = COMMIT_STATUS_WAITING_FOR_SETTLEMENT;
            } else if (round.voteCount >= cfg.maxVoters) {
                status = COMMIT_STATUS_ROUND_FULL;
            } else if (round.startTime > 0 && block.timestamp >= uint256(round.startTime) + cfg.maxDuration) {
                status = COMMIT_STATUS_WAITING_FOR_REVEAL_GRACE;
            } else {
                status = COMMIT_STATUS_OPEN;
            }
        }
        canCommit = status == COMMIT_STATUS_OPEN || status == COMMIT_STATUS_STARTS_NEXT_ROUND;
        roundId = previewRoundId;
        referenceRatingBps = _previewCommitReferenceRatingBps(engine, contentId);
        willStartNewRound = status == COMMIT_STATUS_STARTS_NEXT_ROUND;
    }

    /// @dev Commit a vote in test mode and return (commitKey, salt).
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

    /// @dev Commit with a specific frontend address.
    function _commitWithFrontend(address voter, uint256 contentId, bool isUp, uint256 stake, address frontend)
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
                frontend: frontend,
                salt: salt
            })
        );
    }

    function _signLrepPermit(uint256 ownerKey, address owner_, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner_,
                spender,
                value,
                lrepToken.nonces(owner_),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", lrepToken.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(ownerKey, digest);
    }

    function _commitVoteWithPermit(
        address voter,
        uint256 contentId,
        TestCommitArtifacts memory artifacts,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal {
        vm.prank(voter);
        engine.commitVoteWithPermit(
            contentId,
            _roundContext(artifacts.roundId, artifacts.roundReferenceRatingBps),
            artifacts.targetRound,
            artifacts.drandChainHash,
            artifacts.commitHash,
            artifacts.ciphertext,
            STAKE,
            address(0),
            deadline,
            v,
            r,
            s
        );
    }

    /// @dev Reveal a vote by commit key. Permissionless — no prank needed.
    function _reveal(uint256 contentId, uint256 roundId, bytes32 commitKey, bool isUp, bytes32 salt) internal {
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, isUp, 5_000, salt);
    }

    function _predictionBps(uint256 index, bool isUp) internal pure returns (uint16) {
        uint16[3] memory upPredictions = [uint16(7_000), uint16(6_000), uint16(5_500)];
        uint16[3] memory downPredictions = [uint16(4_000), uint16(3_500), uint16(3_000)];
        return isUp ? upPredictions[index % upPredictions.length] : downPredictions[index % downPredictions.length];
    }

    function _scoreSpreadFixtureVoters() internal returns (address[] memory voters) {
        voters = new address[](SCORE_SPREAD_TEST_REVEALS);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        voters[3] = voter4;
        voters[4] = voter5;
        voters[5] = voter6;
        voters[6] = frontend1;
        voters[7] = delegate1;

        for (uint256 i = 0; i < voters.length; i++) {
            mockRaterIdentityRegistry.setHolder(voters[i]);
        }
    }

    function _scoreSpreadFixtureDirections() internal pure returns (bool[] memory directions) {
        directions = new bool[](SCORE_SPREAD_TEST_REVEALS);
        directions[0] = true;
        directions[1] = true;
        directions[2] = true;
        directions[3] = true;
        directions[4] = true;
        directions[5] = false;
        directions[6] = false;
        directions[7] = false;
    }

    function _revealPrediction(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        bool isUp,
        uint16 predictedUpBps,
        bytes32 salt
    ) internal {
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, isUp, predictedUpBps, salt);
    }

    function _settleRoundAfterRbtsSeed(uint256 contentId, uint256 roundId) internal {
        uint256 settlementBlock = block.number + 1;
        vm.roll(settlementBlock);
        engine.settleRound(contentId, roundId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        if (round.state == RoundLib.RoundState.SettlementPending) {
            _rollPastRbtsSeedBlock(settlementBlock + 1);
            _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
            return;
        }
        if (round.state != RoundLib.RoundState.Open) return;
        vm.roll(settlementBlock + 1);
        engine.settleRound(contentId, roundId);
        round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        if (round.state == RoundLib.RoundState.SettlementPending) {
            _rollPastRbtsSeedBlock(settlementBlock + 2);
            _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        }
    }

    function _rbtsSeedBlockFromLogs(Vm.Log[] memory logs, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint256 seedBlock)
    {
        bytes32 expectedTopic = keccak256("RbtsSeedCaptured(uint256,uint256,bytes32)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == address(engine) && logs[i].topics.length == 3 && logs[i].topics[0] == expectedTopic
                    && uint256(logs[i].topics[1]) == contentId && uint256(logs[i].topics[2]) == roundId
            ) {
                seedBlock = uint256(abi.decode(logs[i].data, (bytes32)));
            }
        }
        if (seedBlock != 0) return seedBlock;
        revert("RbtsSeedCaptured event not emitted");
    }

    function _rbtsFutureBlockEntropy(uint256 contentId, uint256 roundId, uint256 seedBlock, bytes32 blockEntropy)
        internal
        view
        returns (bytes32 settlementEntropy)
    {
        uint256 entropy = uint256(
            keccak256(
                abi.encode(
                    "rateloop.rbts.future-block-seed.v1",
                    block.chainid,
                    address(engine),
                    contentId,
                    roundId,
                    seedBlock,
                    blockEntropy
                )
            )
        ) & ((uint256(1) << 255) - 1);
        settlementEntropy = bytes32(entropy);
        if (settlementEntropy == bytes32(0)) settlementEntropy = bytes32(uint256(1));
    }

    function _installRaterRegistry() internal returns (RaterRegistry raterRegistry) {
        raterRegistry = new RaterRegistry(
            owner,
            owner,
            address(new MockWorldIDVerifier()),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress).setRaterRegistry(address(raterRegistry));
    }

    function _commitPrediction(address voter, uint256 contentId, uint16 predictedRatingBps, uint256 stake)
        internal
        returns (bytes32 commitKey, bytes32 salt)
    {
        return _commitPrediction(voter, contentId, predictedRatingBps >= 5_000, predictedRatingBps, stake);
    }

    function _commitPrediction(address voter, uint256 contentId, bool isUp, uint16 predictedUpBps, uint256 stake)
        internal
        returns (bytes32 commitKey, bytes32 salt)
    {
        return _commitPredictionWithFrontend(voter, contentId, isUp, predictedUpBps, stake, address(0));
    }

    function _commitPredictionWithFrontend(
        address voter,
        uint256 contentId,
        bool isUp,
        uint16 predictedUpBps,
        uint256 stake,
        address frontend
    ) internal returns (bytes32 commitKey, bytes32 salt) {
        salt = keccak256(abi.encodePacked(voter, isUp, predictedUpBps, block.timestamp));
        _openRoundForTest(engine, contentId, voter);
        uint256 roundId = _previewCommitRoundId(engine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(engine, contentId);
        uint64 targetRound = _tlockCommitTargetRound(engine, contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes memory ciphertext = _testCiphertext(isUp, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = TlockVoteLib.buildExpectedRbtsCommitHash(
            isUp,
            predictedUpBps,
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
        lrepToken.approve(address(engine), stake);
        engine.commitVote(
            contentId,
            _roundContext(roundId, referenceRatingBps),
            targetRound,
            drandChainHash,
            commitHash,
            ciphertext,
            stake,
            frontend
        );
        vm.stopPrank();
    }

    function _commitWithTargetRound(
        address voter,
        uint256 contentId,
        bool isUp,
        uint256 stake,
        uint64 targetRound,
        string memory saltTag
    ) internal returns (bytes32 commitKey, bytes32 salt) {
        uint16 predictedUpBps = 5_000;
        salt = keccak256(abi.encodePacked(voter, isUp, targetRound, block.timestamp, saltTag));
        _openRoundForTest(engine, contentId, voter);
        uint256 roundId = _previewCommitRoundId(engine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(engine, contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes memory ciphertext = _testCiphertext(isUp, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = TlockVoteLib.buildExpectedRbtsCommitHash(
            isUp,
            predictedUpBps,
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
        lrepToken.approve(address(engine), stake);
        engine.commitVote(
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

    function _recordAdvisory(address voter, uint256 contentId, string memory saltTag)
        internal
        returns (bytes32 advisoryCommitKey, bytes32 salt)
    {
        return _recordAdvisoryWithTargetRound(voter, contentId, saltTag, _tlockCommitTargetRound(engine, contentId));
    }

    function _openStakedRound(address voter, uint256 contentId, string memory saltTag)
        internal
        returns (uint64 targetRound)
    {
        targetRound = _tlockCommitTargetRound(engine, contentId);
        _commitWithTargetRound(voter, contentId, true, STAKE, targetRound, saltTag);
    }

    function _openStakedRoundWithTarget(address voter, uint256 contentId, uint64 targetRound, string memory saltTag)
        internal
    {
        _commitWithTargetRound(voter, contentId, true, STAKE, targetRound, saltTag);
    }

    function _recordAdvisoryWithTargetRound(address voter, uint256 contentId, string memory saltTag, uint64 targetRound)
        internal
        returns (bytes32 advisoryCommitKey, bytes32 salt)
    {
        uint256 roundId = _previewCommitRoundId(engine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(engine, contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        salt = keccak256(abi.encodePacked(voter, block.timestamp, saltTag));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.prank(voter);
        advisoryCommitKey = advisoryRecorder.recordAdvisoryVote(
            contentId, _roundContext(roundId, referenceRatingBps), targetRound, drandChainHash, commitHash, ciphertext
        );
    }

    function _expectCommitVoteRevert(
        address voter,
        uint256 contentId,
        bool isUp,
        uint256 stake,
        string memory saltTag,
        bytes4 selector
    ) internal {
        if (selector == RoundVotingEngine.SelfVote.selector) {
            vm.prank(voter);
            vm.expectRevert(selector);
            engine.openRound(contentId);
            return;
        }

        if (selector != RoundVotingEngine.RoundNotOpen.selector) {
            _openRoundForTest(engine, contentId, voter);
        }

        uint256 currentRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 roundId = selector == RoundVotingEngine.RoundNotOpen.selector && currentRoundId != 0
            ? currentRoundId
            : _previewCommitRoundId(engine, contentId);
        uint16 referenceRatingBps = roundId == currentRoundId && currentRoundId != 0
            ? _roundReferenceRatingBpsForRound(engine, contentId, roundId)
            : _previewCommitReferenceRatingBps(engine, contentId);
        uint64 targetRound = _tlockCommitTargetRound(engine, contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter, isUp, block.timestamp, saltTag));
        bytes memory ciphertext = _testCiphertext(isUp, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = TlockVoteLib.buildExpectedRbtsCommitHash(
            isUp, 5_000, salt, voter, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.startPrank(voter);
        lrepToken.approve(address(engine), stake);
        vm.expectRevert(selector);
        engine.commitVote(
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

    function _revealFailedFinalDeadline(uint256 contentId, uint256 roundId) internal view returns (uint256) {
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        RoundLib.RoundConfig memory cfg = RoundEngineReadHelpers.roundConfig(engine, contentId, roundId);
        uint256 votingWindowEnd = uint256(round.startTime) + uint256(cfg.maxDuration);
        uint256 lastRevealableAt = _lastCommitRevealableAfter(engine, contentId, roundId);
        uint256 revealBase = lastRevealableAt > votingWindowEnd ? lastRevealableAt : votingWindowEnd;
        return revealBase + ProtocolConfig(protocolConfigAddress).revealGracePeriod() * 24;
    }

    function _forceContentRoundConfig(uint256 contentId, RoundLib.RoundConfig memory roundConfig) internal {
        bytes32 contentSlot = keccak256(abi.encode(contentId, uint256(15)));
        uint256 packed = uint256(roundConfig.epochDuration) | (uint256(roundConfig.maxDuration) << 32)
            | (uint256(roundConfig.minVoters) << 64) | (uint256(roundConfig.maxVoters) << 80);
        vm.store(address(registry), contentSlot, bytes32(packed));
    }

    function _expectAdvisoryRevert(address voter, uint256 contentId, string memory saltTag, bytes4 selector) internal {
        uint256 roundId = _previewCommitRoundId(engine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(engine, contentId);
        uint64 targetRound = _tlockCommitTargetRound(engine, contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter, block.timestamp, saltTag));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.prank(voter);
        vm.expectRevert(selector);
        advisoryRecorder.recordAdvisoryVote(
            contentId, _roundContext(roundId, referenceRatingBps), targetRound, drandChainHash, commitHash, ciphertext
        );
    }

    function _maxAgeCiphertext() internal view returns (bytes memory ciphertext) {
        uint256 totalLength = 2_048;
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = bytes32(uint256(1));
        bytes memory bestFit;
        bytes memory exactMatch;

        (exactMatch, bestFit) = _searchArmoredCiphertext(totalLength, targetRound, drandChainHash, salt, true);
        if (exactMatch.length > 0) return exactMatch;

        (exactMatch, ciphertext) = _searchArmoredCiphertext(totalLength, targetRound, drandChainHash, salt, false);
        if (exactMatch.length > 0) return exactMatch;
        if (ciphertext.length > bestFit.length) return ciphertext;
        if (bestFit.length == 0) revert("Unable to build max ciphertext");
        return bestFit;
    }

    function _searchArmoredCiphertext(
        uint256 totalLength,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes32 salt,
        bool newlineAfterHeader
    ) internal pure returns (bytes memory exactMatch, bytes memory bestFit) {
        uint256 coarseStep = 32;
        uint256 filler = 0;

        while (filler <= totalLength) {
            bytes memory payload = _testCiphertextPayload(true, salt, 0, targetRound, drandChainHash, filler);
            bytes memory candidate = _armoredTestCiphertext(payload, newlineAfterHeader);
            if (candidate.length == totalLength) return (candidate, bestFit);
            if (candidate.length < totalLength && candidate.length > bestFit.length) {
                bestFit = candidate;
            }
            if (candidate.length > totalLength) break;
            filler += coarseStep;
        }

        uint256 start = filler > coarseStep ? filler - coarseStep : 0;
        uint256 end = filler > totalLength ? totalLength : filler;

        for (uint256 fine = start; fine <= end; fine++) {
            bytes memory payload = _testCiphertextPayload(true, salt, 0, targetRound, drandChainHash, fine);
            bytes memory candidate = _armoredTestCiphertext(payload, newlineAfterHeader);
            if (candidate.length == totalLength) return (candidate, bestFit);
            if (candidate.length < totalLength && candidate.length > bestFit.length) {
                bestFit = candidate;
            }
        }
    }

    /// @dev Submit content as `submitter` and return contentId.
    function _submitContent() internal returns (uint256 contentId) {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/1", "test goal", "test goal", "test", 0);
        vm.stopPrank();
        contentId = 1;
    }

    /// @dev Submit content with a custom URL.
    function _submitContentWithUrl(string memory url) internal returns (uint256) {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, url, "test goal", "test goal", "test", 0);
        vm.stopPrank();
        return registry.nextContentId() - 1;
    }

    function _submitContentWithRoundConfig(string memory url, RoundLib.RoundConfig memory roundConfig)
        internal
        returns (uint256 contentId)
    {
        string[] memory imageUrls = _emptyImageUrls();
        string memory videoUrl = "";
        string memory title = "test goal";
        string memory description = "test goal";
        string memory tags = "test";
        uint256 categoryId = 1;

        address rewardEscrow = _ensureDefaultQuestionRewardPoolEscrow(registry);
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _defaultSubmissionRewardTerms(registry);

        vm.startPrank(submitter);
        lrepToken.approve(rewardEscrow, rewardAmount);

        bytes32 submissionKey =
            _questionSubmissionKey(url, imageUrls, videoUrl, title, tags, categoryId, _emptySubmissionDetails());
        bytes32 salt = _contentSubmissionSalt(url, submitter);
        bytes32 revealCommitment = _questionRevealCommitment(
            submissionKey,
            _submissionMediaHash(imageUrls, videoUrl),
            title,
            description,
            tags,
            categoryId,
            salt,
            submitter,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec()
        );

        registry.reserveSubmission(revealCommitment);
        vm.warp(block.timestamp + 1);
        contentId = registry.submitQuestionWithRewardAndRoundConfig(
            url,
            imageUrls,
            videoUrl,
            title,
            tags,
            categoryId,
            _emptySubmissionDetails(),
            salt,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec(),
            _defaultConfidentialityConfig()
        );
        vm.stopPrank();
    }

    /// @dev Register a frontend operator.
    function _registerFrontend(address fe) internal {
        mockRaterIdentityRegistry.setHolder(fe);
        vm.startPrank(fe);
        lrepToken.approve(address(frontendRegistry), 1000e6);
        frontendRegistry.register();
        vm.stopPrank();
    }

    /// @dev Full 3-voter round lifecycle: commit all epoch-1, warp past epoch, then reveal all.
    function _setupThreeVoterRound(bool v1Up, bool v2Up, bool v3Up)
        internal
        returns (uint256 contentId, uint256 roundId)
    {
        contentId = _submitContent();

        bytes32[3] memory commitKeys;
        bytes32[3] memory salts;
        uint16[3] memory predictions = [_predictionBps(0, v1Up), _predictionBps(1, v2Up), _predictionBps(2, v3Up)];
        (commitKeys[0], salts[0]) = _commitPrediction(voter1, contentId, v1Up, predictions[0], STAKE);
        (commitKeys[1], salts[1]) = _commitPrediction(voter2, contentId, v2Up, predictions[1], STAKE);
        (commitKeys[2], salts[2]) = _commitPrediction(voter3, contentId, v3Up, predictions[2], STAKE);

        roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past epoch end so votes become revealable
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        _revealPrediction(contentId, roundId, commitKeys[0], v1Up, predictions[0], salts[0]);
        _revealPrediction(contentId, roundId, commitKeys[1], v2Up, predictions[1], salts[1]);
        _revealPrediction(contentId, roundId, commitKeys[2], v3Up, predictions[2], salts[2]);
    }

    function _fiveUpThreeDownDirections() internal pure returns (bool[8] memory directions) {
        directions = [true, true, false, true, true, false, true, false];
    }

    function _allUpDirections() internal pure returns (bool[8] memory directions) {
        directions = [true, true, true, true, true, true, true, true];
    }

    function _revealedSetHash(uint256 contentId, uint256 roundId, bytes32[8] memory commitKeys, bytes32[8] memory salts)
        internal
        view
        returns (bytes32 hash)
    {
        for (uint256 i = 0; i < commitKeys.length; i++) {
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

    function _setupEconomicPredictionRound(bool[8] memory directions, address frontend)
        internal
        returns (uint256 contentId, uint256 roundId, bytes32[8] memory commitKeys)
    {
        (contentId, roundId, commitKeys,) = _setupEconomicPredictionRoundWithSalts(directions, frontend);
    }

    function _setupEconomicPredictionRoundWithSalts(bool[8] memory directions, address frontend)
        internal
        returns (uint256 contentId, uint256 roundId, bytes32[8] memory commitKeys, bytes32[8] memory salts)
    {
        contentId = _submitContent();

        address[8] memory voters = [voter1, voter2, voter3, voter4, voter5, voter6, voter7, voter8];
        uint16[8] memory predictions;
        for (uint256 i = 0; i < voters.length; i++) {
            predictions[i] = _predictionBps(i, directions[i]);
            if (i == 0 && frontend != address(0)) {
                (commitKeys[i], salts[i]) =
                    _commitPredictionWithFrontend(voters[i], contentId, directions[i], predictions[i], STAKE, frontend);
            } else {
                (commitKeys[i], salts[i]) =
                    _commitPrediction(voters[i], contentId, directions[i], predictions[i], STAKE);
            }
        }

        roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        for (uint256 i = 0; i < voters.length; i++) {
            _revealPrediction(contentId, roundId, commitKeys[i], directions[i], predictions[i], salts[i]);
        }
    }

    // =========================================================================
    // 1. BASIC ROUND LIFECYCLE: commit -> reveal -> settle (3 voters, epoch 1)
    // =========================================================================

    function test_PreviewCommitAvailability_InitialRound_AcceptsCurrentRound() public {
        uint256 contentId = _submitContent();

        (bool canCommit, uint8 status, uint256 roundId, uint16 referenceRatingBps, bool willStartNewRound) =
            _previewCommitAvailability(contentId);

        assertTrue(canCommit);
        assertEq(status, COMMIT_STATUS_OPEN);
        assertEq(roundId, 1);
        assertEq(referenceRatingBps, _defaultRatingReferenceBps());
        assertFalse(willStartNewRound);
    }

    function test_CommitVoteWithPermitConsumesPermitAndStake() public {
        uint256 voterKey = 0xA11CE;
        address permitVoter = vm.addr(voterKey);
        vm.prank(owner);
        lrepToken.mint(permitVoter, 10_000e6);
        uint256 contentId = _submitContent();
        bytes32 salt = keccak256("permit-commit");
        _openRoundForTest(engine, contentId, permitVoter);
        TestCommitArtifacts memory artifacts =
            _buildTestCommitArtifacts(address(engine), permitVoter, true, salt, contentId);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signLrepPermit(voterKey, permitVoter, address(engine), STAKE, deadline);

        _commitVoteWithPermit(permitVoter, contentId, artifacts, deadline, v, r, s);

        assertEq(lrepToken.allowance(permitVoter, address(engine)), 0);
        assertEq(lrepToken.balanceOf(address(engine)), STAKE);
        assertEq(_voterCommitHash(engine, contentId, artifacts.roundId, permitVoter), artifacts.commitHash);
    }

    function test_CommitVoteWithPermitToleratesFrontRunConsumedPermit() public {
        // A mempool observer front-runs the public permit, consuming the voter's
        // nonce. The permit-backed commit must still succeed (the front-run
        // already set the allowance) rather than reverting and bricking the
        // single-transaction permit-backed commit.
        uint256 voterKey = 0xB0B;
        address permitVoter = vm.addr(voterKey);
        vm.prank(owner);
        lrepToken.mint(permitVoter, 10_000e6);
        uint256 contentId = _submitContent();
        bytes32 salt = keccak256("permit-front-run");
        _openRoundForTest(engine, contentId, permitVoter);
        TestCommitArtifacts memory artifacts =
            _buildTestCommitArtifacts(address(engine), permitVoter, true, salt, contentId);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signLrepPermit(voterKey, permitVoter, address(engine), STAKE, deadline);

        // Front-runner replays the permit, consuming the nonce and setting allowance.
        lrepToken.permit(permitVoter, address(engine), STAKE, deadline, v, r, s);
        assertEq(lrepToken.allowance(permitVoter, address(engine)), STAKE);

        // The commit still goes through: the stale permit reverts internally but
        // is swallowed, and the already-granted allowance covers the stake.
        _commitVoteWithPermit(permitVoter, contentId, artifacts, deadline, v, r, s);

        assertEq(lrepToken.allowance(permitVoter, address(engine)), 0);
        assertEq(lrepToken.balanceOf(address(engine)), STAKE);
        assertEq(_voterCommitHash(engine, contentId, artifacts.roundId, permitVoter), artifacts.commitHash);
    }

    function test_CommitVoteWithPermitRevertsWhenNoAllowanceAfterFailedPermit() public {
        // If the permit is invalid AND there is no pre-existing
        // allowance, the commit must still revert (fail-closed, no free stake).
        uint256 voterKey = 0xB0BB1E;
        address permitVoter = vm.addr(voterKey);
        vm.prank(owner);
        lrepToken.mint(permitVoter, 10_000e6);
        uint256 contentId = _submitContent();
        bytes32 salt = keccak256("permit-invalid");
        _openRoundForTest(engine, contentId, permitVoter);
        TestCommitArtifacts memory artifacts =
            _buildTestCommitArtifacts(address(engine), permitVoter, true, salt, contentId);
        uint256 deadline = block.timestamp + 1 hours;
        // Sign a permit for a different spender so it never grants an allowance to the engine.
        (uint8 v, bytes32 r, bytes32 s) = _signLrepPermit(voterKey, permitVoter, address(0xdead), STAKE, deadline);

        vm.expectRevert();
        _commitVoteWithPermit(permitVoter, contentId, artifacts, deadline, v, r, s);

        assertEq(lrepToken.allowance(permitVoter, address(engine)), 0);
        assertEq(_voterCommitHash(engine, contentId, artifacts.roundId, permitVoter), bytes32(0));
    }

    function test_PreviewCommitAvailability_OpenRound_AcceptsCurrentRound() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);

        (bool canCommit, uint8 status, uint256 roundId, uint16 referenceRatingBps, bool willStartNewRound) =
            _previewCommitAvailability(contentId);

        assertTrue(canCommit);
        assertEq(status, COMMIT_STATUS_OPEN);
        assertEq(roundId, 1);
        assertEq(referenceRatingBps, _defaultRatingReferenceBps());
        assertFalse(willStartNewRound);
    }

    function test_PreviewCommitAvailability_ExpiredAllSybilQuorum_StartsNextRound() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, true, STAKE);
        _commit(voter3, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertFalse(_roundHasHumanVerifiedCommit(engine, contentId, roundId));

        vm.warp(uint256(r0.startTime) + EPOCH + 1);

        (bool canCommit, uint8 status, uint256 nextPreviewRoundId,, bool willStartNewRound) =
            _previewCommitAvailability(contentId);

        assertTrue(canCommit);
        assertEq(status, COMMIT_STATUS_STARTS_NEXT_ROUND);
        assertEq(nextPreviewRoundId, 2);
        assertEq(_previewCommitRoundId(engine, contentId), 2);
        assertTrue(willStartNewRound);

        _commit(voter4, contentId, true, STAKE);

        RoundLib.Round memory cancelledRound = RoundEngineReadHelpers.round(engine, contentId, 1);
        assertEq(uint256(cancelledRound.state), uint256(RoundLib.RoundState.Cancelled));
        RoundLib.Round memory openRound = RoundEngineReadHelpers.round(engine, contentId, 2);
        assertEq(uint256(openRound.state), uint256(RoundLib.RoundState.Open));
        assertEq(openRound.voteCount, 1);
    }

    function test_PreviewCommitAvailability_RoundFull_BlocksCurrentRound() public {
        RoundLib.RoundConfig memory roundConfig =
            RoundLib.RoundConfig({ epochDuration: 1 hours, maxDuration: 1 hours, minVoters: 3, maxVoters: 3 });
        uint256 contentId = _submitContentWithRoundConfig("https://example.com/full-round", roundConfig);

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, true, STAKE);
        _commit(voter3, contentId, false, STAKE);

        (bool canCommit, uint8 status, uint256 roundId,, bool willStartNewRound) = _previewCommitAvailability(contentId);

        assertFalse(canCommit);
        assertEq(status, COMMIT_STATUS_ROUND_FULL);
        assertEq(roundId, 1);
        assertFalse(willStartNewRound);
    }

    function test_PreviewCommitAvailability_ThresholdReached_WaitsForSettlement() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);

        (bool canCommit, uint8 status, uint256 previewRoundId,, bool willStartNewRound) =
            _previewCommitAvailability(contentId);

        assertFalse(canCommit);
        assertEq(status, COMMIT_STATUS_WAITING_FOR_SETTLEMENT);
        assertEq(previewRoundId, roundId);
        assertFalse(willStartNewRound);
    }

    function test_PreviewCommitAvailability_ExpiredHumanQuorum_WaitsForRevealGrace() public {
        mockRaterIdentityRegistry.setHolder(voter1);
        mockRaterIdentityRegistry.setHolder(voter2);
        mockRaterIdentityRegistry.setHolder(voter3);
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, true, STAKE);
        _commit(voter3, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertTrue(_roundHasHumanVerifiedCommit(engine, contentId, roundId));

        vm.warp(uint256(r0.startTime) + EPOCH + 1);

        (bool canCommit, uint8 status, uint256 previewRoundId,, bool willStartNewRound) =
            _previewCommitAvailability(contentId);

        assertFalse(canCommit);
        assertEq(status, COMMIT_STATUS_WAITING_FOR_REVEAL_GRACE);
        assertEq(previewRoundId, roundId);
        assertFalse(willStartNewRound);
    }

    function test_BasicLifecycle_ThreeVoters_UpWins() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertTrue(round.upWins);
        assertGt(round.settledAt, 0);
    }

    function test_RbtsSettlementRejectsZeroEffectiveWeightLeaf() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);

        MockClusterPayoutOracleForRoundVotingEngine oracle =
            MockClusterPayoutOracleForRoundVotingEngine(ProtocolConfig(protocolConfigAddress).clusterPayoutOracle());
        oracle.setAllowZeroEffectiveWeight(true);

        vm.roll(block.number + 1);
        engine.settleRound(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.SettlementPending));

        bytes32[] memory commitKeys = _sortedCommitKeys(RoundEngineReadHelpers.commitKeys(engine, contentId, roundId));
        IClusterPayoutOracle.PayoutWeight[] memory payoutWeights =
            new IClusterPayoutOracle.PayoutWeight[](commitKeys.length);
        bytes32[][] memory proofs = new bytes32[][](commitKeys.length);
        uint256 totalClaimWeight;
        uint32 effectiveParticipantUnits;
        for (uint256 i = 0; i < commitKeys.length; i++) {
            bytes32 commitKey = commitKeys[i];
            uint256 baseWeight = _commitRbtsScoringWeight(engine, contentId, roundId, commitKey);
            uint256 effectiveWeight = i == 0 ? 0 : baseWeight;
            totalClaimWeight += effectiveWeight;
            effectiveParticipantUnits += 10_000;
            payoutWeights[i] = IClusterPayoutOracle.PayoutWeight({
                domain: 5,
                rewardPoolId: 0,
                contentId: contentId,
                roundId: roundId,
                commitKey: commitKey,
                identityKey: _commitIdentityKey(engine, contentId, roundId, commitKey),
                account: _commitIdentityHolder(engine, contentId, roundId, commitKey),
                baseWeight: baseWeight,
                independenceBps: 10_000,
                effectiveWeight: effectiveWeight,
                reasonHash: keccak256("zero-effective-rbts-test")
            });
            proofs[i] = new bytes32[](0);
        }

        oracle.configureFinalizedRbtsSnapshot(
            contentId, roundId, uint32(commitKeys.length), effectiveParticipantUnits, totalClaimWeight
        );

        vm.prank(address(oracle));
        vm.expectRevert(RoundRbtsSettlementSnapshotLib.InvalidState.selector);
        engine.applyRbtsSettlementSnapshot(contentId, roundId, payoutWeights, proofs);
    }

    function test_RbtsSettlementRejectsLeafIndependenceAboveBps() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);

        vm.roll(block.number + 1);
        engine.settleRound(contentId, roundId);

        MockClusterPayoutOracleForRoundVotingEngine oracle =
            MockClusterPayoutOracleForRoundVotingEngine(ProtocolConfig(protocolConfigAddress).clusterPayoutOracle());
        RbtsSettlementPayload memory payload = _fullWeightRbtsSettlementPayload(
            oracle, contentId, roundId, _sortedCommitKeys(RoundEngineReadHelpers.commitKeys(engine, contentId, roundId))
        );
        payload.payoutWeights[0].independenceBps = 10_001;

        uint256 totalClaimWeight;
        uint32 effectiveParticipantUnits;
        for (uint256 i = 0; i < payload.payoutWeights.length; i++) {
            totalClaimWeight += payload.payoutWeights[i].effectiveWeight;
            effectiveParticipantUnits += payload.payoutWeights[i].independenceBps;
        }
        oracle.configureFinalizedRbtsSnapshot(
            contentId, roundId, uint32(payload.payoutWeights.length), effectiveParticipantUnits, totalClaimWeight
        );

        vm.expectRevert(RoundRbtsSettlementSnapshotLib.InvalidState.selector);
        engine.applyRbtsSettlementSnapshot(contentId, roundId, payload.payoutWeights, payload.proofs);
    }

    function test_RbtsSettlementTimeoutBeforeDeadlineReverts() public {
        (uint256 contentId, uint256 roundId,) = _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));

        engine.settleRound(contentId, roundId);

        IClusterPayoutOracle.PayoutWeight[] memory payoutWeights = new IClusterPayoutOracle.PayoutWeight[](0);
        bytes32[][] memory proofs = new bytes32[][](0);
        vm.expectRevert(RoundVotingEngineRbtsSettlementModule.RoundNotExpired.selector);
        engine.applyRbtsSettlementSnapshot(contentId, roundId, payoutWeights, proofs);
    }

    function test_RbtsSettlementTimeoutReturnsStakesWhenNoSnapshotExists() public {
        (uint256 contentId, uint256 roundId, bytes32[8] memory commitKeys) =
            _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));

        engine.settleRound(contentId, roundId);
        vm.warp(block.timestamp + 1 hours);

        IClusterPayoutOracle.PayoutWeight[] memory payoutWeights = new IClusterPayoutOracle.PayoutWeight[](0);
        bytes32[][] memory proofs = new bytes32[][](0);
        engine.applyRbtsSettlementSnapshot(contentId, roundId, payoutWeights, proofs);

        RoundLib.Round memory settledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settledRound.state), uint256(RoundLib.RoundState.Settled));
        assertEq(_roundRbtsScoreSeed(engine, contentId, roundId), bytes32(0), "timeout records no score seed");
        assertGt(_commitRbtsStakeReturned(engine, contentId, roundId, commitKeys[0]), 0, "ck1 stake returned");
        assertGt(_commitRbtsStakeReturned(engine, contentId, roundId, commitKeys[7]), 0, "ck8 stake returned");
    }

    function test_RbtsSettlementTimeoutReturnsStakesWhenSnapshotKeyReverts() public {
        (uint256 contentId, uint256 roundId, bytes32[8] memory commitKeys) =
            _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));

        engine.settleRound(contentId, roundId);
        MockClusterPayoutOracleForRoundVotingEngine oracle =
            MockClusterPayoutOracleForRoundVotingEngine(ProtocolConfig(protocolConfigAddress).clusterPayoutOracle());
        oracle.setRevertSnapshotKey(true);
        vm.warp(block.timestamp + 1 hours);

        IClusterPayoutOracle.PayoutWeight[] memory payoutWeights = new IClusterPayoutOracle.PayoutWeight[](0);
        bytes32[][] memory proofs = new bytes32[][](0);
        engine.applyRbtsSettlementSnapshot(contentId, roundId, payoutWeights, proofs);

        RoundLib.Round memory settledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settledRound.state), uint256(RoundLib.RoundState.Settled));
        assertEq(_roundRbtsScoreSeed(engine, contentId, roundId), bytes32(0), "timeout records no score seed");
        assertGt(_commitRbtsStakeReturned(engine, contentId, roundId, commitKeys[0]), 0, "ck1 stake returned");
        assertGt(_commitRbtsStakeReturned(engine, contentId, roundId, commitKeys[7]), 0, "ck8 stake returned");
    }

    function test_RbtsSettlementTimeoutRevertsWhenUsableSnapshotExists() public {
        (uint256 contentId, uint256 roundId,) = _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));

        engine.settleRound(contentId, roundId);
        MockClusterPayoutOracleForRoundVotingEngine oracle =
            MockClusterPayoutOracleForRoundVotingEngine(ProtocolConfig(protocolConfigAddress).clusterPayoutOracle());
        _fullWeightRbtsSettlementPayload(
            oracle, contentId, roundId, _sortedCommitKeys(RoundEngineReadHelpers.commitKeys(engine, contentId, roundId))
        );
        vm.warp(block.timestamp + 1 hours);

        IClusterPayoutOracle.PayoutWeight[] memory payoutWeights = new IClusterPayoutOracle.PayoutWeight[](0);
        bytes32[][] memory proofs = new bytes32[][](0);
        vm.expectRevert(RoundVotingEngineRbtsSettlementModule.SnapshotAvailable.selector);
        engine.applyRbtsSettlementSnapshot(contentId, roundId, payoutWeights, proofs);
    }

    function test_RbtsSettlementTimeoutRevertsWhenProposedSnapshotExists() public {
        (uint256 contentId, uint256 roundId,) = _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));

        engine.settleRound(contentId, roundId);
        MockClusterPayoutOracleForRoundVotingEngine oracle =
            MockClusterPayoutOracleForRoundVotingEngine(ProtocolConfig(protocolConfigAddress).clusterPayoutOracle());
        oracle.configureRbtsSnapshotStatus(
            contentId, roundId, 8, 80_000, 8, IClusterPayoutOracle.SnapshotStatus.Proposed
        );
        vm.warp(block.timestamp + 1 hours);

        IClusterPayoutOracle.PayoutWeight[] memory payoutWeights = new IClusterPayoutOracle.PayoutWeight[](0);
        bytes32[][] memory proofs = new bytes32[][](0);
        vm.expectRevert(RoundVotingEngineRbtsSettlementModule.SnapshotAvailable.selector);
        engine.applyRbtsSettlementSnapshot(contentId, roundId, payoutWeights, proofs);
    }

    function test_RbtsSettlementTimeoutRevertsWhenMalformedLiveSnapshotExists() public {
        (uint256 contentId, uint256 roundId,) = _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));

        engine.settleRound(contentId, roundId);
        MockClusterPayoutOracleForRoundVotingEngine oracle =
            MockClusterPayoutOracleForRoundVotingEngine(ProtocolConfig(protocolConfigAddress).clusterPayoutOracle());
        oracle.configureRbtsSnapshotStatus(
            contentId, roundId, 7, 70_000, 70_000, IClusterPayoutOracle.SnapshotStatus.Proposed
        );
        vm.warp(block.timestamp + 1 hours);

        IClusterPayoutOracle.PayoutWeight[] memory payoutWeights = new IClusterPayoutOracle.PayoutWeight[](0);
        bytes32[][] memory proofs = new bytes32[][](0);
        vm.expectRevert(RoundVotingEngineRbtsSettlementModule.SnapshotAvailable.selector);
        engine.applyRbtsSettlementSnapshot(contentId, roundId, payoutWeights, proofs);
    }

    function test_ReplayBundleObserverNotify_ReplaysFailedSettledNotification() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        RevertingBundleObserver observer = new RevertingBundleObserver();
        observer.setConfigShape(address(registry), address(engine));
        MockClusterPayoutOracleForRoundVotingEngine oracle =
            MockClusterPayoutOracleForRoundVotingEngine(ProtocolConfig(protocolConfigAddress).clusterPayoutOracle());
        oracle.setRoundPayoutSnapshotConsumer(1, address(observer));
        oracle.setRoundPayoutSnapshotConsumer(4, address(observer));

        vm.prank(owner);
        registry.pause();
        vm.prank(owner);
        registry.setQuestionRewardPoolEscrow(address(observer));
        vm.prank(owner);
        registry.unpause();
        _linkBundleRoundObserver(registry, contentId, address(observer));

        _settleRoundAfterRbtsSeed(contentId, roundId);
        assertEq(observer.notifyCount(), 0, "failed callback is retained for replay");

        observer.setShouldRevert(false);
        vm.prank(owner);
        bool settled = engine.replayBundleObserverNotify(contentId, roundId);

        assertTrue(settled, "replay derives settled state from engine");
        assertEq(observer.notifyCount(), 1, "observer replayed once");
        assertEq(observer.observedContentId(), contentId);
        assertEq(observer.observedRoundId(), roundId);
        assertTrue(observer.observedSettled(), "observer receives settled=true");

        vm.prank(owner);
        vm.expectRevert("no pending replay");
        engine.replayBundleObserverNotify(contentId, roundId);
    }

    function _assertPendingRatingReview(uint256 contentId, uint256 roundId, address expectedEngine) internal {
        expectedEngine;
        address oracle = ProtocolConfig(protocolConfigAddress).clusterPayoutOracle();
        vm.prank(oracle);
        assertGt(
            registry.roundPayoutSnapshotSourceReadyAt(3, 0, contentId, roundId),
            0,
            "pending review ready timestamp recorded"
        );
        assertFalse(registry.isRoundPayoutSnapshotConsumed(3, 0, contentId, roundId), "pending review not applied");
    }

    function test_VerifiedHumanDoesNotBoostStakeWeight() public {
        RaterRegistry raterRegistry = _installRaterRegistry();

        vm.prank(owner);
        raterRegistry.seedHumanCredential(
            voter1, uint64(block.timestamp + 30 days), keccak256("rateloop-voter-1"), keccak256("rateloop-evidence")
        );

        uint256 contentId = _submitContent();
        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, 4e6);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, 4e6);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, 4e6);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, false, s2);
        _reveal(contentId, roundId, ck3, true, s3);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.weightedUpPool, 8e6, "verified human status does not boost weight");
    }

    function test_RbtsLifecycle_SettlesBinaryRatingAndScoresRewards() public {
        uint256 contentId;
        uint256 roundId;
        bytes32[8] memory commitKeys;
        (contentId, roundId, commitKeys) = _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));
        assertGt(
            _roundRatingUpEvidence(engine, contentId, roundId),
            _roundRatingDownEvidence(engine, contentId, roundId),
            "rating uses bounded signal evidence"
        );

        bool scored = _roundRbtsScored(engine, contentId, roundId);
        uint256 rewardWeight = _roundRbtsRewardWeight(engine, contentId, roundId);
        uint256 forfeitedPool = _roundRbtsForfeitedPool(engine, contentId, roundId);
        assertFalse(scored, "RBTS scores are stored at settlement");
        assertEq(rewardWeight, 0, "reward weight starts empty");
        assertEq(forfeitedPool, 0, "forfeited pool starts empty");

        _installPublicRatingClusterPayoutOracle();
        _settleRoundAfterRbtsSeed(contentId, roundId);

        assertEq(registry.getRating(contentId), 5_000, "public rating waits for correlation snapshot");
        _assertPendingRatingReview(contentId, roundId, address(engine));
        scored = _roundRbtsScored(engine, contentId, roundId);
        rewardWeight = _roundRbtsRewardWeight(engine, contentId, roundId);
        forfeitedPool = _roundRbtsForfeitedPool(engine, contentId, roundId);
        assertTrue(scored, "RBTS scored");
        assertGt(rewardWeight, 0, "positive RBTS reward weight");
        assertGt(forfeitedPool, 0, "imperfect scores forfeit some stake");
        assertGt(_commitRbtsScoreBps(engine, contentId, roundId, commitKeys[0]), 0, "first commit scored");
    }

    function test_RbtsSettlement_UsesLeaveOneOutScoreSpreadBenchmarks() public {
        uint256 contentId = _submitContent();

        address[] memory voters = _scoreSpreadFixtureVoters();
        bool[] memory directions = _scoreSpreadFixtureDirections();
        bytes32[] memory commitKeys = new bytes32[](SCORE_SPREAD_TEST_REVEALS);
        bytes32[] memory salts = new bytes32[](SCORE_SPREAD_TEST_REVEALS);
        uint256[] memory stakes = new uint256[](SCORE_SPREAD_TEST_REVEALS);
        stakes[0] = 10e6;
        for (uint256 i = 1; i < SCORE_SPREAD_TEST_REVEALS; i++) {
            stakes[i] = 1e6;
        }

        for (uint256 i = 0; i < SCORE_SPREAD_TEST_REVEALS; i++) {
            (commitKeys[i], salts[i]) =
                _commitPrediction(voters[i], contentId, directions[i], _predictionBps(i, directions[i]), stakes[i]);
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        for (uint256 i = 0; i < SCORE_SPREAD_TEST_REVEALS; i++) {
            _revealPrediction(
                contentId, roundId, commitKeys[i], directions[i], _predictionBps(i, directions[i]), salts[i]
            );
        }

        _installPublicRatingClusterPayoutOracle();
        _settleRoundAfterRbtsSeed(contentId, roundId);

        uint256 weightedScoreSum;
        uint256 scoreWeightSum;
        for (uint256 i = 0; i < SCORE_SPREAD_TEST_REVEALS; i++) {
            uint256 scoringWeight = _commitRbtsScoringWeight(engine, contentId, roundId, commitKeys[i]);
            uint16 scoreBps = _commitRbtsScoreBps(engine, contentId, roundId, commitKeys[i]);
            weightedScoreSum += scoringWeight * scoreBps;
            scoreWeightSum += scoringWeight;
        }

        uint256 expectedPositiveSpreadWeight;
        for (uint256 i = 0; i < SCORE_SPREAD_TEST_REVEALS; i++) {
            uint256 scoringWeight = _commitRbtsScoringWeight(engine, contentId, roundId, commitKeys[i]);
            uint16 scoreBps = _commitRbtsScoreBps(engine, contentId, roundId, commitKeys[i]);
            uint16 benchmarkScoreBps =
                RewardMath.calculateLeaveOneOutMeanScoreBps(weightedScoreSum, scoreWeightSum, scoringWeight, scoreBps);
            expectedPositiveSpreadWeight += RewardMath.calculatePositiveScoreSpreadWeight(
                scoringWeight, scoreBps, benchmarkScoreBps
            );
        }

        assertGt(expectedPositiveSpreadWeight, 0, "fixture should create positive leave-one-out spreads");

        for (uint256 i = 0; i < SCORE_SPREAD_TEST_REVEALS; i++) {
            uint256 scoringWeight = _commitRbtsScoringWeight(engine, contentId, roundId, commitKeys[i]);
            uint16 scoreBps = _commitRbtsScoreBps(engine, contentId, roundId, commitKeys[i]);
            uint16 benchmarkScoreBps =
                RewardMath.calculateLeaveOneOutMeanScoreBps(weightedScoreSum, scoreWeightSum, scoringWeight, scoreBps);
            uint256 expectedRewardWeight =
                RewardMath.calculatePositiveScoreSpreadWeight(scoringWeight, scoreBps, benchmarkScoreBps);
            uint256 expectedForfeit = RewardMath.calculateNegativeScoreSpreadForfeit(
                scoringWeight, scoreBps, benchmarkScoreBps, SCORE_SPREAD_TEST_REVEALS
            );

            assertEq(
                _commitRbtsRewardWeight(engine, contentId, roundId, commitKeys[i]),
                expectedRewardWeight,
                "reward weight should use leave-one-out benchmark"
            );
            assertEq(
                _commitRbtsForfeitedStake(engine, contentId, roundId, commitKeys[i]),
                expectedForfeit,
                string.concat(
                    "forfeited stake should use leave-one-out benchmark and scoring weight #", Strings.toString(i)
                )
            );
        }
    }

    function test_SettleRound_PaysCallerIncentiveFromRbtsForfeits() public {
        uint256 contentId = _submitContent();

        address[] memory voters = _scoreSpreadFixtureVoters();
        bool[] memory directions = _scoreSpreadFixtureDirections();
        bytes32[] memory commitKeys = new bytes32[](SCORE_SPREAD_TEST_REVEALS);
        bytes32[] memory salts = new bytes32[](SCORE_SPREAD_TEST_REVEALS);

        for (uint256 i = 0; i < SCORE_SPREAD_TEST_REVEALS; i++) {
            (commitKeys[i], salts[i]) =
                _commitPrediction(voters[i], contentId, directions[i], _predictionBps(i, directions[i]), STAKE);
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        for (uint256 i = 0; i < SCORE_SPREAD_TEST_REVEALS; i++) {
            engine.revealVoteByCommitKey(
                contentId, roundId, commitKeys[i], directions[i], _predictionBps(i, directions[i]), salts[i]
            );
        }

        engine.settleRound(contentId, roundId);
        _rollPastRbtsSeedBlock(block.number + 1);

        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        vm.startPrank(keeper);
        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        vm.stopPrank();

        uint256 grossForfeited;
        for (uint256 i = 0; i < SCORE_SPREAD_TEST_REVEALS; i++) {
            grossForfeited += _commitRbtsForfeitedStake(engine, contentId, roundId, commitKeys[i]);
        }
        uint256 expectedIncentive = grossForfeited / 100;
        if (expectedIncentive > 1e6) expectedIncentive = 1e6;

        assertGt(grossForfeited, 0, "fixture creates RBTS forfeits");
        assertEq(lrepToken.balanceOf(keeper) - keeperBefore, expectedIncentive, "caller incentive paid");
        assertEq(
            _roundRbtsForfeitedPool(engine, contentId, roundId),
            grossForfeited - expectedIncentive,
            "stored forfeits are net of caller incentive"
        );
    }

    function test_RbtsSeedWaitsForFutureBlockAfterSettlementClosure() public {
        (uint256 contentId, uint256 roundId,) = _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));

        uint256 seedBlock = block.number + 1;
        engine.settleRound(contentId, roundId);
        RoundLib.Round memory pendingRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(
            uint256(pendingRound.state),
            uint256(RoundLib.RoundState.SettlementPending),
            "first call closes scoring and waits for snapshot"
        );

        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        pendingRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(pendingRound.state), uint256(RoundLib.RoundState.SettlementPending), "seed block not ready");
        assertFalse(_roundRbtsScored(engine, contentId, roundId), "RBTS not scored before seed block");

        _rollPastRbtsSeedBlock(seedBlock);
        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        RoundLib.Round memory settledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settledRound.state), uint256(RoundLib.RoundState.Settled));
        assertNotEq(_roundRbtsScoreSeed(engine, contentId, roundId), bytes32(0), "future block entropy scores RBTS");
    }

    function test_RbtsSeedPastNativeWindowWithoutHistoryRearmsFutureBlock() public {
        (uint256 contentId, uint256 roundId,) = _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));

        uint256 seedBlock = block.number + 1;
        engine.settleRound(contentId, roundId);
        vm.roll(seedBlock + 257);

        vm.recordLogs();
        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        uint256 rearmedSeedBlock = _rbtsSeedBlockFromLogs(vm.getRecordedLogs(), contentId, roundId);
        RoundLib.Round memory pendingRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(pendingRound.state), uint256(RoundLib.RoundState.SettlementPending));
        assertFalse(_roundRbtsScored(engine, contentId, roundId), "missed entropy re-arms instead of settling");

        _rollPastRbtsSeedBlock(rearmedSeedBlock);
        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        RoundLib.Round memory settledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settledRound.state), uint256(RoundLib.RoundState.Settled));
        assertTrue(_roundRbtsScored(engine, contentId, roundId), "rearmed entropy finalizes accounting");
        assertNotEq(_roundRbtsScoreSeed(engine, contentId, roundId), bytes32(0), "rearmed entropy scores RBTS");
    }

    function test_RbtsSeedPastNativeWindowUsesEip2935History() public {
        (uint256 contentId, uint256 roundId,) = _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));

        uint256 seedBlock = block.number + 1;
        engine.settleRound(contentId, roundId);
        vm.roll(seedBlock + 257);
        _installMockEip2935History(keccak256("rbts-eip2935-history"));

        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        RoundLib.Round memory settledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settledRound.state), uint256(RoundLib.RoundState.Settled));
        assertTrue(_roundRbtsScored(engine, contentId, roundId), "EIP-2935 entropy finalizes RBTS accounting");
        assertNotEq(
            _roundRbtsScoreSeed(engine, contentId, roundId), bytes32(0), "history entropy produces sampler seed"
        );
    }

    function test_RbtsLongDelayedSettlementRearmsMissedEntropy() public {
        (uint256 contentId, uint256 roundId,) = _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));

        uint256 seedBlock = block.number + 1;
        engine.settleRound(contentId, roundId);
        vm.roll(seedBlock + 8192);

        vm.recordLogs();
        vm.prank(keeper);
        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        uint256 rearmedSeedBlock = _rbtsSeedBlockFromLogs(vm.getRecordedLogs(), contentId, roundId);

        RoundLib.Round memory pending = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(pending.state), uint256(RoundLib.RoundState.SettlementPending), "missed entropy re-arms");
        assertFalse(_roundRbtsScored(engine, contentId, roundId), "no stake-return fallback");

        _rollPastRbtsSeedBlock(rearmedSeedBlock);
        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        RoundLib.Round memory settled = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settled.state), uint256(RoundLib.RoundState.Settled), "rearmed settlement succeeds");
        assertNotEq(_roundRbtsScoreSeed(engine, contentId, roundId), bytes32(0), "rearmed sampler seed");
    }

    function test_RbtsLongDelayedSettlementCanSettleOnlyOnce() public {
        (uint256 contentId, uint256 roundId, bytes32[8] memory commitKeys) =
            _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));

        engine.settleRound(contentId, roundId);
        vm.roll(block.number + 8192);
        vm.recordLogs();
        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        uint256 rearmedSeedBlock = _rbtsSeedBlockFromLogs(vm.getRecordedLogs(), contentId, roundId);
        assertFalse(_roundRbtsScored(engine, contentId, roundId), "missed entropy re-arms first");

        _rollPastRbtsSeedBlock(rearmedSeedBlock);
        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        assertTrue(_roundRbtsScored(engine, contentId, roundId), "rearmed settlement finalizes once");
        assertNotEq(_roundRbtsScoreSeed(engine, contentId, roundId), bytes32(0), "rearmed entropy scores RBTS");

        _expectFullWeightRbtsSettlementSnapshotRevert(contentId, roundId, RoundVotingEngine.RoundNotOpen.selector);

        RoundLib.Round memory settledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settledRound.state), uint256(RoundLib.RoundState.Settled));
        assertGt(_commitRbtsStakeReturned(engine, contentId, roundId, commitKeys[0]), 0, "ck1 stake accounted");
        assertGt(_commitRbtsStakeReturned(engine, contentId, roundId, commitKeys[3]), 0, "ck4 stake accounted");
    }

    function test_RbtsLongDelayedSettlementPreservesCleanupCutoff() public {
        uint256 contentId = _submitContent();

        address[] memory voters = _scoreSpreadFixtureVoters();
        bool[] memory directions = _scoreSpreadFixtureDirections();
        bytes32[] memory commitKeys = new bytes32[](SCORE_SPREAD_TEST_REVEALS);
        bytes32[] memory salts = new bytes32[](SCORE_SPREAD_TEST_REVEALS);
        for (uint256 i = 0; i < SCORE_SPREAD_TEST_REVEALS; i++) {
            (commitKeys[i], salts[i]) =
                _commitPrediction(voters[i], contentId, directions[i], _predictionBps(i, directions[i]), STAKE);
        }
        address unrevealedVoter = address(0xBEEF1234);
        mockRaterIdentityRegistry.setHolder(unrevealedVoter);
        vm.prank(owner);
        lrepToken.mint(unrevealedVoter, 10_000e6);
        _commit(unrevealedVoter, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        for (uint256 i = 0; i < SCORE_SPREAD_TEST_REVEALS; i++) {
            engine.revealVoteByCommitKey(
                contentId, roundId, commitKeys[i], directions[i], _predictionBps(i, directions[i]), salts[i]
            );
        }
        vm.warp(
            _lastCommitRevealableAfter(engine, contentId, roundId)
                + ProtocolConfig(protocolConfigAddress).revealGracePeriod() + 1
        );

        uint256 seedBlock = block.number;
        uint256 seedTimestamp = block.timestamp;
        engine.settleRound(contentId, roundId);
        assertTrue(_roundRbtsScoringClosed(engine, contentId, roundId), "seed capture closes scoring");

        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        uint256 unrevealedBefore = lrepToken.balanceOf(unrevealedVoter);
        uint256 treasuryBefore = lrepToken.balanceOf(treasury);
        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);

        assertEq(lrepToken.balanceOf(unrevealedVoter), unrevealedBefore, "past-epoch unrevealed stake forfeits");
        assertEq(lrepToken.balanceOf(keeper) - keeperBefore, STAKE / 100, "cleanup bounty paid");
        assertEq(lrepToken.balanceOf(treasury) - treasuryBefore, STAKE - (STAKE / 100), "forfeit reaches treasury");

        vm.roll(seedBlock + 8192);
        vm.warp(seedTimestamp + 3 * EPOCH);
        vm.recordLogs();
        _applyFullWeightRbtsSettlementSnapshot(
            MockClusterPayoutOracleForRoundVotingEngine(ProtocolConfig(protocolConfigAddress).clusterPayoutOracle()),
            contentId,
            roundId,
            commitKeys
        );
        uint256 rearmedSeedBlock = _rbtsSeedBlockFromLogs(vm.getRecordedLogs(), contentId, roundId);
        assertFalse(_roundRbtsScored(engine, contentId, roundId), "missed entropy re-arms after cleanup");
        _rollPastRbtsSeedBlock(rearmedSeedBlock);
        _applyFullWeightRbtsSettlementSnapshot(
            MockClusterPayoutOracleForRoundVotingEngine(ProtocolConfig(protocolConfigAddress).clusterPayoutOracle()),
            contentId,
            roundId,
            commitKeys
        );
        assertTrue(_roundRbtsScored(engine, contentId, roundId), "long-delayed settlement finalizes");
        assertNotEq(_roundRbtsScoreSeed(engine, contentId, roundId), bytes32(0), "rearmed entropy scores");
    }

    function test_AdvisoryLaunchCreditLongDelayedRbtsSettlementScoresBeforeClaim() public {
        uint256 contentId = _submitContent();

        address[] memory voters = _scoreSpreadFixtureVoters();
        bool[] memory directions = _scoreSpreadFixtureDirections();
        bytes32[] memory commitKeys = new bytes32[](SCORE_SPREAD_TEST_REVEALS);
        bytes32[] memory salts = new bytes32[](SCORE_SPREAD_TEST_REVEALS);
        for (uint256 i = 0; i < SCORE_SPREAD_TEST_REVEALS; i++) {
            (commitKeys[i], salts[i]) =
                _commitPrediction(voters[i], contentId, directions[i], _predictionBps(i, directions[i]), STAKE);
        }
        (bytes32 advisoryCommitKey, bytes32 advisorySalt) = _recordAdvisory(voter8, contentId, "expired-seed-advisory");

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        for (uint256 i = 0; i < SCORE_SPREAD_TEST_REVEALS; i++) {
            engine.revealVoteByCommitKey(
                contentId, roundId, commitKeys[i], directions[i], _predictionBps(i, directions[i]), salts[i]
            );
        }
        advisoryRecorder.revealAdvisoryVote(advisoryCommitKey, true, 5_000, advisorySalt);

        uint256 seedBlock = block.number + 1;
        engine.settleRound(contentId, roundId);
        vm.roll(seedBlock + 8191);
        _installMockEip2935History(keccak256("advisory-rbts-eip2935-history"));

        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        assertTrue(_roundRbtsScored(engine, contentId, roundId), "long-delayed settlement scores RBTS");
        assertNotEq(_roundRbtsScoreSeed(engine, contentId, roundId), bytes32(0), "sampler seed produced");

        (uint16 claimedScoreBps, uint256 paidAmount) = advisoryRecorder.claimAdvisoryLaunchCredit(advisoryCommitKey);
        (,,,,,,,, bool launchCreditClaimed, uint16 storedScoreBps) =
            advisoryRecorder.advisoryCommitCore(advisoryCommitKey);
        assertEq(paidAmount, 0, "fixture has no launch payment");
        assertEq(claimedScoreBps, storedScoreBps, "claim returns stored score");
        assertGt(storedScoreBps, 0, "settlement stores advisory score");
        assertFalse(launchCreditClaimed, "claim without launch pool remains retryable");
    }

    function test_AdvisoryLaunchCreditSkipsRawBannedDelegateAtClaim() public {
        MockAdvisoryLaunchDistributionPool launchPool = _setMockAdvisoryLaunchPool(3);

        mockRaterIdentityRegistry.mint(voter5, 55);
        vm.prank(voter5);
        mockRaterIdentityRegistry.setDelegate(delegate1);

        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commitPrediction(voter1, contentId, true, 8_000, 10e6);
        (bytes32 advisoryCommitKey, bytes32 advisorySalt) = _recordAdvisory(delegate1, contentId, "raw-banned-advisory");
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, false, 5_000, 3e6);
        (bytes32 ck3, bytes32 s3) = _commitPrediction(voter3, contentId, true, 6_500, 3e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        engine.revealVoteByCommitKey(contentId, roundId, ck1, true, 8_000, s1);
        engine.revealVoteByCommitKey(contentId, roundId, ck2, false, 5_000, s2);
        engine.revealVoteByCommitKey(contentId, roundId, ck3, true, 6_500, s3);
        advisoryRecorder.revealAdvisoryVote(advisoryCommitKey, true, 5_000, advisorySalt);

        _settleRoundAfterRbtsSeed(contentId, roundId);
        assertTrue(_roundRbtsScored(engine, contentId, roundId), "round scored");

        mockRaterIdentityRegistry.setBanned(mockRaterIdentityRegistry.addressIdentityKey(delegate1), true);

        (uint16 claimedScoreBps, uint256 paidAmount) = advisoryRecorder.claimAdvisoryLaunchCredit(advisoryCommitKey);
        (,,,,,,,, bool launchCreditClaimed, uint16 storedScoreBps) =
            advisoryRecorder.advisoryCommitCore(advisoryCommitKey);
        assertTrue(launchCreditClaimed, "raw-banned delegate claim is terminal");
        assertEq(paidAmount, 0, "raw-banned delegate receives no launch payment");
        assertEq(claimedScoreBps, storedScoreBps, "claim returns stored score");
        assertEq(launchPool.advisoryRecordCallCount(), 0, "launch pool not called");
    }

    function test_AdvisoryLaunchCreditSkipsBannedHolderAtClaim() public {
        MockAdvisoryLaunchDistributionPool launchPool = _setMockAdvisoryLaunchPool(3);

        mockRaterIdentityRegistry.mint(voter5, 55);
        vm.prank(voter5);
        mockRaterIdentityRegistry.setDelegate(delegate1);

        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commitPrediction(voter1, contentId, true, 8_000, 10e6);
        (bytes32 advisoryCommitKey, bytes32 advisorySalt) =
            _recordAdvisory(delegate1, contentId, "holder-banned-advisory");
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, false, 5_000, 3e6);
        (bytes32 ck3, bytes32 s3) = _commitPrediction(voter3, contentId, true, 6_500, 3e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        engine.revealVoteByCommitKey(contentId, roundId, ck1, true, 8_000, s1);
        engine.revealVoteByCommitKey(contentId, roundId, ck2, false, 5_000, s2);
        engine.revealVoteByCommitKey(contentId, roundId, ck3, true, 6_500, s3);
        advisoryRecorder.revealAdvisoryVote(advisoryCommitKey, true, 5_000, advisorySalt);

        _settleRoundAfterRbtsSeed(contentId, roundId);
        assertTrue(_roundRbtsScored(engine, contentId, roundId), "round scored");

        mockRaterIdentityRegistry.setBanned(mockRaterIdentityRegistry.addressIdentityKey(voter5), true);

        (uint16 claimedScoreBps, uint256 paidAmount) = advisoryRecorder.claimAdvisoryLaunchCredit(advisoryCommitKey);
        (,,,,,,,, bool launchCreditClaimed, uint16 storedScoreBps) =
            advisoryRecorder.advisoryCommitCore(advisoryCommitKey);
        assertTrue(launchCreditClaimed, "holder-banned advisory claim is terminal");
        assertEq(paidAmount, 0, "holder-banned advisory receives no launch payment");
        assertEq(claimedScoreBps, storedScoreBps, "claim returns stored score");
        assertEq(launchPool.advisoryRecordCallCount(), 0, "launch pool not called");
    }

    function test_AdvisoryLaunchCreditRevealAfterRbtsSeedCaptureRejected() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commitPrediction(voter1, contentId, true, 8_000, 10e6);
        (bytes32 advisoryCommitKey, bytes32 advisorySalt) = _recordAdvisory(voter5, contentId, "post-seed-advisory");
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, false, 5_000, 3e6);
        (bytes32 ck3, bytes32 s3) = _commitPrediction(voter3, contentId, true, 6_500, 3e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        engine.revealVoteByCommitKey(contentId, roundId, ck1, true, 8_000, s1);
        engine.revealVoteByCommitKey(contentId, roundId, ck2, false, 5_000, s2);
        engine.revealVoteByCommitKey(contentId, roundId, ck3, true, 6_500, s3);

        engine.settleRound(contentId, roundId);
        assertTrue(_roundRbtsScoringClosed(engine, contentId, roundId), "seed capture closes scoring");

        vm.expectRevert(RoundVotingEngine.RoundNotOpen.selector);
        advisoryRecorder.revealAdvisoryVote(advisoryCommitKey, true, 5_000, advisorySalt);
    }

    function test_RbtsLongDelayedSettlementDoesNotUsePrevrandaoFallback() public {
        (uint256 contentId, uint256 roundId,,) =
            _setupEconomicPredictionRoundWithSalts(_fiveUpThreeDownDirections(), address(0));

        uint256 seedBlock = block.number + 1;
        engine.settleRound(contentId, roundId);
        vm.roll(seedBlock + 8192);

        bytes32 settlementPrevrandao = keccak256("expired-settlement-prevrandao");
        vm.prevrandao(settlementPrevrandao);
        vm.recordLogs();
        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        uint256 rearmedSeedBlock = _rbtsSeedBlockFromLogs(vm.getRecordedLogs(), contentId, roundId);
        assertFalse(_roundRbtsScored(engine, contentId, roundId), "prevrandao does not settle missed entropy");

        _rollPastRbtsSeedBlock(rearmedSeedBlock);
        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        assertTrue(_roundRbtsScored(engine, contentId, roundId), "rearmed settlement finalizes");
        assertNotEq(_roundRbtsScoreSeed(engine, contentId, roundId), settlementPrevrandao, "prevrandao is ignored");
    }

    function test_RbtsScoringSeed_UsesCapturedEntropyAndCommittedSet() public {
        (uint256 contentId, uint256 roundId, bytes32[8] memory commitKeys, bytes32[8] memory salts) =
            _setupEconomicPredictionRoundWithSalts(_fiveUpThreeDownDirections(), address(0));

        vm.recordLogs();
        uint256 seedBlock = block.number + 1;
        engine.settleRound(contentId, roundId);
        _rollPastRbtsSeedBlock(seedBlock);
        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_rbtsSeedBlockFromLogs(logs, contentId, roundId), seedBlock, "seed block captured");
        bytes32 settlementEntropy = _rbtsFutureBlockEntropy(contentId, roundId, seedBlock, blockhash(seedBlock));

        bytes32 revealedSetHash = _revealedSetHash(contentId, roundId, commitKeys, salts);
        bytes32 expectedSeed = keccak256(
            abi.encode(
                block.chainid, address(engine), contentId, roundId, uint256(8), revealedSetHash, settlementEntropy
            )
        );
        bytes32[8] memory alteredSalts = salts;
        alteredSalts[0] = keccak256(abi.encode(salts[0], "altered"));
        bytes32 alteredSetHash = _revealedSetHash(contentId, roundId, commitKeys, alteredSalts);
        bytes32 alteredSeed = keccak256(
            abi.encode(
                block.chainid, address(engine), contentId, roundId, uint256(8), alteredSetHash, settlementEntropy
            )
        );

        bytes32 expectedTopic =
            keccak256("RbtsRewardsScored(uint256,uint256,bytes32,uint256,uint256,uint256,uint256,uint16)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == address(engine) && logs[i].topics.length == 3 && logs[i].topics[0] == expectedTopic
                    && uint256(logs[i].topics[1]) == contentId && uint256(logs[i].topics[2]) == roundId
            ) {
                (bytes32 scoreSeed,,,,,) =
                    abi.decode(logs[i].data, (bytes32, uint256, uint256, uint256, uint256, uint16));
                assertEq(scoreSeed, expectedSeed, "score seed must use captured entropy");
                assertNotEq(scoreSeed, alteredSeed, "score seed must bind revealed salts");
                found = true;
                break;
            }
        }
        assertTrue(found, "RbtsRewardsScored event not emitted");
    }

    function test_RbtsScoringSeed_IgnoresSettlementPrevrandao() public {
        (uint256 contentId, uint256 roundId, bytes32[8] memory commitKeys, bytes32[8] memory salts) =
            _setupEconomicPredictionRoundWithSalts(_fiveUpThreeDownDirections(), address(0));

        vm.recordLogs();
        uint256 seedBlock = block.number + 1;
        engine.settleRound(contentId, roundId);
        _rollPastRbtsSeedBlock(seedBlock);

        bytes32 settlementPrevrandao = keccak256("settlement-prevrandao");
        vm.prevrandao(settlementPrevrandao);
        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_rbtsSeedBlockFromLogs(logs, contentId, roundId), seedBlock, "seed block captured");
        bytes32 capturedEntropy = _rbtsFutureBlockEntropy(contentId, roundId, seedBlock, blockhash(seedBlock));

        bytes32 revealedSetHash = _revealedSetHash(contentId, roundId, commitKeys, salts);
        bytes32 expectedSeed = keccak256(
            abi.encode(block.chainid, address(engine), contentId, roundId, uint256(8), revealedSetHash, capturedEntropy)
        );
        bytes32 settlementSeed = keccak256(
            abi.encode(
                block.chainid, address(engine), contentId, roundId, uint256(8), revealedSetHash, settlementPrevrandao
            )
        );
        assertNotEq(expectedSeed, settlementSeed, "test setup needs distinct settlement entropy");
        bytes32 expectedTopic =
            keccak256("RbtsRewardsScored(uint256,uint256,bytes32,uint256,uint256,uint256,uint256,uint16)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == address(engine) && logs[i].topics.length == 3 && logs[i].topics[0] == expectedTopic
                    && uint256(logs[i].topics[1]) == contentId && uint256(logs[i].topics[2]) == roundId
            ) {
                (bytes32 scoreSeed,,,,,) =
                    abi.decode(logs[i].data, (bytes32, uint256, uint256, uint256, uint256, uint16));
                assertEq(scoreSeed, expectedSeed, "score seed must ignore settlement prevrandao");
                found = true;
                break;
            }
        }
        assertTrue(found, "RbtsRewardsScored event not emitted");
    }

    function test_RbtsZeroStakeCommitRejectedByCountedVoting() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);
        uint256 roundContext = _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter3);
        vm.expectRevert(RoundVotingEngine.InvalidStake.selector);
        engine.commitVote(
            contentId,
            roundContext,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            0,
            address(0)
        );
    }

    function test_RbtsBelowMinimumStakeCommitRejectedByCountedVoting() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);
        uint256 roundContext = _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter4);
        vm.expectRevert(RoundVotingEngine.InvalidStake.selector);
        engine.commitVote(
            contentId,
            roundContext,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            999_999,
            address(0)
        );
    }

    function test_RbtsSettlementRequiresThreeReveals() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commitPrediction(voter1, contentId, true, 8_000, STAKE);
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, true, 5_000, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        engine.revealVoteByCommitKey(contentId, roundId, ck1, true, 8_000, s1);
        engine.revealVoteByCommitKey(contentId, roundId, ck2, true, 5_000, s2);

        vm.roll(block.number + 1);
        vm.expectRevert(RoundVotingEngine.NotEnoughVotes.selector);
        engine.settleRound(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Open));
        assertFalse(_roundRbtsScored(engine, contentId, roundId), "RBTS not scored below n=3");
    }

    function test_RbtsRewardsScorePredictionAgainstPeerSignals() public {
        (uint256 contentId, uint256 roundId, bytes32[8] memory commitKeys) =
            _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));
        _installPublicRatingClusterPayoutOracle();
        _settleRoundAfterRbtsSeed(contentId, roundId);

        assertEq(registry.getRating(contentId), 5_000, "public rating waits for correlation snapshot");
        _assertPendingRatingReview(contentId, roundId, address(engine));
        assertEq(
            _commitPredictedUpBps(engine, contentId, roundId, commitKeys[1]),
            _predictionBps(1, true),
            "crowd prediction stored"
        );
        assertTrue(_roundRbtsScored(engine, contentId, roundId), "RBTS scored");
        assertNotEq(_roundRbtsScoreSeed(engine, contentId, roundId), bytes32(0), "score seed captured");
        uint256 positiveScores;
        for (uint256 i = 0; i < commitKeys.length; i++) {
            if (_commitRbtsScoreBps(engine, contentId, roundId, commitKeys[i]) > 0) positiveScores++;
        }
        assertGt(positiveScores, 0, "at least one peer signal earns RBTS score");
    }

    function test_RbtsRevealRejectsWrongPrediction() public {
        uint256 contentId = _submitContent();
        (bytes32 commitKey, bytes32 salt) = _commitPrediction(voter1, contentId, 7_000, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        vm.expectRevert();
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 7_001, salt);
    }

    function test_BasicLifecycle_ThreeVoters_DownWins() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, false, false);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertFalse(round.upWins);
    }

    function test_BasicLifecycle_VoteCountersUpdated() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.voteCount, 2);
        assertEq(round.totalStake, STAKE * 2);

        // Warp past epoch and reveal
        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, false, s2);

        round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.revealedCount, 2);
        assertEq(round.upPool, STAKE);
        assertEq(round.downPool, STAKE);
        assertEq(round.upCount, 1);
        assertEq(round.downCount, 1);
    }

    function test_BasicLifecycle_CommitHashTracked() public {
        uint256 contentId = _submitContent();

        bool isUp = true;
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(isUp, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext1 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        engine.commitVote(
            contentId,
            cachedRoundContext1,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(_voterCommitHash(engine, contentId, roundId, voter1), commitHash);
        assertTrue(_voterCommitHash(engine, contentId, roundId, voter1) != bytes32(0));
    }

    function test_CommitVote_RevertsWhenPreviewedRoundIsStale() public {
        uint256 contentId = _submitContent();
        TestCommitArtifacts memory staleCommit = _buildTestCommitArtifacts(
            address(engine), voter4, true, keccak256(abi.encodePacked(voter4, "stale-round")), contentId
        );

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, true, STAKE);
        _commit(voter3, contentId, false, STAKE);

        vm.warp(block.timestamp + 8 days);

        _openRoundForTest(engine, contentId, voter4);
        vm.startPrank(voter4);
        lrepToken.approve(address(engine), STAKE);
        vm.expectRevert(RoundVotingEngine.InvalidCommitHash.selector);
        engine.commitVote(
            contentId,
            _roundContext(staleCommit.roundId, staleCommit.roundReferenceRatingBps),
            staleCommit.targetRound,
            staleCommit.drandChainHash,
            staleCommit.commitHash,
            staleCommit.ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_BasicLifecycle_HasCommitsTurnsTrue() public {
        uint256 contentId = _submitContent();
        assertFalse(engine.hasCommits(contentId));

        _commit(voter1, contentId, true, STAKE);
        assertTrue(engine.hasCommits(contentId));

        _commit(voter2, contentId, false, STAKE);
        assertTrue(engine.hasCommits(contentId));
    }

    function test_BasicLifecycle_VoterPoolAndWinningStake() public {
        (uint256 contentId, uint256 roundId,) = _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));

        _settleRoundAfterRbtsSeed(contentId, roundId);

        uint256 voterPool = _roundVoterPool(engine, contentId, roundId);
        uint256 winningStake = _roundWinningStake(engine, contentId, roundId);
        assertGt(voterPool, 0);
        assertGt(winningStake, 0);
    }

    function test_BasicLifecycle_SettlementSetsTimestamp() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertGt(round.settledAt, 0);
    }

    // =========================================================================
    // 2. ROUND EXPIRY / CANCELLATION (minVoters not reached)
    // =========================================================================

    function test_CancelExpired_SucceedsAfterMaxDuration() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        // Only 2 commits — minVoters=3 not reached

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past 7-day max duration
        vm.warp(block.timestamp + EPOCH + 1);

        engine.cancelExpiredRound(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Cancelled));
    }

    function test_CommitAfterExpiredBelowQuorum_StartsNewRound() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        vm.warp(uint256(round.startTime) + EPOCH + 1);

        _commit(voter3, contentId, true, STAKE);

        RoundLib.Round memory cancelledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        uint256 newRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(uint256(cancelledRound.state), uint256(RoundLib.RoundState.Cancelled));
        assertEq(newRoundId, roundId + 1, "new commits roll into a fresh round after below-quorum expiry");
        assertTrue(_voterCommitHash(engine, contentId, newRoundId, voter3) != bytes32(0));
    }

    function test_CancelExpired_RevertsBeforeExpiry() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);

        vm.warp(uint256(round.startTime) + EPOCH - 1);

        vm.expectRevert(RoundVotingEngine.RoundNotExpired.selector);
        engine.cancelExpiredRound(contentId, roundId);
    }

    function test_CancelExpired_RevertsIfThresholdAlreadyReached() public {
        uint256 contentId = _submitContent();

        // L-Vote-4 follow-up: cancel-lockout requires HRC commit quorum.
        mockRaterIdentityRegistry.setHolder(voter1);
        mockRaterIdentityRegistry.setHolder(voter2);
        mockRaterIdentityRegistry.setHolder(voter3);

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past epoch and reveal all (threshold reached)
        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);

        // Warp past max duration — but threshold was reached so cancel should fail
        vm.warp(block.timestamp + EPOCH + 1);

        vm.expectRevert(RoundVotingEngine.ThresholdReached.selector);
        engine.cancelExpiredRound(contentId, roundId);
    }

    function test_CancelExpired_RevertsIfCommitQuorumReachedWithoutReveals() public {
        uint256 contentId = _submitContent();

        // L-Vote-4 follow-up: cancel-lockout requires HRC commit quorum.
        mockRaterIdentityRegistry.setHolder(voter1);
        mockRaterIdentityRegistry.setHolder(voter2);
        mockRaterIdentityRegistry.setHolder(voter3);

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.warp(block.timestamp + EPOCH + 1);

        vm.expectRevert(RoundVotingEngine.ThresholdReached.selector);
        engine.cancelExpiredRound(contentId, roundId);
    }

    /// @notice L-Vote-4: if no HRC voter participates, an expired round at commit quorum is
    ///         still refund-cancellable. Sybils cannot grief honest content into a RevealFailed
    ///         cycle at 3× min-stake.
    function test_CancelExpired_AllSybilQuorum_Cancellable() public {
        uint256 contentId = _submitContent();

        // No HRC seeding — all 3 voters are non-HRC.
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.warp(block.timestamp + EPOCH + 1);

        // No HRC commit -> cancel-lockout does not engage even at commit quorum 3.
        engine.cancelExpiredRound(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Cancelled));
        assertFalse(_roundHasHumanVerifiedCommit(engine, contentId, roundId));
    }

    function test_CancelExpired_AllSybilRevealQuorum_SettlementWins() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        RoundLib.Round memory startRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(startRound.startTime) + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, false, s2);
        _reveal(contentId, roundId, ck3, true, s3);

        vm.warp(block.timestamp + EPOCH + 1);
        vm.expectRevert(RoundVotingEngine.ThresholdReached.selector);
        engine.cancelExpiredRound(contentId, roundId);

        _settleRoundAfterRbtsSeed(contentId, roundId);
        RoundLib.Round memory settledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settledRound.state), uint256(RoundLib.RoundState.Settled));
        assertFalse(_roundHasHumanVerifiedCommit(engine, contentId, roundId));
    }

    function test_CancelExpired_OneHrcPlusSybilQuorum_Cancellable() public {
        uint256 contentId = _submitContent();

        // voter1 is HRC, voters 2/3 are not.
        mockRaterIdentityRegistry.setHolder(voter1);
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertTrue(_roundHasHumanVerifiedCommit(engine, contentId, roundId));
        assertEq(_roundHumanVerifiedCommitCount(engine, contentId, roundId), 1);

        vm.warp(block.timestamp + EPOCH + 1);

        engine.cancelExpiredRound(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Cancelled));
    }

    function test_CancelExpired_HrcCommitQuorum_LockoutStillEngages() public {
        uint256 contentId = _submitContent();

        mockRaterIdentityRegistry.setHolder(voter1);
        mockRaterIdentityRegistry.setHolder(voter2);
        mockRaterIdentityRegistry.setHolder(voter3);
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertTrue(_roundHasHumanVerifiedCommit(engine, contentId, roundId));
        assertEq(_roundHumanVerifiedCommitCount(engine, contentId, roundId), 3);

        vm.warp(block.timestamp + EPOCH + 1);

        vm.expectRevert(RoundVotingEngine.ThresholdReached.selector);
        engine.cancelExpiredRound(contentId, roundId);
    }

    function test_CancelExpired_HrcCommitQuorum_IsCommitTimeSnapshot() public {
        uint256 contentId = _submitContent();

        mockRaterIdentityRegistry.setHolder(voter1);
        mockRaterIdentityRegistry.setHolder(voter2);
        mockRaterIdentityRegistry.setHolder(voter3);
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        mockRaterIdentityRegistry.removeHolder(voter1);
        mockRaterIdentityRegistry.removeHolder(voter2);
        mockRaterIdentityRegistry.removeHolder(voter3);

        assertEq(_roundHumanVerifiedCommitCount(engine, contentId, roundId), 3);
        vm.warp(block.timestamp + EPOCH + 1);
        vm.expectRevert(RoundVotingEngine.ThresholdReached.selector);
        engine.cancelExpiredRound(contentId, roundId);

        uint256 nonHrcContentId = _submitContentWithUrl("https://example.com/hrc-later");
        _commit(voter4, nonHrcContentId, true, STAKE);
        _commit(voter5, nonHrcContentId, false, STAKE);
        _commit(voter6, nonHrcContentId, true, STAKE);
        uint256 nonHrcRoundId = RoundEngineReadHelpers.activeRoundId(engine, nonHrcContentId);

        mockRaterIdentityRegistry.setHolder(voter4);
        mockRaterIdentityRegistry.setHolder(voter5);
        mockRaterIdentityRegistry.setHolder(voter6);

        assertEq(_roundHumanVerifiedCommitCount(engine, nonHrcContentId, nonHrcRoundId), 0);
        RoundLib.Round memory nonHrcOpenRound = RoundEngineReadHelpers.round(engine, nonHrcContentId, nonHrcRoundId);
        vm.warp(nonHrcOpenRound.startTime + EPOCH + 1);
        engine.cancelExpiredRound(nonHrcContentId, nonHrcRoundId);
        RoundLib.Round memory nonHrcRound = RoundEngineReadHelpers.round(engine, nonHrcContentId, nonHrcRoundId);
        assertEq(uint256(nonHrcRound.state), uint256(RoundLib.RoundState.Cancelled));
    }

    function test_CancelExpired_RevertsIfRoundNotOpen() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        vm.expectRevert(RoundVotingEngine.RoundNotOpen.selector);
        engine.cancelExpiredRound(contentId, roundId);
    }

    // =========================================================================
    // 3. CANNOT COMMIT TWICE TO THE SAME ROUND
    // =========================================================================

    function test_CommitTwice_SameRound_Reverts() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);

        // voter1 tries to commit again within the same round (cooldown also applies)
        // The cooldown check fires first; warp past cooldown to isolate AlreadyCommitted
        // Actually: hasCommitted check fires before cooldown is re-checked on second call
        // In the contract: cooldown check fires FIRST (lastVoteTimestamp > 0 and within 24h)
        // So we need to check CooldownActive fires first
        vm.startPrank(voter1);
        bytes32 salt2 = keccak256(abi.encodePacked(voter1, block.timestamp + 1));
        bytes32 commitHash2 = _commitHash(true, salt2, contentId);
        bytes memory ciphertext2 = _testCiphertext(true, salt2, contentId);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext2 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.CooldownActive.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext2,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash2,
            ciphertext2,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_CommitTwice_AfterCooldown_ExpiredRoundRevertsRoundNotOpen() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past the 24h cooldown. In the single-duration model the round is closed,
        // so direct commits must fail before duplicate-commit checks are reachable.
        vm.warp(block.timestamp + 25 hours);

        vm.startPrank(voter1);
        bytes32 salt2 = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash2 = _commitHash(true, salt2, contentId);
        bytes memory ciphertext2 = _testCiphertext(true, salt2, contentId);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext3 = _roundContext(roundId, _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.RoundNotOpen.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext3,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash2,
            ciphertext2,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_CommitAfterDelegateAddressIdentityChurn_ExpiredRoundRevertsRoundNotOpen() public {
        uint256 contentId = _submitContent();
        vm.prank(voter1);
        mockRaterIdentityRegistry.setDelegate(delegate1);
        _commit(delegate1, contentId, true, STAKE);

        mockRaterIdentityRegistry.mint(voter1, 42);
        vm.warp(block.timestamp + 25 hours);

        _expectCommitVoteRevert(
            voter1,
            contentId,
            false,
            STAKE,
            "direct-after-delegate-identity-churn",
            RoundVotingEngine.RoundNotOpen.selector
        );
    }

    function test_DelegateCommitAfterHolderAddressIdentityChurn_ExpiredRoundRevertsRoundNotOpen() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);

        mockRaterIdentityRegistry.mint(voter1, 42);
        vm.prank(voter1);
        mockRaterIdentityRegistry.setDelegate(delegate1);
        vm.warp(block.timestamp + 25 hours);

        _expectCommitVoteRevert(
            delegate1,
            contentId,
            false,
            STAKE,
            "delegate-after-direct-identity-churn",
            RoundVotingEngine.RoundNotOpen.selector
        );
    }

    function test_CommitSameNullifierAfterRemint_ExpiredRoundRevertsRoundNotOpen() public {
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress).setRaterRegistry(address(mockRaterIdentityRegistry));

        mockRaterIdentityRegistry.mint(submitter, 9_001);
        mockRaterIdentityRegistry.mint(voter1, 42);

        uint256 contentId = _submitContent();
        (bytes32 originalCommitKey,) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        mockRaterIdentityRegistry.revokeHumanCredential(voter1);
        mockRaterIdentityRegistry.resetNullifier(42);
        mockRaterIdentityRegistry.mint(voter2, 42);

        vm.warp(block.timestamp + 25 hours);

        bytes32 salt2 = keccak256(abi.encodePacked(voter2, block.timestamp, "remint"));
        bytes32 commitHash2 = _commitHash(false, salt2, contentId);
        bytes memory ciphertext2 = _testCiphertext(false, salt2, contentId);

        vm.startPrank(voter2);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext4 = _roundContext(roundId, _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.RoundNotOpen.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext4,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash2,
            ciphertext2,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        assertEq(_identityCommitKey(engine, contentId, roundId, bytes32(uint256(42))), originalCommitKey);
    }

    function test_CommitSameNullifierAfterRemint_NewRoundRespectsCooldown() public {
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress).setRaterRegistry(address(mockRaterIdentityRegistry));

        mockRaterIdentityRegistry.mint(submitter, 9_001);
        mockRaterIdentityRegistry.mint(voter1, 42);
        mockRaterIdentityRegistry.mint(voter2, 43);
        mockRaterIdentityRegistry.mint(voter3, 44);

        uint256 contentId = _submitContent();
        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        mockRaterIdentityRegistry.revokeHumanCredential(voter1);
        mockRaterIdentityRegistry.resetNullifier(42);
        mockRaterIdentityRegistry.mint(voter4, 42);

        _openRoundForTest(engine, contentId, voter4);
        bytes32 salt2 = keccak256(abi.encodePacked(voter4, block.timestamp, "remint-cooldown"));
        bytes32 commitHash2 = _commitHash(false, salt2, contentId);
        bytes memory ciphertext2 = _testCiphertext(false, salt2, contentId);

        vm.startPrank(voter4);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext =
            _roundContext(_previewCommitRoundId(engine, contentId), registry.getRating(contentId));
        vm.expectRevert(RoundVotingEngine.CooldownActive.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext,
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
    // 4. CANNOT REVEAL BEFORE EPOCH ENDS (EpochNotEnded)
    // =========================================================================

    function test_Reveal_BeforeEpochEnd_Reverts() public {
        uint256 contentId = _submitContent();

        (bytes32 commitKey, bytes32 salt) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Do NOT warp — epoch has not ended yet
        vm.expectRevert(RoundVotingEngine.EpochNotEnded.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);
    }

    function test_Reveal_ExactlyAtEpochEnd_Succeeds() public {
        uint256 contentId = _submitContent();

        (bytes32 commitKey, bytes32 salt) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp to exactly one second after epoch end
        _warpPastTlockRevealTime(block.timestamp + EPOCH);

        // Should not revert
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.revealedCount, 1);
    }

    function test_Reveal_PostCommitIdentityBan_RevertsWithoutAccounting() public {
        uint256 contentId = _submitContent();

        (bytes32 commitKey, bytes32 salt) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        mockRaterIdentityRegistry.setBanned(mockRaterIdentityRegistry.addressIdentityKey(voter1), true);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);

        vm.expectRevert(VotePreflightLib.IdentityBanned.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.revealedCount, 0);
        (,,,, bool revealed,,) = engine.commitCore(contentId, roundId, commitKey);
        assertFalse(revealed);
        assertEq(_commitRbtsScoringWeight(engine, contentId, roundId, commitKey), 0);
        assertEq(_commitPredictedUpBps(engine, contentId, roundId, commitKey), 0);
    }

    function test_Reveal_PostCommitBanInCurrentRegistryAfterRotation_Reverts() public {
        uint256 contentId = _submitContent();

        (bytes32 commitKey, bytes32 salt) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        MockRaterIdentityRegistry replacementRegistry = new MockRaterIdentityRegistry();
        replacementRegistry.setBanned(replacementRegistry.addressIdentityKey(voter1), true);
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress).setRaterRegistry(address(replacementRegistry));

        _warpPastTlockRevealTime(block.timestamp + EPOCH);

        vm.expectRevert(VotePreflightLib.IdentityBanned.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.revealedCount, 0);
        (,,,, bool revealed,,) = engine.commitCore(contentId, roundId, commitKey);
        assertFalse(revealed);
        assertEq(_commitRbtsScoringWeight(engine, contentId, roundId, commitKey), 0);
        assertEq(_commitPredictedUpBps(engine, contentId, roundId, commitKey), 0);
    }

    // =========================================================================
    // 5. WRONG HASH ON REVEAL (HashMismatch)
    // =========================================================================

    function test_Reveal_WrongIsUp_HashMismatch() public {
        uint256 contentId = _submitContent();

        // Commit as isUp=true
        (bytes32 commitKey, bytes32 salt) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);

        // Reveal with isUp=false (wrong direction — hash won't match)
        vm.expectRevert(RoundVotingEngine.HashMismatch.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, false, 5_000, salt);
    }

    function test_Reveal_WrongSalt_HashMismatch() public {
        uint256 contentId = _submitContent();

        (bytes32 commitKey,) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);

        bytes32 wrongSalt = keccak256("wrong");
        vm.expectRevert(RoundVotingEngine.HashMismatch.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, wrongSalt);
    }

    function test_Reveal_TamperedCiphertext_HashMismatch() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes memory honestCiphertext = _testCiphertext(true, salt, contentId);
        bytes memory tamperedCiphertext = _testCiphertext(false, salt, contentId);
        bytes32 commitHash = _commitHash(true, salt, contentId, honestCiphertext);

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext5 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        engine.commitVote(
            contentId,
            cachedRoundContext5,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            tamperedCiphertext,
            STAKE,
            address(0)
        );

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32 commitKey = keccak256(abi.encodePacked(voter1, commitHash));

        _warpPastTlockRevealTime(block.timestamp + EPOCH);

        vm.expectRevert(RoundVotingEngine.HashMismatch.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);
    }

    function test_Reveal_BeforeCommittedDrandRound_Reverts() public {
        // Align epoch end to a drand boundary so +1 is still inside the accepted target window.
        vm.warp(T0 + 2);
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        uint64 targetRound = _tlockCommitTargetRound() + 1;
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, _tlockDrandChainHash());
        bytes32 commitHash = _commitHash(true, salt, voter1, contentId, targetRound, _tlockDrandChainHash(), ciphertext);

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext6 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        engine.commitVote(
            contentId,
            cachedRoundContext6,
            targetRound,
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32 commitKey = _commitKey(voter1, commitHash);
        (, uint64 storedTargetRound,, uint256 revealableAfter,,) =
            engine.commitRevealData(contentId, roundId, commitKey);
        uint256 targetRoundRevealableAt = _tlockRoundTimestamp(storedTargetRound);
        assertEq(
            revealableAfter > targetRoundRevealableAt ? revealableAfter : targetRoundRevealableAt,
            targetRoundRevealableAt
        );

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        vm.expectRevert(RoundVotingEngine.EpochNotEnded.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);

        vm.warp(_tlockRoundTimestamp(targetRound));
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);
    }

    function test_Reveal_UsesSnapshotDrandChainHashAfterConfigRotation() public {
        uint256 contentId = _submitContent();
        (bytes32 commitKey, bytes32 salt) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        (,, bytes32 commitChainHashBefore,,,) = engine.commitRevealData(contentId, roundId, commitKey);
        assertEq(commitChainHashBefore, _tlockDrandChainHash(), "commit reveal data exposes snapshot hash");

        bytes32 rotatedChainHash = bytes32(uint256(0xBEEF));
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress)
            .setDrandConfig(rotatedChainHash, DEFAULT_DRAND_GENESIS_TIME, DEFAULT_DRAND_PERIOD);

        (,, bytes32 commitChainHashAfter,,,) = engine.commitRevealData(contentId, roundId, commitKey);
        assertEq(
            commitChainHashAfter, _tlockDrandChainHash(), "live config rotation must not rewrite commit hash input"
        );

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);
    }

    function test_CommitRevealData_NonExistentCommit_ReturnsEmptyMetadata() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32 missingCommitKey = keccak256("missing-commit");

        (
            bytes32 ciphertextHash,
            uint64 targetRound,
            bytes32 drandChainHash,
            uint48 revealableAfter,
            bool revealed,
            uint64 stakeAmount
        ) = engine.commitRevealData(contentId, roundId, missingCommitKey);

        assertEq(ciphertextHash, bytes32(0));
        assertEq(targetRound, 0);
        assertEq(drandChainHash, bytes32(0));
        assertEq(revealableAfter, 0);
        assertFalse(revealed);
        assertEq(stakeAmount, 0);
    }

    function test_Reveal_RejectsCommitHashBuiltWithRotatedLiveDrandHash() public {
        uint256 contentId = _submitContent();
        bytes32 snapshotChainHash = _tlockDrandChainHash();
        bytes32 rotatedChainHash = bytes32(uint256(0xBEEF));
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "rotated-live-hash"));
        uint64 targetRound = _tlockCommitTargetRound(engine, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, snapshotChainHash);
        bytes32 commitHash = _commitHash(true, salt, voter1, contentId, targetRound, rotatedChainHash, ciphertext);

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 roundContext = _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        engine.commitVote(
            contentId, roundContext, targetRound, snapshotChainHash, commitHash, ciphertext, STAKE, address(0)
        );

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32 commitKey = _commitKey(voter1, commitHash);
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress)
            .setDrandConfig(rotatedChainHash, DEFAULT_DRAND_GENESIS_TIME, DEFAULT_DRAND_PERIOD);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        vm.expectRevert(RoundVotingEngine.HashMismatch.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);
    }

    function test_Reveal_NonExistentCommitKey_Reverts() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);

        bytes32 badKey = keccak256("bogus");
        vm.expectRevert(RoundVotingEngine.TargetRoundOutOfWindow.selector);
        engine.revealVoteByCommitKey(contentId, roundId, badKey, true, 5_000, bytes32(0));
    }

    function test_Reveal_AlreadyRevealed_Reverts() public {
        uint256 contentId = _submitContent();

        (bytes32 commitKey, bytes32 salt) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, commitKey, true, salt);

        // Try to reveal again
        vm.expectRevert(RoundVotingEngine.AlreadyRevealed.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);
    }

    // =========================================================================
    // 6. IMMEDIATE SETTLEMENT AFTER THRESHOLD
    // =========================================================================

    function test_Settle_ImmediatelyAfterThreshold_Succeeds() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past epoch and reveal all
        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);

        // Settlement succeeds once the RBTS snapshot is available.
        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
    }

    function test_Settle_AfterDelay_Succeeds() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);

        // Settlement succeeds once the RBTS snapshot is available.
        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
    }

    function test_Settle_NotEnoughVoters_Reverts() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, STAKE);
        // Only 2 voters, minVoters=3

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, false, s2);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);

        vm.roll(block.number + 1);
        vm.expectRevert(RoundVotingEngine.NotEnoughVotes.selector);
        engine.settleRound(contentId, roundId);
    }

    function test_Settle_RoundNotOpen_Reverts() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        // Try to settle again
        vm.expectRevert(RoundVotingEngine.RoundNotOpen.selector);
        _settleRoundAfterRbtsSeed(contentId, roundId);
    }

    // =========================================================================
    // 7. TIED ROUND (equal full-stake pools)
    // =========================================================================

    function test_TiedRound_EqualPools_StateIsTied() public {
        uint256 contentId = _submitContent();

        // 1 UP, 1 DOWN with same stake -> equal weighted pools
        // We need at least 3 voters for minVoters. Use 2 UP + 2 DOWN but same stake.
        // To get tied: 2 UP voters at STAKE + 1 DOWN voter at 2*STAKE, or simply 1 UP + 1 DOWN
        // with minVoters=3 we need at least 3 reveals. Let's do 2 UP + 2 DOWN for a tie with equal stakes.
        // But minVoters=3 so we need 3 reveals.
        // Tie: 1.5 UP vs 1.5 DOWN effectively -- let's do STAKE on each side * matching counts.
        // Simplest: voter1 UP STAKE, voter2 DOWN STAKE, voter3 UP STAKE... that's 2 UP 1 DOWN no tie.
        // For a tie with 3 voters: voter1 UP 2*STAKE, voter2 DOWN 2*STAKE + voter3 UP 2*STAKE... no.
        // Tie means weightedUpPool == weightedDownPool. All accepted votes use full stake.
        // We need sum(UP stakes) == sum(DOWN stakes).
        // 3 voters: voter1 UP 2e6, voter2 DOWN 3e6, voter3 UP 1e6 -> up=3e6, down=3e6 -> TIE.
        uint256 s1 = 2e6;
        uint256 s2 = 3e6;
        uint256 s3 = 1e6;

        (bytes32 ck1, bytes32 salt1) = _commit(voter1, contentId, true, s1);
        (bytes32 ck2, bytes32 salt2) = _commit(voter2, contentId, false, s2);
        (bytes32 ck3, bytes32 salt3) = _commit(voter3, contentId, true, s3);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, salt1);
        _reveal(contentId, roundId, ck2, false, salt2);
        _reveal(contentId, roundId, ck3, true, salt3);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Tied));
    }

    function test_TiedRound_EvenStake_ThreeVoters() public {
        uint256 contentId = _submitContent();

        // voter1 UP 2*STAKE, voter2 DOWN STAKE, voter3 DOWN STAKE -> up pool = 2*STAKE, down pool = 2*STAKE => TIE
        uint256 upStake = 2 * STAKE;
        uint256 downStake = STAKE;

        (bytes32 ck1, bytes32 salt1) = _commit(voter1, contentId, true, upStake);
        (bytes32 ck2, bytes32 salt2) = _commit(voter2, contentId, false, downStake);
        (bytes32 ck3, bytes32 salt3) = _commit(voter3, contentId, false, downStake);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, salt1);
        _reveal(contentId, roundId, ck2, false, salt2);
        _reveal(contentId, roundId, ck3, false, salt3);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Tied));
    }

    // =========================================================================
    // 8. CANCELLED ROUND REFUND
    // =========================================================================

    function test_CancelledRefund_ClaimSucceeds() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.warp(block.timestamp + EPOCH + 1);
        engine.cancelExpiredRound(contentId, roundId);

        uint256 balBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        engine.claimCancelledRoundRefund(contentId, roundId);
        uint256 balAfter = lrepToken.balanceOf(voter1);

        assertEq(balAfter - balBefore, STAKE);
    }

    function test_CancelledRefund_CannotClaimTwice() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.warp(block.timestamp + EPOCH + 1);
        engine.cancelExpiredRound(contentId, roundId);

        vm.prank(voter1);
        engine.claimCancelledRoundRefund(contentId, roundId);

        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.AlreadyClaimed.selector);
        engine.claimCancelledRoundRefund(contentId, roundId);
    }

    function test_CancelledRefund_NonParticipantReverts() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.warp(block.timestamp + EPOCH + 1);
        engine.cancelExpiredRound(contentId, roundId);

        vm.prank(voter3);
        vm.expectRevert(RoundVotingEngine.NoCommit.selector);
        engine.claimCancelledRoundRefund(contentId, roundId);
    }

    function test_CancelledRefund_RequiresCancelledOrTiedState() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Round is still Open — should revert
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.RoundNotCancelledOrTied.selector);
        engine.claimCancelledRoundRefund(contentId, roundId);
    }

    function test_TiedRefund_ClaimSucceeds() public {
        uint256 contentId = _submitContent();

        // 2 UP 2 DOWN same stake -> tie (4 voters, all equal weight)
        uint256 up = STAKE;
        uint256 dn = STAKE;
        _commit(voter1, contentId, true, up);
        _commit(voter2, contentId, false, dn);
        // Use a different stake to force a 3-voter tie: up=STAKE, down=STAKE via voter2, voter3
        // Actually equal total: voter1 UP STAKE, voter2 DOWN STAKE is a 2-voter situation.
        // We need 3. Use voter1 UP 2*STAKE, voter2 DOWN STAKE, voter3 DOWN STAKE.
        _commit(voter3, contentId, true, up);
        // up = 2*STAKE, down = STAKE -> NOT tied. Redo.

        // Reset contentId for a fresh tied scenario
        // voter4 is our 3rd voter for this content
        // Already committed 3 (voter1, voter2, voter3) above with 2UP 1DOWN -> not tied
        // Let's use a second content for clarity
        uint256 cid2 = _submitContentWithUrl("https://example.com/tied");

        uint256 tieStake = 2e6;
        _commit(voter4, cid2, true, tieStake);
        _commit(voter5, cid2, false, tieStake);
        _commit(voter6, cid2, true, tieStake);
        // up = 2*tieStake, down = tieStake -> NOT tied

        // Use content 3 with truly equal pools
        uint256 cid3 = _submitContentWithUrl("https://example.com/tied2");
        uint256 stakeUp = 2e6;
        uint256 stakeDown = 3e6;
        uint256 stakeUp2 = 1e6;

        (bytes32 xck1, bytes32 xs1) = _commit(voter1, cid3, true, stakeUp);
        (bytes32 xck2, bytes32 xs2) = _commit(voter2, cid3, false, stakeDown);
        (bytes32 xck3, bytes32 xs3) = _commit(voter3, cid3, true, stakeUp2);

        uint256 xRoundId = RoundEngineReadHelpers.activeRoundId(engine, cid3);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(cid3, xRoundId, xck1, true, xs1);
        _reveal(cid3, xRoundId, xck2, false, xs2);
        _reveal(cid3, xRoundId, xck3, true, xs3);

        _settleRoundAfterRbtsSeed(cid3, xRoundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid3, xRoundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Tied));

        // voter1 claims refund from tied round
        uint256 balBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        engine.claimCancelledRoundRefund(cid3, xRoundId);
        uint256 balAfter = lrepToken.balanceOf(voter1);

        assertEq(balAfter - balBefore, stakeUp);
    }

    // =========================================================================
    // 9. FRONTEND FEE CLAIMING
    // =========================================================================

    function test_FrontendFee_EligibleFrontend_FeeAccumulated() public {
        _registerFrontend(frontend1);
        (uint256 contentId, uint256 roundId,) = _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), frontend1);

        _settleRoundAfterRbtsSeed(contentId, roundId);
        uint256 feesBefore = frontendRegistry.getAccumulatedFees(frontend1);
        vm.prank(frontend1);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);
        uint256 feesAfter = frontendRegistry.getAccumulatedFees(frontend1);

        assertGt(feesAfter - feesBefore, 0);
    }

    function test_FrontendFee_ClaimSucceeds() public {
        _registerFrontend(frontend1);
        (uint256 contentId, uint256 roundId,) = _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), frontend1);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        uint256 feesBefore = frontendRegistry.getAccumulatedFees(frontend1);
        vm.prank(frontend1);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);
        uint256 feesAfter = frontendRegistry.getAccumulatedFees(frontend1);

        assertGt(feesAfter - feesBefore, 0);
    }

    function test_FrontendFee_CannotClaimTwice() public {
        _registerFrontend(frontend1);
        (uint256 contentId, uint256 roundId,) = _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), frontend1);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        vm.prank(frontend1);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);

        vm.expectRevert(RoundVotingEngine.AlreadyClaimed.selector);
        vm.prank(frontend1);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);
    }

    function test_FrontendFee_IneligibleFrontend_NotTracked() public {
        // Register, then start exit so the frontend is ineligible at commit time
        vm.startPrank(frontend1);
        lrepToken.approve(address(frontendRegistry), 1000e6);
        frontendRegistry.register();
        frontendRegistry.requestDeregister();
        vm.stopPrank();

        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commitWithFrontend(voter1, contentId, true, STAKE, frontend1);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        vm.expectRevert(RoundRewardDistributor.NoPool.selector);
        vm.prank(frontend1);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);
    }

    function test_FrontendFee_ClaimReverts_RoundNotSettled() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.expectRevert(RoundRewardDistributor.RoundNotSettled.selector);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);
    }

    function test_FrontendFee_ClaimReverts_NoPool() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        // No frontend pool (no eligible frontends were used)
        vm.expectRevert(RoundRewardDistributor.NoPool.selector);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);
    }

    // =========================================================================
    // 10. processUnrevealedVotes
    // =========================================================================

    function test_ProcessUnrevealed_SettledRoundAddsExpiredUnrevealedVotesToReserve() public {
        _registerFrontend(frontend1);
        uint256 contentId = _submitContent();

        // voter1 commits but never reveals. After per-commit reveal grace, the honest revealed
        // quorum settles and voter1's stake is cleaned into the reserve.
        _commit(voter1, contentId, true, STAKE);

        address[8] memory voters = [voter2, voter3, voter4, voter5, voter6, voter7, voter8, delegate1];
        bool[8] memory directions = [true, false, true, true, true, false, true, false];
        bytes32[8] memory commitKeys;
        bytes32[8] memory salts;
        uint16[8] memory predictions;
        for (uint256 i = 0; i < voters.length; i++) {
            predictions[i] = _predictionBps(i, directions[i]);
            if (i == 0) {
                (commitKeys[i], salts[i]) = _commitPredictionWithFrontend(
                    voters[i], contentId, directions[i], predictions[i], STAKE, frontend1
                );
            } else {
                (commitKeys[i], salts[i]) =
                    _commitPrediction(voters[i], contentId, directions[i], predictions[i], STAKE);
            }
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 revealGracePeriod = ProtocolConfig(protocolConfigAddress).revealGracePeriod();

        RoundLib.Round memory openRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(openRound.startTime) + EPOCH);
        for (uint256 i = 0; i < voters.length; i++) {
            _revealPrediction(contentId, roundId, commitKeys[i], directions[i], predictions[i], salts[i]);
        }
        vm.warp(block.timestamp + revealGracePeriod + 1);

        _captureRbtsSeedForCleanup(engine, contentId, roundId);
        RoundLib.Round memory settledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settledRound.state), uint256(RoundLib.RoundState.SettlementPending));
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 1);

        vm.expectRevert("Round not settled");
        vm.prank(voter2);
        rewardDistributor.claimReward(contentId, roundId);

        vm.expectRevert(RoundRewardDistributor.RoundNotSettled.selector);
        vm.prank(frontend1);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);

        uint256 treasuryBefore = lrepToken.balanceOf(treasury);
        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);
        uint256 treasuryAfter = lrepToken.balanceOf(treasury);
        uint256 keeperAfter = lrepToken.balanceOf(keeper);

        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 0);
        assertEq(keeperAfter - keeperBefore, STAKE / 100, "cleanup caller receives 1% incentive");
        assertEq(
            treasuryAfter - treasuryBefore,
            STAKE - (STAKE / 100),
            "settled unrevealed stake less incentive routes to treasury"
        );

        _rollPastRbtsSeedBlock(block.number + 1);
        _applyIdentityRbtsSettlementSnapshot(engine, contentId, roundId, settledRound.revealedCount);

        uint256 feesBefore = frontendRegistry.getAccumulatedFees(frontend1);
        vm.prank(frontend1);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);
        assertGt(frontendRegistry.getAccumulatedFees(frontend1), feesBefore);
    }

    function test_FlushPendingTreasuryForfeit_RetriesRetainedCleanupForfeit() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);
        (bytes32 ck4, bytes32 s4) = _commit(voter4, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 revealGracePeriod = ProtocolConfig(protocolConfigAddress).revealGracePeriod();
        vm.warp(_lastCommitRevealableAfter(engine, contentId, roundId) + revealGracePeriod + 1);

        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);
        _reveal(contentId, roundId, ck4, true, s4);
        _captureRbtsSeedForCleanup(engine, contentId, roundId);

        uint256 incentive = STAKE / 100;
        uint256 retainedForfeit = STAKE - incentive;
        uint256 unlockAt = block.timestamp + 2 days;
        LockingLoopGovernor lockingGovernor = new LockingLoopGovernor(lrepToken);
        vm.prank(owner);
        lrepToken.setGovernor(address(lockingGovernor));
        lockingGovernor.lock(address(engine), lrepToken.balanceOf(address(engine)) - incentive, unlockAt);

        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        uint256 treasuryBefore = lrepToken.balanceOf(treasury);
        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);

        assertEq(lrepToken.balanceOf(keeper) - keeperBefore, incentive, "keeper incentive still pays");
        assertEq(lrepToken.balanceOf(treasury), treasuryBefore, "treasury transfer is retained while locked");
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 0, "cleanup queue clears");

        vm.warp(unlockAt + 1);
        engine.flushPendingTreasuryForfeit();
        assertEq(lrepToken.balanceOf(treasury) - treasuryBefore, retainedForfeit, "retained forfeit flushes later");

        vm.expectRevert(RoundVotingEngine.NothingProcessed.selector);
        engine.flushPendingTreasuryForfeit();
    }

    function test_ProcessUnrevealed_SettledRoundProcessesExpiredVotesInBatches() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, STAKE);
        (bytes32 ck4, bytes32 s4) = _commit(voter4, contentId, true, STAKE);
        (bytes32 ck5, bytes32 s5) = _commit(voter5, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 revealGracePeriod = ProtocolConfig(protocolConfigAddress).revealGracePeriod();
        vm.warp(_lastCommitRevealableAfter(engine, contentId, roundId) + revealGracePeriod + 1);
        _reveal(contentId, roundId, ck3, true, s3);
        _reveal(contentId, roundId, ck4, true, s4);
        _reveal(contentId, roundId, ck5, false, s5);

        _captureRbtsSeedForCleanup(engine, contentId, roundId);
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 2);

        uint256 treasuryBefore = lrepToken.balanceOf(treasury);
        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 1);
        assertEq(lrepToken.balanceOf(treasury) - treasuryBefore, STAKE - (STAKE / 100));
        assertEq(lrepToken.balanceOf(keeper) - keeperBefore, STAKE / 100);
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 1);

        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 1, 1);
        assertEq(lrepToken.balanceOf(treasury) - treasuryBefore, STAKE * 2 - ((STAKE * 2) / 100));
        assertEq(lrepToken.balanceOf(keeper) - keeperBefore, (STAKE * 2) / 100);
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 0);
    }

    function test_ProcessUnrevealed_ForfeitsUnrevealedVotesAfterSharedDuration() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);
        _commit(voter4, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // In the single-duration model every accepted vote's reveal window has ended
        // by the time settlement can happen.
        RoundLib.Round memory rPU2start = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rPU2start.startTime) + EPOCH);
        vm.warp(
            _lastCommitRevealableAfter(engine, contentId, roundId)
                + ProtocolConfig(protocolConfigAddress).revealGracePeriod() + 1
        );
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);

        _captureRbtsSeedForCleanup(engine, contentId, roundId);

        uint256 voter4BalBefore = lrepToken.balanceOf(voter4);
        uint256 treasuryBefore = lrepToken.balanceOf(treasury);
        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);

        assertEq(lrepToken.balanceOf(voter4), voter4BalBefore, "voter4 forfeits past-epoch stake");
        assertEq(lrepToken.balanceOf(treasury) - treasuryBefore, STAKE - (STAKE / 100), "treasury receives forfeit");
        assertEq(lrepToken.balanceOf(keeper) - keeperBefore, STAKE / 100, "keeper receives cleanup incentive");
    }

    function test_ProcessUnrevealed_SharedDurationCleanupPaysKeeperBounty() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);
        _commit(voter4, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        RoundLib.Round memory rStart = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rStart.startTime) + EPOCH);
        vm.warp(
            _lastCommitRevealableAfter(engine, contentId, roundId)
                + ProtocolConfig(protocolConfigAddress).revealGracePeriod() + 1
        );
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);
        _captureRbtsSeedForCleanup(engine, contentId, roundId);

        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        uint256 voter4Before = lrepToken.balanceOf(voter4);
        uint256 treasuryBefore = lrepToken.balanceOf(treasury);

        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);

        assertEq(lrepToken.balanceOf(voter4), voter4Before, "voter4 forfeits");
        assertEq(lrepToken.balanceOf(keeper) - keeperBefore, STAKE / 100, "keeper paid for forfeit cleanup");
        assertEq(lrepToken.balanceOf(treasury) - treasuryBefore, STAKE - (STAKE / 100), "treasury receives forfeit");
    }

    function test_ProcessUnrevealed_SettledCleanupPaysIncentiveOncePerForfeiture() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, STAKE);
        (bytes32 ck4, bytes32 s4) = _commit(voter4, contentId, true, STAKE);
        (bytes32 ck5, bytes32 s5) = _commit(voter5, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 revealGracePeriod = ProtocolConfig(protocolConfigAddress).revealGracePeriod();
        vm.warp(_lastCommitRevealableAfter(engine, contentId, roundId) + revealGracePeriod + 1);
        _reveal(contentId, roundId, ck3, true, s3);
        _reveal(contentId, roundId, ck4, true, s4);
        _reveal(contentId, roundId, ck5, false, s5);

        _captureRbtsSeedForCleanup(engine, contentId, roundId);

        uint256 keeperBalBefore = lrepToken.balanceOf(keeper);

        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 1);
        uint256 afterFirstBatch = lrepToken.balanceOf(keeper);

        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 1, 1);
        uint256 afterSecondBatch = lrepToken.balanceOf(keeper);

        assertEq(afterFirstBatch - keeperBalBefore, STAKE / 100, "first forfeiture pays incentive");
        assertEq(afterSecondBatch - keeperBalBefore, (STAKE * 2) / 100, "second forfeiture pays incentive once");
    }

    function test_ProcessUnrevealed_CleanupIncentiveCapAppliesAcrossBatches() public {
        uint256 contentId = _submitContent();
        uint256 highStake = 10e6;

        address[] memory unrevealedVoters = new address[](60);
        for (uint256 i = 0; i < unrevealedVoters.length; ++i) {
            unrevealedVoters[i] = address(uint160(1_000 + i));
            mockRaterIdentityRegistry.setHolder(unrevealedVoters[i]);
            vm.prank(owner);
            lrepToken.mint(unrevealedVoters[i], highStake);
            _commit(unrevealedVoters[i], contentId, true, highStake);
        }

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 revealGracePeriod = ProtocolConfig(protocolConfigAddress).revealGracePeriod();
        vm.warp(_lastCommitRevealableAfter(engine, contentId, roundId) + revealGracePeriod + 1);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);
        _captureRbtsSeedForCleanup(engine, contentId, roundId);

        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        uint256 treasuryBefore = lrepToken.balanceOf(treasury);
        for (uint256 i = 0; i < unrevealedVoters.length; ++i) {
            vm.prank(keeper);
            engine.processUnrevealedVotes(contentId, roundId, i, 1);
        }

        assertEq(lrepToken.balanceOf(keeper) - keeperBefore, 5e6, "round cleanup incentive is capped");
        assertEq(
            lrepToken.balanceOf(treasury) - treasuryBefore,
            highStake * unrevealedVoters.length - 5e6,
            "remaining stake routes to treasury"
        );
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 0, "cleanup queue clears");
    }

    function test_ProcessUnrevealed_RevertsIfRoundOpen() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.expectRevert(RoundVotingEngine.RoundNotSettledOrTied.selector);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);
    }

    function test_ProcessUnrevealed_AllRevealed_Reverts() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        // All votes revealed — NothingProcessed revert prevents no-op keeper reward drain
        vm.expectRevert(RoundVotingEngine.NothingProcessed.selector);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);
    }

    function test_ProcessUnrevealed_IndexOutOfBounds_Reverts() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        // startIndex > commitKeys.length
        vm.expectRevert(RoundVotingEngine.IndexOutOfBounds.selector);
        engine.processUnrevealedVotes(contentId, roundId, 999, 1);
    }

    function test_ProcessUnrevealed_TiedRound_RefundsUnrevealedStake() public {
        // Set up a tied round with an unrevealed vote from the single shared epoch.
        uint256 contentId = _submitContent();

        // 3-voter tie: up=2e6, down=3e6, up=1e6
        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, 2e6);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, 3e6);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, 1e6);
        _commit(voter4, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past the single shared duration before revealing.
        RoundLib.Round memory rTied = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rTied.startTime) + EPOCH);
        vm.warp(
            _lastCommitRevealableAfter(engine, contentId, roundId)
                + ProtocolConfig(protocolConfigAddress).revealGracePeriod() + 1
        );
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, false, s2);
        _reveal(contentId, roundId, ck3, true, s3);
        // voter4's vote is NOT revealed

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Tied));

        uint256 voter4Before = lrepToken.balanceOf(voter4);
        uint256 treasuryBefore = lrepToken.balanceOf(treasury);
        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);

        assertEq(lrepToken.balanceOf(voter4) - voter4Before, STAKE, "tied-round unrevealed stake refunds");
        assertEq(lrepToken.balanceOf(treasury), treasuryBefore, "tied-round cleanup does not forfeit");
        assertEq(lrepToken.balanceOf(keeper), keeperBefore, "tied-round refund pays no cleanup incentive");
    }

    function test_FinalizeRevealFailedRound_SucceedsAfterFinalRevealGrace() public {
        uint256 contentId = _submitContent();

        mockRaterIdentityRegistry.setHolder(voter1);
        mockRaterIdentityRegistry.setHolder(voter2);
        mockRaterIdentityRegistry.setHolder(voter3);
        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        uint256 gracePeriod = ProtocolConfig(protocolConfigAddress).revealGracePeriod();
        // Reveal-failed finalization waits out the extended (24x) recovery grace.
        uint256 baseDeadline = round.startTime + EPOCH + gracePeriod;
        uint256 finalDeadline = _revealFailedFinalDeadline(contentId, roundId);

        vm.warp(baseDeadline);
        vm.expectRevert(RoundVotingEngine.RevealGraceActive.selector);
        engine.finalizeRevealFailedRound(contentId, roundId);

        vm.warp(finalDeadline - 1);
        vm.expectRevert(RoundVotingEngine.RevealGraceActive.selector);
        engine.finalizeRevealFailedRound(contentId, roundId);

        vm.warp(finalDeadline);
        engine.finalizeRevealFailedRound(contentId, roundId);
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 3, "reveal-failed cleanup is queued");

        RoundLib.Round memory failedRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(failedRound.state), uint256(RoundLib.RoundState.RevealFailed));

        uint256 voter1BalBefore = lrepToken.balanceOf(voter1);
        vm.expectRevert(RoundVotingEngine.RoundNotOpen.selector);
        _reveal(contentId, roundId, ck1, true, s1);

        vm.expectRevert(RoundVotingEngine.VoteNotRevealed.selector);
        vm.prank(voter1);
        engine.claimCancelledRoundRefund(contentId, roundId);
        assertEq(lrepToken.balanceOf(voter1), voter1BalBefore, "late reveals are not accepted after reveal failure");
    }

    /// @notice A reveal outage that outlasts the ordinary grace period must stay recoverable:
    ///         reveals keep landing inside the extended reveal-failed grace window and the
    ///         round settles normally once quorum is reached (design review 2026-06, finding 3).
    function test_RevealFailedGrace_RoundRecoversWithLateRevealsAndSettles() public {
        uint256 contentId = _submitContent();

        mockRaterIdentityRegistry.setHolder(voter1);
        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);

        // Simulate a systemic reveal outage that outlasts the ordinary grace period.
        vm.warp(round.startTime + EPOCH + ProtocolConfig(protocolConfigAddress).revealGracePeriod() + 1);

        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, false, s2);
        _reveal(contentId, roundId, ck3, true, s3);

        _settleRoundAfterRbtsSeed(contentId, roundId);
        RoundLib.Round memory settledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settledRound.state), uint256(RoundLib.RoundState.Settled), "recovered round settles normally");
    }

    function test_RevealAfterFinalRevealFailedDeadline_RevertsBeforeQuorum() public {
        uint256 contentId = _submitContent();

        mockRaterIdentityRegistry.setHolder(voter1);
        mockRaterIdentityRegistry.setHolder(voter2);
        mockRaterIdentityRegistry.setHolder(voter3);
        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 finalDeadline = _revealFailedFinalDeadline(contentId, roundId);

        vm.warp(finalDeadline - 1);
        _reveal(contentId, roundId, ck1, true, s1);

        vm.warp(finalDeadline);
        vm.expectRevert(RoundVotingEngine.UnrevealedPastEpochVotes.selector);
        _reveal(contentId, roundId, ck2, false, s2);

        engine.finalizeRevealFailedRound(contentId, roundId);
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 2, "two unrevealed votes queued");

        RoundLib.Round memory failedRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(failedRound.state), uint256(RoundLib.RoundState.RevealFailed));
    }

    function test_RoundCreationRejectsSnapshotBelowRbtsParticipantFloor() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, false, s2);
        _reveal(contentId, roundId, ck3, true, s3);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.RoundConfig memory lowered = registry.getContentRoundConfig(contentId);
        lowered.minVoters = 2;
        _forceContentRoundConfig(contentId, lowered);
        assertEq(registry.getContentRoundConfig(contentId).minVoters, 2);

        vm.expectRevert(RoundCreationLib.InvalidRoundConfigSnapshot.selector);
        engine.openRound(contentId);
    }

    function test_FinalizeRevealFailed_AllSybilQuorum_StaysCancellable() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        uint256 finalDeadline = round.startTime + EPOCH + ProtocolConfig(protocolConfigAddress).revealGracePeriod();

        vm.warp(finalDeadline);
        vm.expectRevert(RoundVotingEngine.RevealGraceActive.selector);
        engine.finalizeRevealFailedRound(contentId, roundId);

        engine.cancelExpiredRound(contentId, roundId);
        RoundLib.Round memory cancelledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(cancelledRound.state), uint256(RoundLib.RoundState.Cancelled));
        assertFalse(_roundHasHumanVerifiedCommit(engine, contentId, roundId));
    }

    function test_RevealFailed_RefundsRevealedAndUnrevealed() public {
        uint256 contentId = _submitContent();

        mockRaterIdentityRegistry.setHolder(voter1);
        mockRaterIdentityRegistry.setHolder(voter2);
        mockRaterIdentityRegistry.setHolder(voter3);
        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);

        uint256 finalDeadline = _revealFailedFinalDeadline(contentId, roundId) + 1;
        vm.warp(finalDeadline);
        engine.finalizeRevealFailedRound(contentId, roundId);

        uint256 voter1BalBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        engine.claimCancelledRoundRefund(contentId, roundId);
        assertEq(lrepToken.balanceOf(voter1) - voter1BalBefore, STAKE, "revealed voters recover stake");

        // Unrevealed voters cannot pull-claim; their refund arrives via the
        // permissionless cleanup sweep below.
        vm.expectRevert(RoundVotingEngine.VoteNotRevealed.selector);
        vm.prank(voter2);
        engine.claimCancelledRoundRefund(contentId, roundId);

        uint256 treasuryBefore = lrepToken.balanceOf(treasury);
        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        uint256 voter2Before = lrepToken.balanceOf(voter2);
        uint256 voter3Before = lrepToken.balanceOf(voter3);
        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);
        assertEq(_roundUnrevealedCleanupRemaining(engine, contentId, roundId), 0, "cleanup queue clears");
        assertEq(
            lrepToken.balanceOf(voter2) - voter2Before, STAKE, "unrevealed stake refunds on systemic reveal failure"
        );
        assertEq(
            lrepToken.balanceOf(voter3) - voter3Before, STAKE, "unrevealed stake refunds on systemic reveal failure"
        );
        assertEq(lrepToken.balanceOf(treasury), treasuryBefore, "nothing forfeits to treasury");
        assertEq(lrepToken.balanceOf(keeper), keeperBefore, "no forfeit means no cleanup incentive");
    }

    function test_CommitAfterRevealFailedGrace_StartsNewRound() public {
        uint256 contentId = _submitContent();

        mockRaterIdentityRegistry.setHolder(voter1);
        mockRaterIdentityRegistry.setHolder(voter2);
        mockRaterIdentityRegistry.setHolder(voter3);

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        // The extended (24x) reveal-failed recovery grace must elapse first.
        vm.warp(_revealFailedFinalDeadline(contentId, roundId) + 1);

        _commit(voter4, contentId, true, STAKE);

        RoundLib.Round memory failedRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        uint256 newRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(uint256(failedRound.state), uint256(RoundLib.RoundState.RevealFailed));
        assertEq(newRoundId, roundId + 1, "new commits roll into a fresh round after reveal failure");
    }

    function test_RoundRollsAfterSharedDurationCancelsSybilQuorum() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);

        vm.warp(round.startTime + EPOCH + ProtocolConfig(protocolConfigAddress).revealGracePeriod() + 1);

        _commit(voter4, contentId, true, STAKE);

        uint256 activeRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory failedRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        RoundLib.Round memory nextRound = RoundEngineReadHelpers.round(engine, contentId, activeRoundId);
        assertEq(activeRoundId, roundId + 1, "new commit opens a fresh round after shared duration closes");
        assertEq(uint256(failedRound.state), uint256(RoundLib.RoundState.Cancelled), "all-sybil round is cancelled");
        assertEq(nextRound.voteCount, 1, "late vote joins the fresh round");
    }

    // =========================================================================
    // ADDITIONAL BRANCH COVERAGE
    // =========================================================================

    function test_Commit_ZeroStakeRejected() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.prank(voter1);
        lrepToken.approve(address(engine), 0);
        uint256 cachedRoundContext7 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.InvalidStake.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext7,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            0,
            address(0)
        );
    }

    function test_AdvisoryVoteRequiresExistingStakedRoundWithoutVoteStakeAccounting() public {
        uint256 contentId = _submitContent();
        _expectAdvisoryRevert(voter1, contentId, "advisory-no-staked-round", RoundVotingEngine.RoundNotOpen.selector);
        AdvisoryVoteRecorder.AdvisoryCommitAvailability memory noStakedAvailability =
            advisoryRecorder.advisoryCommitAvailability(contentId);
        assertFalse(noStakedAvailability.canCommit, "fresh content is not advisory-voteable");
        assertEq(
            uint256(noStakedAvailability.status),
            uint256(AdvisoryVoteRecorder.AdvisoryCommitAvailabilityStatus.NoStakedRound),
            "fresh content reports missing staked round"
        );
        assertEq(noStakedAvailability.roundId, 1, "fresh content exposes its creation-time round");

        uint64 targetRound = _openStakedRound(voter2, contentId, "advisory-staked-open");
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(engine, contentId);
        uint256 roundContext = _roundContext(roundId, referenceRatingBps);
        RoundLib.Round memory previewedRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        AdvisoryVoteRecorder.AdvisoryCommitAvailability memory availability =
            advisoryRecorder.advisoryCommitAvailability(contentId);
        assertTrue(availability.canCommit, "staked blind round is advisory-voteable");
        assertEq(
            uint256(availability.status),
            uint256(AdvisoryVoteRecorder.AdvisoryCommitAvailabilityStatus.Available),
            "staked blind round reports available"
        );
        assertEq(availability.roundId, roundId, "availability round matches active round");
        assertEq(availability.roundReferenceRatingBps, referenceRatingBps, "availability reference rating matches");
        assertEq(
            availability.epochEnd, uint256(previewedRound.startTime) + EPOCH, "availability anchors to first epoch end"
        );
        assertEq(availability.drandChainHash, _tlockDrandChainHash(), "availability exposes drand chain hash");
        assertEq(availability.drandGenesisTime, _tlockDrandGenesisTime(), "availability exposes drand genesis");
        assertEq(availability.drandPeriod, _tlockDrandPeriod(), "availability exposes drand period");
        assertEq(
            availability.minTargetRound,
            _tlockTargetRoundAt(availability.epochEnd),
            "availability exposes min target round"
        );
        assertEq(
            availability.maxTargetRound,
            _roundAt(
                availability.epochEnd + 2 * uint256(_tlockDrandPeriod()), _tlockDrandGenesisTime(), _tlockDrandPeriod()
            ),
            "availability exposes max target round"
        );
        assertGe(targetRound, availability.minTargetRound, "opened target is inside advisory range");
        assertLe(targetRound, availability.maxTargetRound, "opened target is inside advisory range");

        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "advisory"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter1, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.prank(voter1);
        bytes32 advisoryCommitKey = advisoryRecorder.recordAdvisoryVote(
            contentId, roundContext, targetRound, drandChainHash, commitHash, ciphertext
        );

        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), roundId, "advisory vote uses open round");
        assertEq(advisoryRecorder.roundAdvisoryCommitCount(contentId, roundId), 1, "advisory commit indexed");
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertGt(round.startTime, 0, "round start snapshotted");
        assertEq(round.voteCount, 1, "advisory commit is not a counted vote");
        assertEq(round.totalStake, STAKE, "advisory commit has no stake");

        vm.expectRevert(AdvisoryVoteRecorder.EpochNotEnded.selector);
        advisoryRecorder.revealAdvisoryVote(advisoryCommitKey, true, 5_000, salt);

        round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.voteCount, 1, "only staked commit counts");
        assertEq(round.totalStake, STAKE, "only staked commit contributes stake");

        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH);
        advisoryRecorder.revealAdvisoryVote(advisoryCommitKey, true, 5_000, salt);
        (,,,,, bool revealed,,,,) = advisoryRecorder.advisoryCommitCore(advisoryCommitKey);
        assertTrue(revealed, "advisory vote revealed");
        round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.revealedCount, 0, "advisory reveal does not count toward quorum");
    }

    function test_AdvisoryVoteAfterExpiredBelowQuorum_RevertsWithoutRollingStaleRound() public {
        vm.prank(owner);
        _setTlockRoundConfig(ProtocolConfig(protocolConfigAddress), 1 hours, 1 hours, 3, 100);

        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);

        uint256 staleRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory staleRound = RoundEngineReadHelpers.round(engine, contentId, staleRoundId);
        vm.warp(uint256(staleRound.startTime) + 1 hours);

        _expectAdvisoryRevert(
            voter3, contentId, "advisory-does-not-roll-stale", RoundVotingEngine.RoundNotOpen.selector
        );

        staleRound = RoundEngineReadHelpers.round(engine, contentId, staleRoundId);
        assertEq(uint256(staleRound.state), uint256(RoundLib.RoundState.Open), "advisory does not roll stale round");
        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), staleRoundId, "no new round opened");
        assertEq(advisoryRecorder.roundAdvisoryCommitCount(contentId, staleRoundId), 0, "advisory not indexed");
    }

    function test_AdvisoryVoteAtBlindEpochBoundary_RevertsWhileRoundOpen() public {
        vm.prank(owner);
        _setTlockRoundConfig(ProtocolConfig(protocolConfigAddress), 1 hours, 1 hours, 3, 100);

        uint256 contentId = _submitContent();
        _openStakedRound(voter2, contentId, "advisory-boundary-open");
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);

        vm.warp(uint256(round.startTime) + 1 hours - 1);
        _recordAdvisory(voter1, contentId, "advisory-before-boundary");
        assertEq(advisoryRecorder.roundAdvisoryCommitCount(contentId, roundId), 1, "pre-boundary advisory accepted");

        vm.warp(uint256(round.startTime) + 1 hours);
        AdvisoryVoteRecorder.AdvisoryCommitAvailability memory boundaryAvailability =
            advisoryRecorder.advisoryCommitAvailability(contentId);
        assertFalse(boundaryAvailability.canCommit, "advisory closes at first epoch boundary");
        assertEq(
            uint256(boundaryAvailability.status),
            uint256(AdvisoryVoteRecorder.AdvisoryCommitAvailabilityStatus.RoundNotOpen),
            "boundary reports the shared duration has closed"
        );
        _expectAdvisoryRevert(voter3, contentId, "advisory-at-boundary", RoundVotingEngine.RoundNotOpen.selector);
        assertEq(advisoryRecorder.roundAdvisoryCommitCount(contentId, roundId), 1, "boundary advisory rejected");
    }

    function test_AdvisoryVoteDormantContent_RevertsWithoutOpeningRound() public {
        uint256 contentId = _submitContent();
        vm.warp(block.timestamp + 31 days);
        registry.markDormant(contentId);

        uint256 roundId = _previewCommitRoundId(engine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(engine, contentId);
        uint64 targetRound = _tlockCommitTargetRound(engine, contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "dormant-advisory"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter1, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.prank(voter1);
        vm.expectRevert(VotePreflightLib.ContentNotActive.selector);
        advisoryRecorder.recordAdvisoryVote(
            contentId, _roundContext(roundId, referenceRatingBps), targetRound, drandChainHash, commitHash, ciphertext
        );

        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), 1, "creation-time round remains tracked");
    }

    function test_AdvisoryPreRoundUsesShortCustomRoundConfig() public {
        RoundLib.RoundConfig memory roundConfig =
            RoundLib.RoundConfig({ epochDuration: 2 minutes, maxDuration: 2 minutes, minVoters: 3, maxVoters: 200 });
        uint256 contentId = _submitContentWithRoundConfig("https://example.com/advisory-short", roundConfig);

        uint256 recordedAt = block.timestamp;
        uint64 targetRound = _tlockTargetRoundAt(recordedAt + roundConfig.epochDuration);
        _openStakedRoundWithTarget(voter2, contentId, targetRound, "advisory-short-staked-open");
        (bytes32 advisoryCommitKey, bytes32 advisorySalt) =
            _recordAdvisoryWithTargetRound(voter1, contentId, "advisory-short", targetRound);

        (,,,, uint48 revealableAfter,,,,,) = advisoryRecorder.advisoryCommitCore(advisoryCommitKey);
        assertGe(revealableAfter, recordedAt + roundConfig.epochDuration, "uses custom short epoch floor");
        assertLt(revealableAfter, recordedAt + EPOCH, "does not inherit global one-hour epoch");

        vm.warp(uint256(revealableAfter) + 1);

        advisoryRecorder.revealAdvisoryVote(advisoryCommitKey, true, 5_000, advisorySalt);
        (,,,,, bool revealed,,,,) = advisoryRecorder.advisoryCommitCore(advisoryCommitKey);
        assertTrue(revealed, "advisory can reveal on the custom short epoch");
    }

    function test_AdvisoryPreRoundUsesLongCustomRoundConfig() public {
        RoundLib.RoundConfig memory roundConfig =
            RoundLib.RoundConfig({ epochDuration: 3 days, maxDuration: 3 days, minVoters: 3, maxVoters: 200 });
        uint256 contentId = _submitContentWithRoundConfig("https://example.com/advisory-long", roundConfig);

        uint256 recordedAt = block.timestamp;
        uint64 targetRound = _tlockTargetRoundAt(recordedAt + roundConfig.epochDuration);
        _openStakedRoundWithTarget(voter2, contentId, targetRound, "advisory-long-staked-open");
        (bytes32 advisoryCommitKey,) = _recordAdvisoryWithTargetRound(voter1, contentId, "advisory-long", targetRound);

        (,,,, uint48 revealableAfter,,,,,) = advisoryRecorder.advisoryCommitCore(advisoryCommitKey);
        assertGe(revealableAfter, recordedAt + roundConfig.epochDuration, "uses custom long epoch floor");
        assertGt(revealableAfter, recordedAt + EPOCH, "does not leak on the global one-hour epoch");
    }

    function test_AdvisoryRevealAfterRealReveal_Succeeds() public {
        uint256 contentId = _submitContent();
        uint64 targetRound = _tlockCommitTargetRound();
        (bytes32 commitKey, bytes32 salt) =
            _commitWithTargetRound(voter2, contentId, true, STAKE, targetRound, "real-before-advisory");
        (bytes32 advisoryCommitKey, bytes32 advisorySalt) =
            _recordAdvisoryWithTargetRound(voter1, contentId, "advisory-after-real", targetRound);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.warp(_tlockRoundTimestamp(targetRound) + 1);
        _reveal(contentId, roundId, commitKey, true, salt);

        advisoryRecorder.revealAdvisoryVote(advisoryCommitKey, true, 5_000, advisorySalt);
        (,,,,, bool revealed,,,,) = advisoryRecorder.advisoryCommitCore(advisoryCommitKey);
        assertTrue(revealed, "advisory reveal remains available after real reveals");
    }

    function test_RealCommitAfterAdvisoryCommit_Reverts() public {
        uint256 contentId = _submitContent();
        _openStakedRound(voter2, contentId, "real-after-advisory-open");
        _recordAdvisory(voter1, contentId, "advisory-first");

        uint256 roundId = _previewCommitRoundId(engine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(engine, contentId);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "real-after-advisory"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter1, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.startPrank(voter1);
        lrepToken.approve(address(engine), STAKE);
        vm.expectRevert(RoundVotingEngine.AlreadyCommitted.selector);
        engine.commitVote(
            contentId,
            _roundContext(roundId, referenceRatingBps),
            targetRound,
            drandChainHash,
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_OpenRoundKeepsSnapshottedAdvisoryRecorderAfterRotation() public {
        uint256 contentId = _submitContent();
        _openStakedRound(voter2, contentId, "advisory-rotation-open");
        uint256 roundId = _previewCommitRoundId(engine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(engine, contentId);
        assertEq(_roundAdvisoryVoteRecorderSnapshot(engine, contentId, roundId), address(advisoryRecorder));

        _recordAdvisory(voter1, contentId, "advisory-before-rotation");

        AdvisoryVoteRecorder replacementRecorder = new AdvisoryVoteRecorder(address(engine), address(registry), owner);
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress).setAdvisoryVoteRecorder(address(replacementRecorder));

        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 replacementSalt = keccak256(abi.encodePacked(voter3, block.timestamp, "replacement-advisory"));
        bytes memory replacementCiphertext =
            _testCiphertext(true, replacementSalt, contentId, targetRound, drandChainHash);
        bytes32 replacementCommitHash = _commitHash(
            true,
            replacementSalt,
            voter3,
            contentId,
            roundId,
            referenceRatingBps,
            targetRound,
            drandChainHash,
            replacementCiphertext
        );

        vm.prank(voter3);
        vm.expectRevert(AdvisoryVoteRecorder.InvalidRound.selector);
        replacementRecorder.recordAdvisoryVote(
            contentId,
            _roundContext(roundId, referenceRatingBps),
            targetRound,
            drandChainHash,
            replacementCommitHash,
            replacementCiphertext
        );

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "real-after-rotation"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter1, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.startPrank(voter1);
        lrepToken.approve(address(engine), STAKE);
        vm.expectRevert(RoundVotingEngine.AlreadyCommitted.selector);
        engine.commitVote(
            contentId,
            _roundContext(roundId, referenceRatingBps),
            targetRound,
            drandChainHash,
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_AdvisoryCooldownSurvivesRecorderRotationFromOpenRoundSnapshot() public {
        uint256 contentId = _submitContent();
        uint64 openedTargetRound = _tlockCommitTargetRound(engine, contentId);
        (bytes32 ck2, bytes32 s2) =
            _commitWithTargetRound(voter2, contentId, true, STAKE, openedTargetRound, "rotated-cooldown-open");
        uint256 roundId = _previewCommitRoundId(engine, contentId);
        assertEq(_roundAdvisoryVoteRecorderSnapshot(engine, contentId, roundId), address(advisoryRecorder));

        AdvisoryVoteRecorder replacementRecorder = new AdvisoryVoteRecorder(address(engine), address(registry), owner);
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress).setAdvisoryVoteRecorder(address(replacementRecorder));

        _recordAdvisoryWithTargetRound(voter1, contentId, "rotated-cooldown-advisory", openedTargetRound);

        (bytes32 ck3, bytes32 s3) =
            _commitWithTargetRound(voter3, contentId, true, STAKE, openedTargetRound, "rotated-cooldown-third");
        (bytes32 ck4, bytes32 s4) =
            _commitWithTargetRound(voter4, contentId, false, STAKE, openedTargetRound, "rotated-cooldown-fourth");

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, true, s3);
        _reveal(contentId, roundId, ck4, false, s4);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        _openStakedRound(voter5, contentId, "replacement-recorder-open");
        uint256 nextRoundId = _previewCommitRoundId(engine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(engine, contentId);
        assertEq(_roundAdvisoryVoteRecorderSnapshot(engine, contentId, nextRoundId), address(replacementRecorder));

        uint64 targetRound = _tlockCommitTargetRound(engine, contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "replacement-recorder-advisory"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter1, contentId, nextRoundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.prank(voter1);
        vm.expectRevert(VotePreflightLib.CooldownActive.selector);
        replacementRecorder.recordAdvisoryVote(
            contentId,
            _roundContext(nextRoundId, referenceRatingBps),
            targetRound,
            drandChainHash,
            commitHash,
            ciphertext
        );
    }

    function test_RealCommitAfterDelegateAdvisoryIdentityChurn_ExpiredRoundRevertsRoundNotOpen() public {
        uint256 contentId = _submitContent();
        _openStakedRound(voter2, contentId, "delegate-advisory-open");
        vm.prank(voter1);
        mockRaterIdentityRegistry.setDelegate(delegate1);
        _recordAdvisory(delegate1, contentId, "delegate-advisory-before-identity");

        mockRaterIdentityRegistry.mint(voter1, 42);
        vm.warp(block.timestamp + 25 hours);

        _expectCommitVoteRevert(
            voter1,
            contentId,
            false,
            STAKE,
            "real-after-delegate-advisory-identity-churn",
            RoundVotingEngine.RoundNotOpen.selector
        );
    }

    function test_AdvisoryAfterDelegateRealCommitIdentityChurn_ExpiredRoundRevertsRoundNotOpen() public {
        uint256 contentId = _submitContent();
        vm.prank(voter1);
        mockRaterIdentityRegistry.setDelegate(delegate1);
        _commit(delegate1, contentId, true, STAKE);

        mockRaterIdentityRegistry.mint(voter1, 42);
        vm.warp(block.timestamp + 25 hours);

        _expectAdvisoryRevert(
            voter1, contentId, "advisory-after-delegate-real-identity-churn", AdvisoryVoteRecorder.RoundNotOpen.selector
        );
    }

    function test_RealCommitAfterAdvisoryVoteCooldown_Reverts() public {
        uint256 contentId = _submitContent();
        uint64 openedTargetRound = _tlockCommitTargetRound(engine, contentId);
        (bytes32 ck2, bytes32 s2) =
            _commitWithTargetRound(voter2, contentId, true, STAKE, openedTargetRound, "advisory-cooldown-open");
        _recordAdvisoryWithTargetRound(voter1, contentId, "advisory-cooldown", openedTargetRound);

        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, STAKE);
        (bytes32 ck4, bytes32 s4) = _commit(voter4, contentId, false, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, true, s3);
        _reveal(contentId, roundId, ck4, false, s4);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        _openRoundForTest(engine, contentId, voter1);
        uint256 nextRoundId = _previewCommitRoundId(engine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(engine, contentId);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "real-after-advisory-cooldown"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter1, contentId, nextRoundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.startPrank(voter1);
        lrepToken.approve(address(engine), STAKE);
        vm.expectRevert(RoundVotingEngine.CooldownActive.selector);
        engine.commitVote(
            contentId,
            _roundContext(nextRoundId, referenceRatingBps),
            targetRound,
            drandChainHash,
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_AdvisoryVoteCannotRevealAfterSettlement() public {
        uint256 contentId = _submitContent();
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 advisoryCommitKey, bytes32 advisorySalt) = _recordAdvisory(voter1, contentId, "late-advisory");
        (bytes32 graceOnlyAdvisoryCommitKey, bytes32 graceOnlyAdvisorySalt) =
            _recordAdvisory(voter5, contentId, "late-advisory-grace-only");

        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, STAKE);
        (bytes32 ck4, bytes32 s4) = _commit(voter4, contentId, false, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, true, s3);
        _reveal(contentId, roundId, ck4, false, s4);
        vm.warp(block.timestamp + 60 minutes + 1);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        // I-Vote-A: advisory reveals are allowed during a `revealGracePeriod` window after
        // settlement, but post-settlement reveals no longer qualify for launch credit because
        // the settled RBTS score inputs are already known.
        advisoryRecorder.revealAdvisoryVote(advisoryCommitKey, true, 5_000, advisorySalt);
        vm.expectRevert(AdvisoryVoteRecorder.AdvisoryRevealedAfterSettlement.selector);
        advisoryRecorder.claimAdvisoryLaunchCredit(advisoryCommitKey);

        // Warp past the grace period to assert the reveal is still rejected once the grace expires.
        uint256 grace = ProtocolConfig(protocolConfigAddress).revealGracePeriod();
        vm.warp(block.timestamp + grace + 1);
        vm.expectRevert(AdvisoryVoteRecorder.RoundNotOpen.selector);
        advisoryRecorder.revealAdvisoryVote(graceOnlyAdvisoryCommitKey, true, 5_000, graceOnlyAdvisorySalt);
    }

    function test_AdvisoryVoteCapsCommitsAtRoundMaxVoters() public {
        vm.prank(owner);
        _setTlockRoundConfig(ProtocolConfig(protocolConfigAddress), 1 hours, 1 hours, 3, 3);

        uint256 contentId = _submitContent();
        _openStakedRound(voter4, contentId, "advisory-cap-open");
        _recordAdvisory(voter1, contentId, "advisory-cap-1");
        _recordAdvisory(voter2, contentId, "advisory-cap-2");
        _recordAdvisory(voter3, contentId, "advisory-cap-3");

        uint256 roundId = _previewCommitRoundId(engine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(engine, contentId);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter5, block.timestamp, "advisory-cap-4"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter5, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.prank(voter5);
        vm.expectRevert(AdvisoryVoteRecorder.MaxAdvisoryVotersReached.selector);
        advisoryRecorder.recordAdvisoryVote(
            contentId, _roundContext(roundId, referenceRatingBps), targetRound, drandChainHash, commitHash, ciphertext
        );
    }

    function test_AdvisoryVoteCapsUnverifiedCommitsFromLaunchPolicy() public {
        _setMockAdvisoryLaunchPool(1);

        uint256 contentId = _submitContent();
        _openStakedRound(voter4, contentId, "advisory-unverified-cap-open");
        _recordAdvisory(voter1, contentId, "advisory-unverified-cap-1");
        uint256 roundId = _previewCommitRoundId(engine, contentId);

        assertEq(advisoryRecorder.roundUnverifiedAdvisoryCommitCount(contentId, roundId), 1);

        vm.prank(voter2);
        AdvisoryVoteRecorder.AdvisoryCommitAvailability memory availability =
            advisoryRecorder.advisoryCommitAvailability(contentId);
        assertFalse(availability.canCommit, "unverified caller cannot advisory-commit after cap");
        assertEq(
            uint256(availability.status),
            uint256(AdvisoryVoteRecorder.AdvisoryCommitAvailabilityStatus.UnverifiedAdvisoryCapReached)
        );

        _expectAdvisoryRevert(
            voter2, contentId, "advisory-unverified-cap-2", AdvisoryVoteRecorder.UnverifiedAdvisoryCapReached.selector
        );

        (bytes32 commitKey,) = _commitWithTargetRound(
            voter2, contentId, true, STAKE, _tlockCommitTargetRound(engine, contentId), "paid-after-advisory-cap"
        );
        assertTrue(commitKey != bytes32(0), "paid stake vote bypasses free advisory cap");
    }

    function test_VerifiedAdvisoryVoteBypassesUnverifiedCommitCap() public {
        _setMockAdvisoryLaunchPool(1);

        uint256 contentId = _submitContent();
        _openStakedRound(voter4, contentId, "advisory-verified-cap-open");
        _recordAdvisory(voter1, contentId, "advisory-verified-cap-unverified");
        uint256 roundId = _previewCommitRoundId(engine, contentId);
        mockRaterIdentityRegistry.mint(voter2, 42);

        vm.prank(voter2);
        AdvisoryVoteRecorder.AdvisoryCommitAvailability memory availability =
            advisoryRecorder.advisoryCommitAvailability(contentId);
        assertTrue(availability.canCommit, "verified caller can advisory-commit after unverified cap");
        assertEq(uint256(availability.status), uint256(AdvisoryVoteRecorder.AdvisoryCommitAvailabilityStatus.Available));

        _recordAdvisory(voter2, contentId, "advisory-verified-cap-verified");

        assertEq(advisoryRecorder.roundUnverifiedAdvisoryCommitCount(contentId, roundId), 1);
        assertEq(advisoryRecorder.roundAdvisoryCommitCount(contentId, roundId), 2);
    }

    function test_DelegatedVerifiedAdvisoryAvailabilityBypassesUnverifiedCommitCap() public {
        RaterRegistry raterRegistry = _installRaterRegistry();
        _setMockAdvisoryLaunchPoolForRegistry(1, address(raterRegistry));

        vm.prank(owner);
        raterRegistry.seedHumanCredential(
            voter2,
            uint64(block.timestamp + 30 days),
            keccak256("rateloop-voter-2"),
            keccak256("rateloop-evidence-voter-2")
        );

        vm.prank(voter2);
        raterRegistry.setDelegate(delegate1);
        vm.prank(delegate1);
        raterRegistry.acceptDelegate();

        assertFalse(raterRegistry.hasActiveHumanCredential(delegate1), "raw delegate is not credentialed");
        IRaterIdentityRegistry.ResolvedRater memory resolved = raterRegistry.resolveRater(delegate1);
        assertTrue(resolved.hasActiveHumanCredential, "resolved delegate is verified");

        uint256 contentId = _submitContent();
        _openStakedRound(voter4, contentId, "advisory-delegated-verified-cap-open");
        _recordAdvisory(voter1, contentId, "advisory-delegated-verified-cap-fill");
        uint256 roundId = _previewCommitRoundId(engine, contentId);

        vm.prank(delegate1);
        AdvisoryVoteRecorder.AdvisoryCommitAvailability memory availability =
            advisoryRecorder.advisoryCommitAvailability(contentId);
        assertTrue(availability.canCommit, "verified delegate can advisory-commit after unverified cap");
        assertEq(uint256(availability.status), uint256(AdvisoryVoteRecorder.AdvisoryCommitAvailabilityStatus.Available));

        _recordAdvisory(delegate1, contentId, "advisory-delegated-verified-cap-verified");

        assertEq(advisoryRecorder.roundUnverifiedAdvisoryCommitCount(contentId, roundId), 1);
        assertEq(advisoryRecorder.roundAdvisoryCommitCount(contentId, roundId), 2);
    }

    function test_AdvisoryVoteUsesCorePreflightAndRaterIdentityDedupe() public {
        vm.startPrank(owner);
        ProtocolConfig(protocolConfigAddress).setRaterRegistry(address(mockRaterIdentityRegistry));
        vm.stopPrank();
        mockRaterIdentityRegistry.mint(submitter, 9_001);
        mockRaterIdentityRegistry.mint(voter1, 42);

        uint256 contentId = _submitContent();
        _openStakedRound(voter2, contentId, "advisory-preflight-open");
        uint256 roundId = _previewCommitRoundId(engine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(engine, contentId);
        uint256 roundContext = _roundContext(roundId, referenceRatingBps);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();

        bytes32 submitterSalt = keccak256(abi.encodePacked(submitter, block.timestamp, "advisory-self"));
        bytes memory submitterCiphertext = _testCiphertext(true, submitterSalt, contentId, targetRound, drandChainHash);
        bytes32 submitterCommitHash = _commitHash(
            true,
            submitterSalt,
            submitter,
            contentId,
            roundId,
            referenceRatingBps,
            targetRound,
            drandChainHash,
            submitterCiphertext
        );

        vm.prank(submitter);
        vm.expectRevert(VotePreflightLib.SelfVote.selector);
        advisoryRecorder.recordAdvisoryVote(
            contentId, roundContext, targetRound, drandChainHash, submitterCommitHash, submitterCiphertext
        );

        bytes32 voterSalt = keccak256(abi.encodePacked(voter1, block.timestamp, "advisory-voter-id"));
        bytes memory voterCiphertext = _testCiphertext(true, voterSalt, contentId, targetRound, drandChainHash);
        bytes32 voterCommitHash = _commitHash(
            true,
            voterSalt,
            voter1,
            contentId,
            roundId,
            referenceRatingBps,
            targetRound,
            drandChainHash,
            voterCiphertext
        );

        vm.prank(voter1);
        advisoryRecorder.recordAdvisoryVote(
            contentId, roundContext, targetRound, drandChainHash, voterCommitHash, voterCiphertext
        );

        vm.prank(voter1);
        mockRaterIdentityRegistry.setDelegate(delegate1);
        vm.warp(block.timestamp + 1 days);
        bytes32 delegateSalt = keccak256(abi.encodePacked(delegate1, block.timestamp, "advisory-voter-id"));
        bytes memory delegateCiphertext = _testCiphertext(true, delegateSalt, contentId, targetRound, drandChainHash);
        bytes32 delegateCommitHash = _commitHash(
            true,
            delegateSalt,
            delegate1,
            contentId,
            roundId,
            referenceRatingBps,
            targetRound,
            drandChainHash,
            delegateCiphertext
        );

        vm.prank(delegate1);
        vm.expectRevert(AdvisoryVoteRecorder.AlreadyCommitted.selector);
        advisoryRecorder.recordAdvisoryVote(
            contentId, roundContext, targetRound, drandChainHash, delegateCommitHash, delegateCiphertext
        );
    }

    function test_AdvisoryAfterDelegateAddressIdentityChurn_ExpiredRoundRevertsRoundNotOpen() public {
        uint256 contentId = _submitContent();
        _openStakedRound(voter2, contentId, "delegate-before-human-open");
        vm.prank(voter1);
        mockRaterIdentityRegistry.setDelegate(delegate1);
        _recordAdvisory(delegate1, contentId, "delegate-before-human");

        mockRaterIdentityRegistry.mint(voter1, 42);
        vm.warp(block.timestamp + 25 hours);

        _expectAdvisoryRevert(
            voter1,
            contentId,
            "direct-after-delegate-advisory-identity-churn",
            AdvisoryVoteRecorder.RoundNotOpen.selector
        );
    }

    function test_DelegateAdvisoryAfterHolderAddressIdentityChurn_ExpiredRoundRevertsRoundNotOpen() public {
        uint256 contentId = _submitContent();
        _openStakedRound(voter2, contentId, "holder-before-human-open");
        _recordAdvisory(voter1, contentId, "holder-before-human");

        mockRaterIdentityRegistry.mint(voter1, 42);
        vm.prank(voter1);
        mockRaterIdentityRegistry.setDelegate(delegate1);
        vm.warp(block.timestamp + 25 hours);

        _expectAdvisoryRevert(
            delegate1,
            contentId,
            "delegate-after-holder-advisory-identity-churn",
            AdvisoryVoteRecorder.RoundNotOpen.selector
        );
    }

    function test_AdvisoryVoteRespectsCountedVoteCooldown() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);

        uint256 roundId = _previewCommitRoundId(engine, contentId);
        uint16 referenceRatingBps = _previewCommitReferenceRatingBps(engine, contentId);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "advisory-cooldown"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter1, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.prank(voter1);
        vm.expectRevert(VotePreflightLib.CooldownActive.selector);
        advisoryRecorder.recordAdvisoryVote(
            contentId, _roundContext(roundId, referenceRatingBps), targetRound, drandChainHash, commitHash, ciphertext
        );

        vm.warp(block.timestamp + 1 days);
        vm.prank(voter1);
        vm.expectRevert(AdvisoryVoteRecorder.AlreadyCommitted.selector);
        advisoryRecorder.recordAdvisoryVote(
            contentId, _roundContext(roundId, referenceRatingBps), targetRound, drandChainHash, commitHash, ciphertext
        );
    }

    function test_Commit_InvalidStake_AboveMax_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.prank(voter1);
        lrepToken.approve(address(engine), 11e6);
        uint256 cachedRoundContext8 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.InvalidStake.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext8,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            11e6,
            address(0)
        );
    }

    function test_Commit_ContentNotActive_Reverts() public {
        uint256 contentId = _submitContent();

        vm.prank(submitter);
        registry.cancelContent(contentId);

        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.ContentNotActive.selector);
        engine.openRound(contentId);
    }

    function test_Commit_SelfVote_SubmitterReverts() public {
        uint256 contentId = _submitContent();

        vm.prank(submitter);
        vm.expectRevert(RoundVotingEngine.SelfVote.selector);
        engine.openRound(contentId);
    }

    function test_Commit_SelfVote_DelegateSubmittedContentRevertsForHolderAndDelegate() public {
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress).setRaterRegistry(address(mockRaterIdentityRegistry));

        mockRaterIdentityRegistry.setHolder(submitter);
        vm.prank(submitter);
        mockRaterIdentityRegistry.setDelegate(delegate1);

        uint256 contentId;
        vm.startPrank(delegate1);
        lrepToken.approve(address(registry), 10e6);
        contentId = _submitContentWithReservation(
            registry, "https://example.com/delegate-self-vote", "goal", "goal", "tags", 0
        );
        vm.stopPrank();

        vm.prank(delegate1);
        vm.expectRevert(RoundVotingEngine.SelfVote.selector);
        engine.openRound(contentId);

        vm.prank(submitter);
        mockRaterIdentityRegistry.removeDelegate();

        vm.prank(submitter);
        vm.expectRevert(RoundVotingEngine.SelfVote.selector);
        engine.openRound(contentId);
    }

    function test_Commit_CooldownActive_Reverts() public {
        uint256 contentId = _submitContent();

        // voter1 commits — starts 24h cooldown
        _commit(voter1, contentId, true, STAKE);

        // voter1 immediately tries to commit again (within 24h) — should get CooldownActive
        vm.startPrank(voter1);
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp + 1));
        bytes32 commitHash = _commitHash(false, salt, contentId);
        bytes memory ciphertext = _testCiphertext(false, salt, contentId);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext13 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.CooldownActive.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext13,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_Commit_AfterExpiredRound_StartsNewRound() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        uint256 expiredRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past 7-day max duration
        vm.warp(block.timestamp + 8 days);

        bytes32 salt = keccak256(abi.encodePacked(voter2, block.timestamp));
        _openRoundForTest(engine, contentId, voter2);
        TestCommitArtifacts memory artifacts = _buildTestCommitArtifacts(address(engine), voter2, true, salt, contentId);

        vm.prank(voter2);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext14 = _roundContext(artifacts.roundId, artifacts.roundReferenceRatingBps);
        vm.prank(voter2);
        engine.commitVote(
            contentId,
            cachedRoundContext14,
            artifacts.targetRound,
            artifacts.drandChainHash,
            artifacts.commitHash,
            artifacts.ciphertext,
            STAKE,
            address(0)
        );

        RoundLib.Round memory cancelledRound = RoundEngineReadHelpers.round(engine, contentId, expiredRoundId);
        uint256 newRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(uint256(cancelledRound.state), uint256(RoundLib.RoundState.Cancelled));
        assertEq(newRoundId, expiredRoundId + 1);
        assertEq(_voterCommitHash(engine, contentId, newRoundId, voter2), artifacts.commitHash);
    }

    function test_Commit_EmptyCiphertext_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext15 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.InvalidCiphertext.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext15,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            "",
            STAKE,
            address(0)
        );
    }

    function test_Commit_OversizedCiphertext_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory hugeCiphertext = new bytes(2_049); // exceeds MAX_CIPHERTEXT_SIZE

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext16 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.CiphertextTooLarge.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext16,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            hugeCiphertext,
            STAKE,
            address(0)
        );
    }

    function test_Commit_MaxCiphertextSize_Accepted() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes memory maxCiphertext = _maxAgeCiphertext();
        assertLe(maxCiphertext.length, 2_048);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 commitHash = _commitHash(true, salt, contentId, targetRound, drandChainHash, maxCiphertext);

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext17 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        engine.commitVote(
            contentId, cachedRoundContext17, targetRound, drandChainHash, commitHash, maxCiphertext, STAKE, address(0)
        );
    }

    function test_Commit_MalformedArmor_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes memory malformed = hex"deadbeef";
        bytes32 commitHash = _commitHash(true, salt, contentId, malformed);

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext18 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.InvalidCiphertext.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext18,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            malformed,
            STAKE,
            address(0)
        );
    }

    function test_Commit_ShallowPseudoTlockEnvelope_Reverts() public {
        uint256 contentId = _submitContent();
        bytes32 salt = bytes32(0);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();

        bytes memory shallowPayload = abi.encodePacked(
            TEST_AGE_VERSION,
            TEST_TLOCK_LINE_PREFIX,
            bytes(Strings.toString(targetRound)),
            " ",
            _bytes32Hex(drandChainHash),
            "\n",
            TEST_PAYLOAD_LINE_PREFIX,
            "u:",
            _bytes32Hex(salt),
            "\n",
            TEST_MAC_LINE_PREFIX,
            "bWFj\n"
        );
        bytes memory ciphertext = _armoredTestCiphertext(shallowPayload, true);
        bytes32 commitHash = _commitHash(true, salt, contentId, targetRound, drandChainHash, ciphertext);

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext19 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.InvalidCiphertext.selector);
        engine.commitVote(
            contentId, cachedRoundContext19, targetRound, drandChainHash, commitHash, ciphertext, STAKE, address(0)
        );
    }

    function test_Commit_UnchunkedArmorLine_Reverts() public {
        uint256 contentId = _submitContent();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes memory decodedPayload = _testCiphertextPayload(true, salt, contentId, targetRound, drandChainHash, 0);
        bytes memory ciphertext =
            abi.encodePacked(TEST_AGE_HEADER, bytes(Base64.encode(decodedPayload)), "\n", TEST_AGE_FOOTER);
        bytes32 commitHash = _commitHash(true, salt, contentId, targetRound, drandChainHash, ciphertext);

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext20 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.InvalidCiphertext.selector);
        engine.commitVote(
            contentId, cachedRoundContext20, targetRound, drandChainHash, commitHash, ciphertext, STAKE, address(0)
        );
    }

    function test_Commit_WrongChainHash_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        uint64 targetRound = _tlockCommitTargetRound();
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, bytes32(uint256(1)));
        bytes32 commitHash = _commitHash(true, salt, contentId, targetRound, bytes32(uint256(1)), ciphertext);

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext21 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.DrandChainHashMismatch.selector);
        engine.commitVote(
            contentId, cachedRoundContext21, targetRound, bytes32(uint256(1)), commitHash, ciphertext, STAKE, address(0)
        );
    }

    function test_Commit_TargetRoundBeforeWindow_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        uint64 badTargetRound = targetRound == 0 ? 0 : targetRound - 1;
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, badTargetRound, drandChainHash);
        bytes32 commitHash = _commitHash(true, salt, contentId, badTargetRound, drandChainHash, ciphertext);

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext22 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.TargetRoundOutOfWindow.selector);
        engine.commitVote(
            contentId, cachedRoundContext22, badTargetRound, drandChainHash, commitHash, ciphertext, STAKE, address(0)
        );
    }

    function test_Commit_TargetRoundBeforeCeilWindow_Reverts() public {
        uint64 customPeriod = 7;
        vm.prank(owner);
        _setTlockDrandConfig(
            ProtocolConfig(protocolConfigAddress), DEFAULT_DRAND_CHAIN_HASH, DEFAULT_DRAND_GENESIS_TIME, customPeriod
        );
        uint256 contentId = _submitContent();
        uint256 revealableAfter = block.timestamp + EPOCH;
        bytes32 drandChainHash = DEFAULT_DRAND_CHAIN_HASH;

        uint64 floorTargetRound = _roundAt(revealableAfter, DEFAULT_DRAND_GENESIS_TIME, customPeriod);
        uint256 floorTargetRoundTimestamp =
            uint256(DEFAULT_DRAND_GENESIS_TIME) + (uint256(floorTargetRound) - 1) * uint256(customPeriod);
        assertLt(floorTargetRoundTimestamp, revealableAfter, "floor target would decrypt before epoch end");

        bytes32 badSalt = keccak256(abi.encodePacked(voter1, block.timestamp, "floor target"));
        bytes memory badCiphertext = _testCiphertext(true, badSalt, contentId, floorTargetRound, drandChainHash);
        bytes32 badCommitHash =
            _commitHash(true, badSalt, voter1, contentId, floorTargetRound, drandChainHash, badCiphertext);

        vm.startPrank(voter1);
        engine.openRound(contentId);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext23 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.TargetRoundOutOfWindow.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext23,
            floorTargetRound,
            drandChainHash,
            badCommitHash,
            badCiphertext,
            STAKE,
            address(0)
        );

        uint64 ceilTargetRound = floorTargetRound + 1;
        uint256 ceilTargetRoundTimestamp =
            uint256(DEFAULT_DRAND_GENESIS_TIME) + (uint256(ceilTargetRound) - 1) * uint256(customPeriod);
        assertGe(ceilTargetRoundTimestamp, revealableAfter, "ceil target preserves blind epoch");

        bytes32 goodSalt = keccak256(abi.encodePacked(voter1, block.timestamp, "ceil target"));
        bytes memory goodCiphertext = _testCiphertext(true, goodSalt, contentId, ceilTargetRound, drandChainHash);
        bytes32 goodCommitHash =
            _commitHash(true, goodSalt, voter1, contentId, ceilTargetRound, drandChainHash, goodCiphertext);
        uint256 cachedRoundContext24 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        engine.commitVote(
            contentId,
            cachedRoundContext24,
            ceilTargetRound,
            drandChainHash,
            goodCommitHash,
            goodCiphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_Commit_TargetRoundAfterWindow_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        uint64 badTargetRound = targetRound + 10_000;
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, badTargetRound, drandChainHash);
        bytes32 commitHash = _commitHash(true, salt, contentId, badTargetRound, drandChainHash, ciphertext);

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext25 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.TargetRoundOutOfWindow.selector);
        engine.commitVote(
            contentId, cachedRoundContext25, badTargetRound, drandChainHash, commitHash, ciphertext, STAKE, address(0)
        );
    }

    function test_Commit_TargetRoundAtTwoPeriodTolerance_Accepts() public {
        uint256 contentId = _submitContent();

        uint256 revealableAfter = block.timestamp + EPOCH;
        uint64 targetRound =
            _roundAt(revealableAfter + 2 * uint256(_tlockDrandPeriod()), _tlockDrandGenesisTime(), _tlockDrandPeriod());
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "two period target"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(true, salt, voter1, contentId, targetRound, drandChainHash, ciphertext);

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 roundContext = _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        engine.commitVote(
            contentId, roundContext, targetRound, drandChainHash, commitHash, ciphertext, STAKE, address(0)
        );
    }

    function test_Commit_TargetRoundCannotDelayLongCustomEpoch_Reverts() public {
        vm.prank(owner);
        _setTlockRoundConfig(ProtocolConfig(protocolConfigAddress), EPOCH, EPOCH, 3, 100);
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "long target drift"));
        bytes32 drandChainHash = _tlockDrandChainHash();
        uint64 badTargetRound = _tlockTargetRoundAt(block.timestamp + 14 days);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, badTargetRound, drandChainHash);
        bytes32 commitHash = _commitHash(true, salt, contentId, badTargetRound, drandChainHash, ciphertext);

        _openRoundForTest(engine, contentId, voter1);
        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 roundContext = _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.TargetRoundOutOfWindow.selector);
        engine.commitVote(
            contentId, roundContext, badTargetRound, drandChainHash, commitHash, ciphertext, STAKE, address(0)
        );
    }

    function test_Commit_MaxVotersReached_Reverts() public {
        vm.prank(owner);
        // maxVoters=3 — after 3 commits the 4th is rejected
        _setTlockRoundConfig(ProtocolConfig(protocolConfigAddress), 1 hours, 1 hours, 3, 3);

        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, true, STAKE);
        _commit(voter3, contentId, false, STAKE);

        bytes32 salt = keccak256(abi.encodePacked(voter4, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.prank(voter4);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext26 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.prank(voter4);
        vm.expectRevert(RoundVotingEngine.MaxVotersReached.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext26,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
    }

    function test_GetActiveRoundId_ReturnsInitialRoundAfterCreation() public {
        uint256 contentId = _submitContent();
        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), 1);
    }

    function test_GetActiveRoundId_ReturnsCorrectId() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), 1);
    }

    function test_GetActiveRoundId_ReturnsZeroAfterSettlement() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);
        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), 0);
    }

    function test_NewRoundCreatedAfterSettlement() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        // Wait past 24h cooldown then voter1 can commit again
        vm.warp(block.timestamp + 25 hours);
        _commit(voter1, contentId, true, STAKE);

        uint256 newRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(newRoundId, roundId + 1);
    }

    function test_RbtsSeedMissedExplicitBlockWindowRearmsFutureBlock() public {
        (uint256 contentId, uint256 roundId,) = _setupEconomicPredictionRound(_fiveUpThreeDownDirections(), address(0));

        uint256 settlementBlock = block.number + 1;
        vm.roll(settlementBlock);
        engine.settleRound(contentId, roundId);
        assertFalse(_roundRbtsScored(engine, contentId, roundId), "first call only captures seed");

        vm.roll(settlementBlock + 8193);
        vm.recordLogs();
        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        uint256 rearmedSeedBlock = _rbtsSeedBlockFromLogs(vm.getRecordedLogs(), contentId, roundId);

        RoundLib.Round memory pending = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(pending.state), uint256(RoundLib.RoundState.SettlementPending));
        assertFalse(_roundRbtsScored(engine, contentId, roundId), "missed explicit seed block re-arms");

        _rollPastRbtsSeedBlock(rearmedSeedBlock);
        _applyFullWeightRbtsSettlementSnapshot(contentId, roundId);
        RoundLib.Round memory settled = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settled.state), uint256(RoundLib.RoundState.Settled));
        assertTrue(_roundRbtsScored(engine, contentId, roundId), "rearmed seed finalizes accounting");
        assertNotEq(_roundRbtsScoreSeed(engine, contentId, roundId), bytes32(0), "rearmed seed scores RBTS");
    }

    function test_ThresholdReachedAt_SetOnMinVotersReveal() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);

        // Before 3rd reveal, thresholdReachedAt should be 0
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.thresholdReachedAt, 0);

        uint256 beforeThirdReveal = block.timestamp;
        _reveal(contentId, roundId, ck3, false, s3);

        round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.thresholdReachedAt, beforeThirdReveal);
    }

    function test_CommitVote_RevertsAfterRevealThresholdReachedAndSharedDurationClosed() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertGt(round.thresholdReachedAt, 0);

        bytes32 salt4 = keccak256(abi.encodePacked(voter4, block.timestamp, "late-direct"));
        TestCommitArtifacts memory lateCommit = _buildTestCommitArtifacts(voter4, true, salt4, contentId);

        vm.startPrank(voter4);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext27 =
            _roundContext(_previewCommitRoundId(engine, contentId), lateCommit.roundReferenceRatingBps);
        vm.expectRevert(RoundVotingEngine.RoundNotOpen.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext27,
            lateCommit.targetRound,
            lateCommit.drandChainHash,
            lateCommit.commitHash,
            lateCommit.ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_SingleDurationVotesUseFullStakeWeight() public {
        uint256 contentId = _submitContent();

        // voter1 commits during the shared blind window.
        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, false, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // The shared duration is the only blind window; all accepted votes use full stake.
        RoundLib.Round memory rEW0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rEW0.startTime) + EPOCH);

        _reveal(contentId, roundId, ck1, false, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, true, s3);

        // UP gets 2 voters at full weight and DOWN gets 1 voter at full weight.

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertTrue(round.upWins);
    }

    function test_ConsensusSettlement_UnanimousUpWins() public {
        (uint256 contentId, uint256 roundId,) = _setupEconomicPredictionRound(_allUpDirections(), address(0));

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertTrue(round.upWins);

        // No consensus subsidy; any voter pool comes from RBTS score-spread forfeiture.
        uint256 voterPool = _roundVoterPool(engine, contentId, roundId);
        assertGt(voterPool, 0);
    }

    function test_CooldownActive_SucceedsAfter24h() public {
        uint256 contentId = _submitContent();

        // voter1 commits — starts 24h cooldown
        _commit(voter1, contentId, true, STAKE);

        // Within 24h — voter1 cannot commit again
        vm.startPrank(voter1);
        bytes32 salt1 = keccak256(abi.encodePacked(voter1, block.timestamp + 1));
        bytes32 commitHash1 = _commitHash(false, salt1, contentId);
        bytes memory ciphertext1 = _testCiphertext(false, salt1, contentId);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext28 =
            _roundContext(_previewCommitRoundId(engine, contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.CooldownActive.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext28,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash1,
            ciphertext1,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        // Warp past 24h cooldown — second round possible
        uint256 cid2 = _submitContentWithUrl("https://example.com/cooldown-test");
        vm.warp(block.timestamp + 25 hours);

        // voter1 can now commit to a different content
        _commit(voter1, cid2, true, STAKE);
        uint256 rid2 = RoundEngineReadHelpers.activeRoundId(engine, cid2);
        assertTrue(_voterCommitHash(engine, cid2, rid2, voter1) != bytes32(0));
    }

    function test_Cooldown_AfterRoundSettles_VoterCanRecommit() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        // Warp past 24h cooldown
        vm.warp(block.timestamp + 25 hours);

        // voter1 can now commit to a new round
        _commit(voter1, contentId, true, STAKE);
        uint256 newRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(newRoundId, roundId + 1);
        assertTrue(_voterCommitHash(engine, contentId, newRoundId, voter1) != bytes32(0));
    }

    function test_GetRound_ReturnsCorrectData() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);

        assertEq(round.voteCount, 2);
        assertEq(round.totalStake, STAKE * 2);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Open));
        assertGt(round.startTime, 0);
    }

    function test_GetCommit_ReturnsCorrectData() public {
        uint256 contentId = _submitContent();

        (bytes32 commitKey, bytes32 salt) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        RoundLib.Commit memory commit = RoundEngineReadHelpers.commit(engine, contentId, roundId, commitKey);
        assertEq(commit.voter, voter1);
        assertEq(commit.stakeAmount, STAKE);
        assertEq(commit.ciphertextHash, keccak256(_testCiphertext(true, salt, contentId)));
        assertFalse(commit.revealed);
        assertEq(commit.epochIndex, 0); // epoch 1 -> index 0
    }

    function test_GetRoundCommitHashes_ReturnsAllKeys() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory keys = RoundEngineReadHelpers.commitKeys(engine, contentId, roundId);
        assertEq(keys.length, 2);
    }

    // computeCurrentEpochEnd tests removed — function removed for contract size.

    function test_RevealUpdatesWeightedPools() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        // epoch-1 weight = 100% -> weightedUpPool = STAKE
        assertEq(round.weightedUpPool, STAKE);
        assertEq(round.weightedDownPool, 0);

        _reveal(contentId, roundId, ck2, false, s2);

        round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.weightedUpPool, STAKE);
        assertEq(round.weightedDownPool, STAKE);
    }

    function test_MultipleContentIds_IndependentRounds() public {
        uint256 cid1 = _submitContent();
        uint256 cid2 = _submitContentWithUrl("https://example.com/2");

        _commit(voter1, cid1, true, STAKE);
        _commit(voter2, cid2, false, STAKE);

        assertEq(RoundEngineReadHelpers.activeRoundId(engine, cid1), 1);
        assertEq(RoundEngineReadHelpers.activeRoundId(engine, cid2), 1);

        RoundLib.Round memory r1 = RoundEngineReadHelpers.round(engine, cid1, 1);
        RoundLib.Round memory r2 = RoundEngineReadHelpers.round(engine, cid2, 1);

        assertEq(r1.voteCount, 1);
        assertEq(r2.voteCount, 1);
    }

    function test_HasUnrevealedVotes_TrueWhenUnrevealed() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        assertTrue(_hasUnrevealedVotes(contentId));
    }

    function test_HasUnrevealedVotes_FalseAfterAllRevealed() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);

        assertFalse(_hasUnrevealedVotes(contentId));
    }

    function test_HasUnrevealedVotes_FalseWithNoRound() public {
        uint256 contentId = _submitContent();
        assertFalse(_hasUnrevealedVotes(contentId));
    }

    function _hasUnrevealedVotes(uint256 contentId) internal view returns (bool) {
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        if (roundId == 0) return false;
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        return round.voteCount > round.revealedCount;
    }
}
