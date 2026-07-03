// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { VotingTestBase } from "./VotingTestHelpers.sol";
import { RoundEngineReadHelpers } from "./RoundEngineReadHelpers.sol";
import { ClusterPayoutOracle } from "../../contracts/ClusterPayoutOracle.sol";
import { ContentRegistry } from "../../contracts/ContentRegistry.sol";
import { FrontendRegistry } from "../../contracts/FrontendRegistry.sol";
import { IClusterPayoutOracle } from "../../contracts/interfaces/IClusterPayoutOracle.sol";
import { LoopReputation } from "../../contracts/LoopReputation.sol";
import { MockCategoryRegistry } from "../../contracts/mocks/MockCategoryRegistry.sol";
import { MockERC20 } from "../../contracts/mocks/MockERC20.sol";
import { ProtocolConfig } from "../../contracts/ProtocolConfig.sol";
import { QuestionRewardPoolEscrow } from "../../contracts/QuestionRewardPoolEscrow.sol";
import { RoundLib } from "../../contracts/libraries/RoundLib.sol";
import { RoundRewardDistributor } from "../../contracts/RoundRewardDistributor.sol";
import { RoundVotingEngine } from "../../contracts/RoundVotingEngine.sol";
import { RoundVotingEngineRbtsSettlementModule } from "../../contracts/RoundVotingEngineRbtsSettlementModule.sol";
import { MockRaterIdentityRegistry } from "../mocks/MockRaterIdentityRegistry.sol";

abstract contract SecondPassAuditRegressionBase is VotingTestBase {
    LoopReputation public lrepToken;
    ContentRegistry public registry;
    RoundVotingEngine public votingEngine;
    RoundRewardDistributor public rewardDistributor;
    FrontendRegistry public frontendRegistry;
    QuestionRewardPoolEscrow public rewardPoolEscrow;
    ProtocolConfig public protocolConfig;
    MockERC20 public usdc;
    MockRaterIdentityRegistry public raterIdentityRegistry;

    address public owner = address(1);
    address public submitter = address(2);
    address public funder = address(3);
    address public voter1 = address(4);
    address public voter2 = address(5);
    address public voter3 = address(6);
    address public treasury = address(100);

    uint256 public constant STAKE = 5e6;
    uint256 public constant EPOCH_DURATION = 10 minutes;
    uint256 public constant REWARD_POOL_AMOUNT = 100e6;
    uint256 internal constant BUNDLE_CLAIM_GRACE = 7 days;
    uint8 internal constant REWARD_ASSET_USDC = 1;

    string internal constant QUESTION = "Would you recommend this hotel?";
    string internal constant TAGS = "travel";
    string internal constant DEFAULT_MEDIA_URL = "hotel-room";
    uint256 internal constant CATEGORY_ID = 1;

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

    function setUp() public virtual {
        vm.warp(1000);
        vm.roll(100);

        vm.startPrank(owner);

        lrepToken = new LoopReputation(owner, owner);
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), owner);

        ContentRegistry registryImpl = new ContentRegistry();
        RoundVotingEngine engineImpl = new RoundVotingEngine();
        RoundRewardDistributor distImpl = new RoundRewardDistributor();
        FrontendRegistry frontendRegistryImpl = new FrontendRegistry();
        QuestionRewardPoolEscrow rewardPoolImpl = new QuestionRewardPoolEscrow();

        protocolConfig = _deployProtocolConfig(owner);
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
                        (owner, address(lrepToken), address(registry), address(protocolConfig))
                    )
                )
            )
        );
        votingEngine.setRbtsSettlementModule(address(new RoundVotingEngineRbtsSettlementModule()));
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
        frontendRegistry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(frontendRegistryImpl),
                    abi.encodeCall(FrontendRegistry.initialize, (owner, owner, address(lrepToken)))
                )
            )
        );
        usdc = new MockERC20("USD Coin", "USDC", 6);
        raterIdentityRegistry = new MockRaterIdentityRegistry();
        rewardPoolEscrow = QuestionRewardPoolEscrow(
            address(
                new ERC1967Proxy(
                    address(rewardPoolImpl),
                    abi.encodeCall(
                        QuestionRewardPoolEscrow.initialize,
                        (
                            owner,
                            address(lrepToken),
                            address(usdc),
                            address(registry),
                            address(votingEngine),
                            address(raterIdentityRegistry)
                        )
                    )
                )
            )
        );

        MockCategoryRegistry categoryRegistry = new MockCategoryRegistry();
        categoryRegistry.seedDefaultTestCategories();

        registry.setVotingEngine(address(votingEngine));
        registry.setProtocolConfig(address(protocolConfig));
        registry.setCategoryRegistry(address(categoryRegistry));
        registry.setQuestionRewardPoolEscrow(address(rewardPoolEscrow));
        frontendRegistry.setVotingEngine(address(votingEngine));

        protocolConfig.setRewardDistributor(address(rewardDistributor));
        protocolConfig.setCategoryRegistry(address(categoryRegistry));
        protocolConfig.setFrontendRegistry(address(frontendRegistry));
        protocolConfig.setTreasury(treasury);
        protocolConfig.setRaterRegistry(address(raterIdentityRegistry));
        _setTlockDrandConfig(protocolConfig, DEFAULT_DRAND_CHAIN_HASH, DEFAULT_DRAND_GENESIS_TIME, DEFAULT_DRAND_PERIOD);
        _setTlockRoundConfig(protocolConfig, EPOCH_DURATION, EPOCH_DURATION, 3, 100);

        address[5] memory humans = [submitter, funder, voter1, voter2, voter3];
        for (uint256 i = 0; i < humans.length; i++) {
            raterIdentityRegistry.setHolder(humans[i]);
            lrepToken.mint(humans[i], 10_000e6);
            usdc.mint(humans[i], 1_000e6);
        }

        vm.stopPrank();
    }

    function _submitQuestion(string memory suffix) internal returns (uint256 contentId) {
        string memory mediaUrl = bytes(suffix).length == 0 ? DEFAULT_MEDIA_URL : suffix;
        string[] memory imageUrls = new string[](1);
        imageUrls[0] = _submissionImageUrl(mediaUrl);
        activeTlockContentRegistry = registry;
        bytes32 salt = keccak256(abi.encode(mediaUrl, QUESTION, TAGS, submitter, block.timestamp));

        vm.startPrank(submitter);
        _reserveQuestionMediaSubmission(
            registry, "https://example.com/context", imageUrls, "", QUESTION, TAGS, CATEGORY_ID, salt, submitter
        );
        vm.warp(block.timestamp + 1);
        contentId = registry.submitQuestion(
            "https://example.com/context",
            imageUrls,
            "",
            QUESTION,
            TAGS,
            CATEGORY_ID,
            _emptySubmissionDetails(),
            salt,
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function _createRewardPool(uint256 contentId, uint256 amount, uint256 requiredVoters)
        internal
        returns (uint256 rewardPoolId)
    {
        return _createRewardPoolWithExpiry(contentId, amount, requiredVoters, _defaultBountyClosesAt(contentId));
    }

    function _createRewardPoolWithExpiry(uint256 contentId, uint256 amount, uint256 requiredVoters, uint256 expiresAt)
        internal
        returns (uint256 rewardPoolId)
    {
        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), amount);
        vm.stopPrank();

        uint256 windowSeconds = expiresAt == 0 ? 0 : expiresAt - block.timestamp;
        vm.prank(address(registry));
        rewardPoolId = rewardPoolEscrow.createSubmissionRewardPoolFromRegistry(
            contentId, funder, funder, REWARD_ASSET_USDC, amount, requiredVoters, expiresAt, windowSeconds, 0
        );
    }

    function _defaultBountyClosesAt(uint256 contentId) internal view returns (uint256) {
        RoundLib.RoundConfig memory roundConfig = registry.getContentRoundConfig(contentId);
        return block.timestamp + uint256(roundConfig.maxDuration);
    }

    function _enableClusterPayoutOracle() internal returns (ClusterPayoutOracle oracle) {
        oracle = _newEligibleClusterPayoutOracle();
        oracle.setOracleConfig(1 hours, 5e6, address(this));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), address(rewardPoolEscrow));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD(), address(rewardPoolEscrow));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_PUBLIC_RATING(), address(registry));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_RBTS_SETTLEMENT(), address(votingEngine));
        vm.prank(owner);
        protocolConfig.setClusterPayoutOracle(address(oracle));
    }

    function _newEligibleClusterPayoutOracle() internal returns (ClusterPayoutOracle oracle) {
        _ensureOracleFrontendRegistered();
        oracle = new ClusterPayoutOracle(address(this), address(frontendRegistry), address(usdc));
        bytes32 disputeRecorderRole = frontendRegistry.SNAPSHOT_DISPUTE_RECORDER_ROLE();
        vm.prank(owner);
        frontendRegistry.grantRole(disputeRecorderRole, address(oracle));
    }

    function _ensureOracleFrontendRegistered() internal {
        (,, bool eligible,) = frontendRegistry.getFrontendInfo(address(this));
        if (eligible) return;

        uint256 stakeAmount = frontendRegistry.STAKE_AMOUNT();
        vm.prank(owner);
        lrepToken.mint(address(this), stakeAmount);
        lrepToken.approve(address(frontendRegistry), stakeAmount);
        frontendRegistry.register();
    }

    function _finalizeClusterPayoutSnapshotWithRoot(
        ClusterPayoutOracle oracle,
        uint256 rewardPoolId,
        uint256 contentId,
        uint256 roundId,
        uint32 rawEligibleVoters,
        uint32 effectiveParticipantUnits,
        uint256 totalClaimWeight,
        bytes32 weightRoot
    ) internal {
        _finalizeClusterRoundPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            roundId,
            uint64(roundId),
            rawEligibleVoters,
            effectiveParticipantUnits,
            totalClaimWeight,
            weightRoot
        );
    }

    function _finalizeClusterRoundPayoutSnapshotWithRoot(
        ClusterPayoutOracle oracle,
        uint256 rewardPoolId,
        uint256 contentId,
        uint256 roundId,
        uint64 correlationEpochId,
        uint32 rawEligibleVoters,
        uint32 effectiveParticipantUnits,
        uint256 totalClaimWeight,
        bytes32 weightRoot
    ) internal {
        if (oracle.correlationEpochSnapshot(correlationEpochId).status == IClusterPayoutOracle.SnapshotStatus.None) {
            oracle.proposeCorrelationEpoch(
                correlationEpochId,
                uint64(roundId),
                uint64(roundId),
                keccak256(abi.encode("cluster-root", roundId, correlationEpochId)),
                keccak256("params"),
                keccak256("epoch-artifact"),
                "ipfs://epoch",
                _questionEpochSources(rewardPoolId, contentId, roundId)
            );
            vm.warp(block.timestamp + uint256(oracle.challengeWindow()) + 1);
            oracle.finalizeCorrelationEpoch(correlationEpochId);
        }

        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: oracle.PAYOUT_DOMAIN_QUESTION_REWARD(),
                rewardPoolId: rewardPoolId,
                contentId: contentId,
                roundId: roundId,
                correlationEpochId: correlationEpochId,
                rawEligibleVoters: rawEligibleVoters,
                effectiveParticipantUnits: effectiveParticipantUnits,
                totalClaimWeight: totalClaimWeight,
                weightRoot: weightRoot,
                reasonRoot: keccak256("reason-root"),
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://round"
            })
        );
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), rewardPoolId, contentId, roundId);
        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        vm.warp(uint256(proposal.proposedAt) + uint256(oracle.challengeWindow()) + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);
        _warpPastQuestionRewardSnapshotVeto(oracle, rewardPoolId, contentId, roundId);
    }

    function _warpPastQuestionRewardSnapshotVeto(
        ClusterPayoutOracle oracle,
        uint256 rewardPoolId,
        uint256 contentId,
        uint256 roundId
    ) internal {
        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot = oracle.getRoundPayoutSnapshot(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), rewardPoolId, contentId, roundId
        );
        vm.warp(uint256(snapshot.finalizedAt) + uint256(oracle.FINALIZATION_VETO_WINDOW()) + 1);
    }

    function _questionEpochSources(uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        internal
        pure
        returns (IClusterPayoutOracle.CorrelationEpochSourceRef[] memory sources)
    {
        sources = new IClusterPayoutOracle.CorrelationEpochSourceRef[](1);
        sources[0] = IClusterPayoutOracle.CorrelationEpochSourceRef({
            domain: 1, rewardPoolId: rewardPoolId, contentId: contentId, roundId: roundId
        });
    }

    function _clusterPayoutWeight(uint256 rewardPoolId, uint256 contentId, uint256 roundId, uint256 commitIndex)
        internal
        view
        returns (IClusterPayoutOracle.PayoutWeight memory payoutWeight)
    {
        bytes32 commitKey = votingEngine.getRoundCommitKey(contentId, roundId, commitIndex);
        uint256 baseWeight = 10_000;
        payoutWeight = IClusterPayoutOracle.PayoutWeight({
            domain: 1,
            rewardPoolId: rewardPoolId,
            contentId: contentId,
            roundId: roundId,
            commitKey: commitKey,
            identityKey: _commitIdentityKey(votingEngine, contentId, roundId, commitKey),
            account: _commitIdentityHolder(votingEngine, contentId, roundId, commitKey),
            baseWeight: baseWeight,
            independenceBps: 10_000,
            effectiveWeight: baseWeight,
            reasonHash: keccak256("cluster-payout")
        });
    }

    function _settleRoundWith(address[] memory voters, uint256 contentId, bool[] memory directions)
        internal
        returns (uint256 roundId)
    {
        roundId = _revealRoundWith(voters, contentId, directions);
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentId, roundId);
    }

    function _revealRoundWith(address[] memory voters, uint256 contentId, bool[] memory directions)
        internal
        returns (uint256 roundId)
    {
        bytes32[] memory salts = new bytes32[](voters.length);
        bytes32[] memory commitKeys = new bytes32[](voters.length);
        for (uint256 i = 0; i < voters.length; i++) {
            salts[i] = keccak256(abi.encodePacked(voters[i], contentId, directions[i], i));
            commitKeys[i] = _commitTestVote(
                DirectTestCommitRequest({
                    engine: votingEngine,
                    lrepToken: lrepToken,
                    voter: voters[i],
                    contentId: contentId,
                    isUp: directions[i],
                    stake: STAKE,
                    frontend: address(0),
                    salt: salts[i]
                })
            );
        }

        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);

        for (uint256 i = 0; i < voters.length; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], 5_000, salts[i]);
        }
    }

    function _threeVoters() internal view returns (address[] memory voters) {
        voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
    }

    function _directions(bool a, bool b, bool c) internal pure returns (bool[] memory directions) {
        directions = new bool[](3);
        directions[0] = a;
        directions[1] = b;
        directions[2] = c;
    }

    function _singleRoundIds(uint256 roundId) internal pure returns (uint256[] memory roundIds) {
        roundIds = new uint256[](1);
        roundIds[0] = roundId;
    }
}
