// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { ClusterPayoutOracle } from "../contracts/ClusterPayoutOracle.sol";
import { IClusterPayoutOracle } from "../contracts/interfaces/IClusterPayoutOracle.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";

function _questionEpochSources(uint256 rewardPoolId, uint256 contentId, uint256 roundId)
    pure
    returns (IClusterPayoutOracle.CorrelationEpochSourceRef[] memory sources)
{
    sources = new IClusterPayoutOracle.CorrelationEpochSourceRef[](1);
    sources[0] = IClusterPayoutOracle.CorrelationEpochSourceRef({
        domain: 1, rewardPoolId: rewardPoolId, contentId: contentId, roundId: roundId
    });
}

function _ratingEpochSources(uint256 contentId, uint256 roundId)
    pure
    returns (IClusterPayoutOracle.CorrelationEpochSourceRef[] memory sources)
{
    sources = new IClusterPayoutOracle.CorrelationEpochSourceRef[](1);
    sources[0] = IClusterPayoutOracle.CorrelationEpochSourceRef({
        domain: 3, rewardPoolId: 0, contentId: contentId, roundId: roundId
    });
}

function _defaultEpochSources() pure returns (IClusterPayoutOracle.CorrelationEpochSourceRef[] memory sources) {
    return _questionEpochSources(7, 42, 3);
}

function _twoQuestionEpochSources(uint256 firstRoundId, uint256 secondRoundId)
    pure
    returns (IClusterPayoutOracle.CorrelationEpochSourceRef[] memory sources)
{
    sources = new IClusterPayoutOracle.CorrelationEpochSourceRef[](2);
    sources[0] = IClusterPayoutOracle.CorrelationEpochSourceRef({
        domain: 1, rewardPoolId: 7, contentId: 42, roundId: firstRoundId
    });
    sources[1] = IClusterPayoutOracle.CorrelationEpochSourceRef({
        domain: 1, rewardPoolId: 7, contentId: 42, roundId: secondRoundId
    });
}

contract ClusterPayoutOracleTest is Test {
    uint256 internal constant CHALLENGE_BOND = 5e6;
    address internal constant CHALLENGER = address(0xCA11);

    ClusterPayoutOracle internal oracle;
    MockFrontendRegistry internal frontendRegistry;
    MockRoundPayoutSnapshotConsumer internal questionConsumer;
    MockRoundPayoutSnapshotConsumer internal launchConsumer;
    MockRoundPayoutSnapshotConsumer internal ratingConsumer;
    MockERC20 internal usdc;

    receive() external payable { }

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        frontendRegistry = new MockFrontendRegistry();
        frontendRegistry.setEligible(address(this), true);
        oracle = new ClusterPayoutOracle(address(this), address(frontendRegistry), address(usdc));
        oracle.setOracleConfig(2 hours, CHALLENGE_BOND, address(this));
        questionConsumer = new MockRoundPayoutSnapshotConsumer();
        launchConsumer = new MockRoundPayoutSnapshotConsumer();
        ratingConsumer = new MockRoundPayoutSnapshotConsumer();
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), address(questionConsumer));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_LAUNCH_CREDIT(), address(launchConsumer));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_PUBLIC_RATING(), address(ratingConsumer));
        usdc.mint(address(this), 100e6);
        usdc.approve(address(oracle), type(uint256).max);
    }

    function _challengeCorrelationEpoch(uint64 epochId, bytes32 reasonHash) internal {
        usdc.mint(CHALLENGER, CHALLENGE_BOND);
        vm.startPrank(CHALLENGER);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        oracle.challengeCorrelationEpoch(epochId, reasonHash);
        vm.stopPrank();
    }

    function _challengeRoundPayoutSnapshot(bytes32 snapshotKey, bytes32 reasonHash) internal {
        usdc.mint(CHALLENGER, CHALLENGE_BOND);
        vm.startPrank(CHALLENGER);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        oracle.challengeRoundPayoutSnapshot(snapshotKey, reasonHash);
        vm.stopPrank();
    }

    function test_ConstructorRequiresFrontendRegistry() public {
        vm.expectRevert(ClusterPayoutOracle.InvalidAddress.selector);
        new ClusterPayoutOracle(address(this), address(0), address(usdc));

        vm.expectRevert(ClusterPayoutOracle.InvalidAddress.selector);
        new ClusterPayoutOracle(address(this), address(0xBEEF), address(usdc));

        vm.expectRevert(ClusterPayoutOracle.InvalidAddress.selector);
        new ClusterPayoutOracle(address(this), address(questionConsumer), address(usdc));
    }

    function test_ConstructorRequiresChallengeBondToken() public {
        vm.expectRevert(ClusterPayoutOracle.InvalidAddress.selector);
        new ClusterPayoutOracle(address(this), address(frontendRegistry), address(0));

        vm.expectRevert(ClusterPayoutOracle.InvalidAddress.selector);
        new ClusterPayoutOracle(address(this), address(frontendRegistry), address(0xBEEF));
    }

    function test_OnlyEligibleFrontendsCanProposeSnapshots() public {
        address ineligibleFrontend = address(0xFEE);

        vm.prank(ineligibleFrontend);
        vm.expectRevert(ClusterPayoutOracle.FrontendNotEligible.selector);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );

        frontendRegistry.setEligible(ineligibleFrontend, true);
        vm.prank(ineligibleFrontend);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );

        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        frontendRegistry.setEligible(ineligibleFrontend, false);
        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        vm.prank(ineligibleFrontend);
        vm.expectRevert(ClusterPayoutOracle.FrontendNotEligible.selector);
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function test_AuthorizedKeeperCanProposeSnapshotsForEligibleFrontend() public {
        address frontendOperator = address(0xFEE);
        address keeper = address(0xCAFE);

        frontendRegistry.setEligible(frontendOperator, true);
        frontendRegistry.setAuthorizedSnapshotFrontend(keeper, frontendOperator);

        vm.prank(keeper);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );

        ClusterPayoutOracle.CorrelationEpochSnapshot memory epoch = oracle.correlationEpochSnapshot(1);
        assertEq(epoch.proposer, keeper);
        assertEq(epoch.frontendOperator, frontendOperator);

        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        vm.prank(keeper);
        oracle.proposeRoundPayoutSnapshot(input);

        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        assertEq(proposal.proposer, keeper);
        assertEq(proposal.frontendOperator, frontendOperator);

        frontendRegistry.setEligible(frontendOperator, false);
        IClusterPayoutOracle.RoundPayoutSnapshotInput memory nextInput = _defaultRoundPayoutInput(1);
        nextInput.contentId = 10;
        vm.prank(keeper);
        vm.expectRevert(ClusterPayoutOracle.FrontendNotEligible.selector);
        oracle.proposeRoundPayoutSnapshot(nextInput);
    }

    function test_ProposalsDoNotAcceptEthBonds() public {
        vm.expectRevert(ClusterPayoutOracle.InvalidBond.selector);
        oracle.proposeCorrelationEpoch{ value: 1 }(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
    }

    function test_ProposeCorrelationEpochRejectsZeroArtifactHash() public {
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), bytes32(0), "ipfs://epoch", _defaultEpochSources()
        );
    }

    function test_ProposeRoundPayoutSnapshotRejectsZeroArtifactHash() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        input.artifactHash = bytes32(0);

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function test_ChallengeWindowCannotOutliveFrontendUnbondingBuffer() public {
        uint64 maxChallengeWindow = oracle.MAX_CHALLENGE_WINDOW();
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.setOracleConfig(maxChallengeWindow + 1, CHALLENGE_BOND, address(this));
    }

    function test_ChallengeBondCannotExceedAntiSpamCap() public {
        uint256 maxChallengeBond = oracle.MAX_CHALLENGE_BOND();
        oracle.setOracleConfig(2 hours, maxChallengeBond, address(this));
        assertEq(oracle.challengeBond(), maxChallengeBond);

        vm.expectRevert(ClusterPayoutOracle.InvalidBond.selector);
        oracle.setOracleConfig(2 hours, maxChallengeBond + 1, address(this));
    }

    function test_CorrelationEpochSourcesRequireConfiguredConsumer() public {
        ClusterPayoutOracle unconfiguredOracle =
            new ClusterPayoutOracle(address(this), address(frontendRegistry), address(usdc));
        unconfiguredOracle.setOracleConfig(2 hours, CHALLENGE_BOND, address(this));
        vm.expectRevert(ClusterPayoutOracle.InvalidAddress.selector);
        unconfiguredOracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
    }

    function test_SetRoundPayoutSnapshotConsumerRejectsInvalidConfig() public {
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.setRoundPayoutSnapshotConsumer(99, address(questionConsumer));

        uint8 questionRewardDomain = oracle.PAYOUT_DOMAIN_QUESTION_REWARD();
        vm.expectRevert(ClusterPayoutOracle.InvalidAddress.selector);
        oracle.setRoundPayoutSnapshotConsumer(questionRewardDomain, address(0xBEEF));
    }

    function test_SetFrontendRegistryRejectsInvalidConfig() public {
        vm.expectRevert(ClusterPayoutOracle.InvalidAddress.selector);
        oracle.setFrontendRegistry(address(0));

        vm.expectRevert(ClusterPayoutOracle.InvalidAddress.selector);
        oracle.setFrontendRegistry(address(0xBEEF));

        vm.expectRevert(ClusterPayoutOracle.InvalidAddress.selector);
        oracle.setFrontendRegistry(address(questionConsumer));

        MockFrontendRegistry replacement = new MockFrontendRegistry();
        replacement.setEligible(address(this), true);
        oracle.setFrontendRegistry(address(replacement));

        oracle.proposeCorrelationEpoch(
            100,
            1,
            20,
            keccak256("replacement-cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://ok",
            _defaultEpochSources()
        );
    }

    // M-Oracle-1: snapshot proposals must wait until the consumer signals the round source is
    // ready. Without this gate one eligible frontend could squat the slot at gas cost only and
    // censor honest payouts for the full challenge window. Verifies both the not-yet-ready
    // (sourceReadyAt == 0) and future-readyAt branches, plus the happy-path once ready.
    function test_RoundPayoutSnapshotProposalRequiresSourceReady() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);

        // sourceReadyAt == 0 → not ready
        questionConsumer.setSourceReadyAt(0);
        vm.expectRevert(ClusterPayoutOracle.SourceNotReady.selector);
        oracle.proposeRoundPayoutSnapshot(input);

        // sourceReadyAt in the future → not ready
        questionConsumer.setSourceReadyAt(uint64(block.timestamp + 1 hours));
        vm.expectRevert(ClusterPayoutOracle.SourceNotReady.selector);
        oracle.proposeRoundPayoutSnapshot(input);

        // sourceReadyAt at or before now → accepted
        questionConsumer.setSourceReadyAt(uint64(block.timestamp));
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function test_CorrelationEpochProposalRequiresSourcesReady() public {
        questionConsumer.setSourceReadyAt(0);
        vm.expectRevert(ClusterPayoutOracle.SourceNotReady.selector);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );

        questionConsumer.setSourceReadyAt(uint64(block.timestamp + 1 hours));
        vm.expectRevert(ClusterPayoutOracle.SourceNotReady.selector);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );

        questionConsumer.setSourceReadyAt(uint64(block.timestamp));
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
    }

    function test_CorrelationEpochCoverageRejectsDuplicatesAndOutOfRangeSources() public {
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _twoQuestionEpochSources(3, 3)
        );

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeCorrelationEpoch(
            1,
            10,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
    }

    function test_RoundSnapshotMustBeCoveredByCorrelationEpoch() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _questionEpochSources(7, 42, 4)
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        bytes32 defaultKey = oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 3);
        bytes32 coveredKey = oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 4);
        assertNotEq(defaultKey, coveredKey);
        assertEq(oracle.correlationEpochSnapshotCoverageDigest(1, defaultKey), bytes32(0));
        assertEq(oracle.correlationEpochSnapshotCoverageDigest(1, coveredKey), oracle.correlationEpochCoverageDigest(1));

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function test_ReproposedCorrelationEpochDoesNotInheritOldCoverage() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        oracle.rejectCorrelationEpoch(1, keccak256("replace-coverage"));

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("replacement-cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _questionEpochSources(7, 42, 4)
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function test_OptimisticEpochAndRoundSnapshotFinalizeAndVerifyLeaf() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );

        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.PayoutWeight memory payout = IClusterPayoutOracle.PayoutWeight({
            domain: oracle.PAYOUT_DOMAIN_QUESTION_REWARD(),
            rewardPoolId: 7,
            contentId: 42,
            roundId: 3,
            commitKey: keccak256("commit"),
            identityKey: keccak256("identity"),
            account: address(0xBEEF),
            baseWeight: 10_000,
            independenceBps: 2_500,
            effectiveWeight: 2_500,
            reasonHash: keccak256("reason")
        });
        bytes32 leaf = oracle.payoutWeightLeaf(payout);

        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: oracle.PAYOUT_DOMAIN_QUESTION_REWARD(),
                rewardPoolId: 7,
                contentId: 42,
                roundId: 3,
                correlationEpochId: 1,
                rawEligibleVoters: 4,
                effectiveParticipantUnits: 25_000,
                totalClaimWeight: 2_500,
                weightRoot: leaf,
                reasonRoot: keccak256("reason-root"),
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://round"
            })
        );

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 3);
        vm.warp(4 hours + 3);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        bytes32[] memory proof = new bytes32[](0);
        assertFalse(oracle.verifyPayoutWeight(payout, proof));
        vm.prank(address(questionConsumer));
        assertTrue(oracle.verifyPayoutWeight(payout, proof));

        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot =
            oracle.getRoundPayoutSnapshot(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 3);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
        assertEq(snapshot.totalClaimWeight, 2_500);
        assertEq(
            oracle.roundPayoutSnapshotConsumerFor(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 3),
            address(questionConsumer)
        );
    }

    function test_PublicRatingRoundSnapshotCanCoProposeWithCorrelationEpoch() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _ratingEpochSources(42, 3)
        );

        IClusterPayoutOracle.PayoutWeight memory payout = IClusterPayoutOracle.PayoutWeight({
            domain: oracle.PAYOUT_DOMAIN_PUBLIC_RATING(),
            rewardPoolId: 0,
            contentId: 42,
            roundId: 3,
            commitKey: keccak256("rating-commit"),
            identityKey: keccak256("rating-identity"),
            account: address(0xBEEF),
            baseWeight: 1_000_000,
            independenceBps: 10_000,
            effectiveWeight: 1_000_000,
            reasonHash: keccak256("rating-reason")
        });
        bytes32 leaf = oracle.payoutWeightLeaf(payout);

        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: oracle.PAYOUT_DOMAIN_PUBLIC_RATING(),
                rewardPoolId: 0,
                contentId: 42,
                roundId: 3,
                correlationEpochId: 1,
                rawEligibleVoters: 1,
                effectiveParticipantUnits: 10_000,
                totalClaimWeight: 1_000_000,
                weightRoot: leaf,
                reasonRoot: keccak256("rating-reason-root"),
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://rating-round"
            })
        );

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_PUBLIC_RATING(), 0, 42, 3);
        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(proposal.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(proposal.consumer, address(ratingConsumer));

        vm.warp(2 hours + 2);
        vm.expectRevert(ClusterPayoutOracle.SnapshotNotFinalizable.selector);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        oracle.finalizeCorrelationEpoch(1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot =
            oracle.getRoundPayoutSnapshot(oracle.PAYOUT_DOMAIN_PUBLIC_RATING(), 0, 42, 3);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
        assertEq(snapshot.totalClaimWeight, 1_000_000);
    }

    function test_PublicRatingRoundSnapshotRejectsZeroClaimWeight() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _ratingEpochSources(42, 3)
        );

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        input.domain = oracle.PAYOUT_DOMAIN_PUBLIC_RATING();
        input.rewardPoolId = 0;
        input.contentId = 42;
        input.roundId = 3;
        input.rawEligibleVoters = 1;
        input.effectiveParticipantUnits = 0;
        input.totalClaimWeight = 0;
        input.weightRoot = bytes32(0);

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function test_EmptyRoundPayoutSnapshotFinalizesButCannotVerifyClaims() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        input.rawEligibleVoters = 0;
        input.effectiveParticipantUnits = 0;
        input.totalClaimWeight = 0;
        input.weightRoot = bytes32(0);

        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        vm.warp(4 hours + 3);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot =
            oracle.getRoundPayoutSnapshot(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
        assertEq(snapshot.totalClaimWeight, 0);
        assertEq(snapshot.weightRoot, bytes32(0));

        IClusterPayoutOracle.PayoutWeight memory payout = IClusterPayoutOracle.PayoutWeight({
            domain: input.domain,
            rewardPoolId: input.rewardPoolId,
            contentId: input.contentId,
            roundId: input.roundId,
            commitKey: keccak256("commit"),
            identityKey: keccak256("identity"),
            account: address(0xBEEF),
            baseWeight: 10_000,
            independenceBps: 0,
            effectiveWeight: 1,
            reasonHash: keccak256("empty")
        });
        bytes32[] memory proof = new bytes32[](0);
        assertFalse(oracle.verifyPayoutWeight(payout, proof));
    }

    function test_RoundPayoutSnapshotRejectsInconsistentEmptyShape() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        input.totalClaimWeight = 0;
        input.effectiveParticipantUnits = 0;
        input.weightRoot = keccak256("non-empty-root");
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);

        input = _defaultRoundPayoutInput(1);
        input.totalClaimWeight = 0;
        input.effectiveParticipantUnits = 1;
        input.weightRoot = bytes32(0);
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);

        input = _defaultRoundPayoutInput(1);
        input.effectiveParticipantUnits = 25_000;
        input.totalClaimWeight = 2_500;
        input.weightRoot = bytes32(0);
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);

        input = _defaultRoundPayoutInput(1);
        input.effectiveParticipantUnits = 0;
        input.totalClaimWeight = 2_500;
        input.weightRoot = keccak256("non-empty-root");
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function test_RejectedEmptyRoundPayoutSnapshotBlacklistsEmptyRoot() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        input.rawEligibleVoters = 0;
        input.effectiveParticipantUnits = 0;
        input.totalClaimWeight = 0;
        input.weightRoot = bytes32(0);

        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        _challengeRoundPayoutSnapshot(snapshotKey, keccak256("bad-empty-root"));
        oracle.rejectRoundPayoutSnapshotRoot(snapshotKey, keccak256("bad-empty-root"));

        assertTrue(oracle.rejectedRoundPayoutSnapshotRoots(snapshotKey, bytes32(0)));

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function test_ChallengedEpochCannotFinalizeUntilArbiterRejectsIt() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        _challengeCorrelationEpoch(1, keccak256("bad-root"));

        vm.warp(2 hours + 2);
        vm.expectRevert(ClusterPayoutOracle.SnapshotChallenged.selector);
        oracle.finalizeCorrelationEpoch(1);

        oracle.rejectCorrelationEpochRoot(1, keccak256("bad-root"));
        ClusterPayoutOracle.CorrelationEpochSnapshot memory snapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Rejected));
        assertTrue(oracle.rejectedCorrelationEpochRoots(1, keccak256("cluster-root")));
    }

    function test_RejectedCorrelationEpochRootCannotReplayUnderDifferentEpochId() public {
        bytes32 clusterRoot = keccak256("cluster-root");
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            clusterRoot,
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        _challengeCorrelationEpoch(1, keccak256("bad-root"));
        oracle.rejectCorrelationEpochRoot(1, keccak256("bad-root"));

        bytes32 sourceSetDigest = oracle.correlationEpochSourceSetDigest(1);
        bytes32 rootKey = oracle.correlationEpochRootKey(sourceSetDigest, clusterRoot);
        assertTrue(oracle.rejectedCorrelationEpochRootKeys(rootKey));

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeCorrelationEpoch(
            2,
            1,
            20,
            clusterRoot,
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
    }

    function test_RejectedCorrelationEpochRootCannotReplayWithAlteredRange() public {
        bytes32 clusterRoot = keccak256("cluster-root");
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            clusterRoot,
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        _challengeCorrelationEpoch(1, keccak256("bad-root"));
        oracle.rejectCorrelationEpochRoot(1, keccak256("bad-root"));

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeCorrelationEpoch(
            2,
            1,
            21,
            clusterRoot,
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
    }

    function test_RejectedCorrelationEpochRootCannotReplayWithReorderedSources() public {
        bytes32 clusterRoot = keccak256("cluster-root");
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            clusterRoot,
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _twoQuestionEpochSources(3, 4)
        );
        _challengeCorrelationEpoch(1, keccak256("bad-root"));
        oracle.rejectCorrelationEpochRoot(1, keccak256("bad-root"));

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeCorrelationEpoch(
            2,
            1,
            20,
            clusterRoot,
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _twoQuestionEpochSources(4, 3)
        );
    }

    function test_FinalizedCorrelationEpochCanBeVetoedBeforeFutureChildProposals() public {
        bytes32 clusterRoot = keccak256("cluster-root");
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            clusterRoot,
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        oracle.rejectFinalizedCorrelationEpochRoot(1, keccak256("late-bad-root"));

        ClusterPayoutOracle.CorrelationEpochSnapshot memory snapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Rejected));
        assertTrue(oracle.rejectedCorrelationEpochRoots(1, clusterRoot));

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        vm.expectRevert(ClusterPayoutOracle.SnapshotNotFinalizable.selector);
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function test_FinalizedCorrelationEpochVetoWindowExpires() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        vm.warp(block.timestamp + oracle.FINALIZATION_VETO_WINDOW() + 1);
        vm.expectRevert(ClusterPayoutOracle.SnapshotNotFinalizable.selector);
        oracle.rejectFinalizedCorrelationEpoch(1, keccak256("too-late"));
    }

    function test_RejectedFinalizedCorrelationEpochBlocksChildFinalization() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );

        oracle.rejectFinalizedCorrelationEpoch(1, keccak256("bad-parent"));

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("replacement-cluster-root"),
            keccak256("params"),
            keccak256("replacement-epoch-artifact"),
            "ipfs://epoch-replacement",
            _defaultEpochSources()
        );
        vm.warp(6 hours + 4);
        oracle.finalizeCorrelationEpoch(1);

        vm.warp(block.timestamp + 2 hours + 1);
        vm.expectRevert(ClusterPayoutOracle.SnapshotNotFinalizable.selector);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);
    }

    function test_RejectedFinalizedCorrelationEpochBlocksChallengedChildFinalization() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        _challengeRoundPayoutSnapshot(snapshotKey, keccak256("bad-child"));

        oracle.rejectFinalizedCorrelationEpoch(1, keccak256("bad-parent"));

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("replacement-cluster-root"),
            keccak256("params"),
            keccak256("replacement-epoch-artifact"),
            "ipfs://epoch-replacement",
            _defaultEpochSources()
        );
        vm.warp(block.timestamp + 2 hours + 1);
        oracle.finalizeCorrelationEpoch(1);

        vm.expectRevert(ClusterPayoutOracle.SnapshotNotFinalizable.selector);
        oracle.finalizeChallengedRoundPayoutSnapshot(snapshotKey, keccak256("dismiss-child-challenge"));
    }

    function test_RejectedFinalizedCorrelationEpochBlocksFuturePayoutVerification() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.PayoutWeight memory payout = IClusterPayoutOracle.PayoutWeight({
            domain: oracle.PAYOUT_DOMAIN_QUESTION_REWARD(),
            rewardPoolId: 7,
            contentId: 42,
            roundId: 3,
            commitKey: keccak256("commit"),
            identityKey: keccak256("identity"),
            account: address(0xBEEF),
            baseWeight: 10_000,
            independenceBps: 2_500,
            effectiveWeight: 2_500,
            reasonHash: keccak256("reason")
        });
        bytes32 leaf = oracle.payoutWeightLeaf(payout);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = IClusterPayoutOracle.RoundPayoutSnapshotInput({
            domain: oracle.PAYOUT_DOMAIN_QUESTION_REWARD(),
            rewardPoolId: 7,
            contentId: 42,
            roundId: 3,
            correlationEpochId: 1,
            rawEligibleVoters: 4,
            effectiveParticipantUnits: 25_000,
            totalClaimWeight: 2_500,
            weightRoot: leaf,
            reasonRoot: keccak256("reason-root"),
            artifactHash: keccak256("epoch-artifact"),
            artifactURI: "ipfs://round"
        });
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        vm.warp(block.timestamp + 2 hours + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        bytes32[] memory proof = new bytes32[](0);
        vm.prank(address(questionConsumer));
        assertTrue(oracle.verifyPayoutWeight(payout, proof));

        oracle.rejectFinalizedCorrelationEpoch(1, keccak256("bad-parent"));

        vm.prank(address(questionConsumer));
        assertFalse(oracle.verifyPayoutWeight(payout, proof));

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("replacement-cluster-root"),
            keccak256("params"),
            keccak256("replacement-epoch-artifact"),
            "ipfs://epoch-replacement",
            _defaultEpochSources()
        );
        vm.warp(6 hours + 4);
        oracle.finalizeCorrelationEpoch(1);

        assertFalse(
            oracle.isRoundPayoutSnapshotFinalized(
                oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
            )
        );
        IClusterPayoutOracle.RoundPayoutSnapshot memory staleSnapshot = oracle.getRoundPayoutSnapshot(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        assertEq(uint8(staleSnapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Rejected));

        vm.prank(address(questionConsumer));
        assertFalse(oracle.verifyPayoutWeight(payout, proof));
    }

    function test_StaleFinalizedRoundPayoutSnapshotCanBeReplacedWhenUnconsumed() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        vm.warp(block.timestamp + 2 hours + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);
        bytes32 staleDigest = oracle.roundPayoutSnapshotProposalDigest(snapshotKey);

        oracle.rejectFinalizedCorrelationEpoch(1, keccak256("bad-parent"));
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("replacement-cluster-root"),
            keccak256("params"),
            keccak256("replacement-epoch-artifact"),
            "ipfs://epoch-replacement",
            _defaultEpochSources()
        );
        vm.warp(6 hours + 4);
        oracle.finalizeCorrelationEpoch(1);

        input.artifactHash = keccak256("replacement-epoch-artifact");
        input.weightRoot = keccak256("replacement-weight-root");
        input.reasonRoot = keccak256("replacement-reason-root");
        input.artifactURI = "ipfs://round-replacement";
        oracle.proposeRoundPayoutSnapshot(input);

        assertTrue(oracle.rejectedRoundPayoutSnapshotDigests(snapshotKey, staleDigest));
        ClusterPayoutOracle.RoundPayoutProposal memory replacement = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(replacement.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(replacement.snapshot.weightRoot, input.weightRoot);
        assertEq(replacement.artifactHash, keccak256("replacement-epoch-artifact"));
    }

    function test_StaleFinalizedRoundPayoutSnapshotCannotBeReplacedWhenConsumed() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        vm.warp(block.timestamp + 2 hours + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        oracle.rejectFinalizedCorrelationEpoch(1, keccak256("bad-parent"));
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("replacement-cluster-root"),
            keccak256("params"),
            keccak256("replacement-epoch-artifact"),
            "ipfs://epoch-replacement",
            _defaultEpochSources()
        );
        vm.warp(6 hours + 4);
        oracle.finalizeCorrelationEpoch(1);

        questionConsumer.setConsumed(true);
        input.artifactHash = keccak256("replacement-epoch-artifact");
        input.weightRoot = keccak256("replacement-weight-root");
        vm.expectRevert(ClusterPayoutOracle.SnapshotConsumed.selector);
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function test_RejectedFinalizedCorrelationEpochCanBeReplacedWithDifferentRoot() public {
        bytes32 badRoot = keccak256("bad-cluster-root");
        oracle.proposeCorrelationEpoch(
            1, 1, 20, badRoot, keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch", _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);
        oracle.rejectFinalizedCorrelationEpochRoot(1, keccak256("bad-root"));

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeCorrelationEpoch(
            1, 1, 20, badRoot, keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch", _defaultEpochSources()
        );

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("replacement-cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch-replacement",
            _defaultEpochSources()
        );
        vm.warp(block.timestamp + 2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        ClusterPayoutOracle.CorrelationEpochSnapshot memory snapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
        assertEq(snapshot.clusterRoot, keccak256("replacement-cluster-root"));
    }

    function test_MetadataOnlyFinalizedCorrelationEpochRejectionAllowsCorrectedSameRoot() public {
        bytes32 clusterRoot = keccak256("cluster-root");
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            clusterRoot,
            keccak256("params"),
            keccak256("bad-epoch-artifact"),
            "ipfs://bad-epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        bytes32 rejectedDigest = oracle.correlationEpochProposalDigest(1);
        oracle.rejectFinalizedCorrelationEpoch(1, keccak256("bad-metadata"));

        assertTrue(oracle.rejectedCorrelationEpochSnapshotDigests(1, rejectedDigest));
        assertFalse(oracle.rejectedCorrelationEpochRoots(1, clusterRoot));

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            clusterRoot,
            keccak256("params"),
            keccak256("bad-epoch-artifact"),
            "ipfs://bad-epoch",
            _defaultEpochSources()
        );

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            clusterRoot,
            keccak256("params"),
            keccak256("corrected-epoch-artifact"),
            "ipfs://corrected-epoch",
            _defaultEpochSources()
        );
        vm.warp(block.timestamp + 2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        ClusterPayoutOracle.CorrelationEpochSnapshot memory snapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
        assertEq(snapshot.clusterRoot, clusterRoot);
        assertEq(snapshot.artifactHash, keccak256("corrected-epoch-artifact"));
    }

    function test_MetadataOnlyFinalizedCorrelationEpochRejectionAllowsCorrectedUriSameRootAndHash() public {
        bytes32 clusterRoot = keccak256("cluster-root");
        bytes32 artifactHash = keccak256("epoch-artifact");
        oracle.proposeCorrelationEpoch(
            1, 1, 20, clusterRoot, keccak256("params"), artifactHash, "ipfs://bad-epoch-uri", _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        bytes32 rejectedDigest = oracle.correlationEpochProposalDigest(1);
        oracle.rejectFinalizedCorrelationEpoch(1, keccak256("bad-uri"));

        assertTrue(oracle.rejectedCorrelationEpochSnapshotDigests(1, rejectedDigest));
        assertFalse(oracle.rejectedCorrelationEpochRoots(1, clusterRoot));

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeCorrelationEpoch(
            1, 1, 20, clusterRoot, keccak256("params"), artifactHash, "ipfs://bad-epoch-uri", _defaultEpochSources()
        );

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            clusterRoot,
            keccak256("params"),
            artifactHash,
            "ipfs://corrected-epoch-uri",
            _defaultEpochSources()
        );
        assertTrue(oracle.correlationEpochProposalDigest(1) != rejectedDigest);
        vm.warp(block.timestamp + 2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        ClusterPayoutOracle.CorrelationEpochSnapshot memory snapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
        assertEq(snapshot.clusterRoot, clusterRoot);
        assertEq(snapshot.artifactHash, artifactHash);
        assertEq(snapshot.artifactURI, "ipfs://corrected-epoch-uri");
    }

    function test_MetadataOnlyCorrelationEpochRejectionAllowsCorrectedSameRoot() public {
        address squatter = address(0xBAD);
        frontendRegistry.setEligible(squatter, true);

        bytes32 honestRoot = keccak256("honest-cluster-root");

        vm.prank(squatter);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            honestRoot,
            keccak256("params"),
            keccak256("bad-epoch-artifact"),
            "ipfs://bad-epoch",
            _defaultEpochSources()
        );

        bytes32 rejectedDigest = oracle.correlationEpochProposalDigest(1);
        oracle.rejectCorrelationEpoch(1, keccak256("bad-metadata"));

        assertTrue(oracle.rejectedCorrelationEpochSnapshotDigests(1, rejectedDigest));
        assertFalse(oracle.rejectedCorrelationEpochRoots(1, honestRoot));
        assertFalse(
            oracle.rejectedCorrelationEpochRootKeys(
                oracle.correlationEpochRootKey(oracle.correlationEpochSourceSetDigest(1), honestRoot)
            )
        );

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            honestRoot,
            keccak256("params"),
            keccak256("bad-epoch-artifact"),
            "ipfs://bad-epoch",
            _defaultEpochSources()
        );

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            honestRoot,
            keccak256("params"),
            keccak256("corrected-epoch-artifact"),
            "ipfs://corrected-epoch",
            _defaultEpochSources()
        );

        vm.warp(block.timestamp + 2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);
        ClusterPayoutOracle.CorrelationEpochSnapshot memory finalSnapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(finalSnapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
    }

    function test_MetadataOnlyCorrelationEpochRejectionAllowsCorrectedUriSameRootAndHash() public {
        address squatter = address(0xBAD);
        frontendRegistry.setEligible(squatter, true);

        bytes32 clusterRoot = keccak256("honest-cluster-root");
        bytes32 artifactHash = keccak256("epoch-artifact");

        vm.prank(squatter);
        oracle.proposeCorrelationEpoch(
            1, 1, 20, clusterRoot, keccak256("params"), artifactHash, "ipfs://bad-epoch-uri", _defaultEpochSources()
        );

        bytes32 rejectedDigest = oracle.correlationEpochProposalDigest(1);
        oracle.rejectCorrelationEpoch(1, keccak256("bad-uri"));

        assertTrue(oracle.rejectedCorrelationEpochSnapshotDigests(1, rejectedDigest));
        assertFalse(oracle.rejectedCorrelationEpochRoots(1, clusterRoot));

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeCorrelationEpoch(
            1, 1, 20, clusterRoot, keccak256("params"), artifactHash, "ipfs://bad-epoch-uri", _defaultEpochSources()
        );

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            clusterRoot,
            keccak256("params"),
            artifactHash,
            "ipfs://corrected-epoch-uri",
            _defaultEpochSources()
        );
        assertTrue(oracle.correlationEpochProposalDigest(1) != rejectedDigest);

        vm.warp(block.timestamp + 2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);
        ClusterPayoutOracle.CorrelationEpochSnapshot memory finalSnapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(finalSnapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
        assertEq(finalSnapshot.clusterRoot, clusterRoot);
        assertEq(finalSnapshot.artifactHash, artifactHash);
        assertEq(finalSnapshot.artifactURI, "ipfs://corrected-epoch-uri");
    }

    function test_ChallengesPullConfiguredUsdcBond() public {
        address challenger = address(0xCA11);
        usdc.mint(challenger, CHALLENGE_BOND);

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );

        vm.prank(challenger);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        vm.prank(challenger);
        oracle.challengeCorrelationEpoch(1, keccak256("bad-root"));

        ClusterPayoutOracle.CorrelationEpochSnapshot memory snapshot = oracle.correlationEpochSnapshot(1);
        assertEq(snapshot.challenger, challenger);
        assertEq(snapshot.bond, CHALLENGE_BOND);
        assertEq(usdc.balanceOf(challenger), 0);
        assertEq(usdc.balanceOf(address(oracle)), CHALLENGE_BOND);
    }

    function test_ChallengeRejectsShortUsdcBondReceipt() public {
        address challenger = address(0xCA11);
        usdc.mint(challenger, CHALLENGE_BOND);

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );

        usdc.setTransferShortfall(1);

        vm.startPrank(challenger);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        vm.expectRevert(ClusterPayoutOracle.InvalidBond.selector);
        oracle.challengeCorrelationEpoch(1, keccak256("bad-root"));
        vm.stopPrank();

        ClusterPayoutOracle.CorrelationEpochSnapshot memory snapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(snapshot.bond, 0);
        assertEq(usdc.balanceOf(address(oracle)), 0);
    }

    function test_RoundPayoutChallengeRejectsShortUsdcBondReceipt() public {
        address challenger = address(0xCA11);
        usdc.mint(challenger, CHALLENGE_BOND);

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);

        usdc.setTransferShortfall(1);

        vm.startPrank(challenger);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        vm.expectRevert(ClusterPayoutOracle.InvalidBond.selector);
        oracle.challengeRoundPayoutSnapshot(snapshotKey, keccak256("bad-round-root"));
        vm.stopPrank();

        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot =
            oracle.getRoundPayoutSnapshot(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(usdc.balanceOf(address(oracle)), 0);
    }

    function test_ProposerCannotChallengeOwnCorrelationEpoch() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.challengeCorrelationEpoch(1, keccak256("self-challenge"));
    }

    function test_ProposerCannotChallengeOwnRoundPayoutSnapshot() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.challengeRoundPayoutSnapshot(snapshotKey, keccak256("self-challenge"));
    }

    function test_FrontendCannotChallengeKeeperCorrelationEpoch() public {
        address frontendOperator = address(0xFEE);
        address keeper = address(0xCAFE);

        frontendRegistry.setEligible(frontendOperator, true);
        frontendRegistry.setAuthorizedSnapshotFrontend(keeper, frontendOperator);

        vm.prank(keeper);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );

        usdc.mint(frontendOperator, CHALLENGE_BOND);
        vm.startPrank(frontendOperator);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.challengeCorrelationEpoch(1, keccak256("self-frontend-challenge"));
        vm.stopPrank();
    }

    function test_AuthorizedKeeperCannotChallengeFrontendRoundPayoutSnapshot() public {
        address frontendOperator = address(0xFEE);
        address keeper = address(0xCAFE);

        frontendRegistry.setEligible(frontendOperator, true);
        frontendRegistry.setAuthorizedSnapshotFrontend(keeper, frontendOperator);

        vm.prank(frontendOperator);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        vm.prank(frontendOperator);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);

        usdc.mint(keeper, CHALLENGE_BOND);
        vm.startPrank(keeper);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.challengeRoundPayoutSnapshot(snapshotKey, keccak256("authorized-keeper-challenge"));
        vm.stopPrank();
    }

    function test_FormerKeeperCannotChallengeFrontendCorrelationEpochAfterRotationButUnrelatedCan() public {
        address frontendOperator = address(0xFEE);
        address keeper = address(0xCAFE);
        address replacementKeeper = address(0xBEEF);
        address unrelatedChallenger = address(0xCA11CE);

        frontendRegistry.setEligible(frontendOperator, true);
        frontendRegistry.setAuthorizedSnapshotFrontend(keeper, frontendOperator);

        vm.prank(frontendOperator);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        assertEq(oracle.correlationEpochSnapshot(1).proposalTimeSnapshotProposer, keeper);

        frontendRegistry.setAuthorizedSnapshotFrontend(replacementKeeper, frontendOperator);
        assertFalse(frontendRegistry.isAuthorizedSnapshotProposer(frontendOperator, keeper));

        usdc.mint(keeper, CHALLENGE_BOND);
        vm.startPrank(keeper);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.challengeCorrelationEpoch(1, keccak256("former-keeper-challenge"));
        vm.stopPrank();

        usdc.mint(unrelatedChallenger, CHALLENGE_BOND);
        vm.startPrank(unrelatedChallenger);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        oracle.challengeCorrelationEpoch(1, keccak256("independent-challenge"));
        vm.stopPrank();

        assertEq(oracle.correlationEpochSnapshot(1).challenger, unrelatedChallenger);
    }

    function test_FormerKeeperCannotChallengeFrontendRoundPayoutAfterClearButUnrelatedCan() public {
        address frontendOperator = address(0xFEE);
        address keeper = address(0xCAFE);
        address unrelatedChallenger = address(0xCA11CE);

        frontendRegistry.setEligible(frontendOperator, true);
        frontendRegistry.setAuthorizedSnapshotFrontend(keeper, frontendOperator);

        vm.prank(frontendOperator);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        vm.prank(frontendOperator);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        assertEq(oracle.roundPayoutProposal(snapshotKey).proposalTimeSnapshotProposer, keeper);

        frontendRegistry.clearAuthorizedSnapshotFrontend(frontendOperator);

        usdc.mint(keeper, CHALLENGE_BOND);
        vm.startPrank(keeper);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.challengeRoundPayoutSnapshot(snapshotKey, keccak256("former-keeper-challenge"));
        vm.stopPrank();

        usdc.mint(unrelatedChallenger, CHALLENGE_BOND);
        vm.startPrank(unrelatedChallenger);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        oracle.challengeRoundPayoutSnapshot(snapshotKey, keccak256("independent-challenge"));
        vm.stopPrank();

        assertEq(oracle.roundPayoutProposal(snapshotKey).challenger, unrelatedChallenger);
    }

    function test_RotatedKeeperCanChallengePriorKeeperCorrelationEpoch() public {
        address frontendOperator = address(0xFEE);
        address firstKeeper = address(0xCAFE);
        address secondKeeper = address(0xBEEF);

        frontendRegistry.setEligible(frontendOperator, true);
        frontendRegistry.setAuthorizedSnapshotFrontend(firstKeeper, frontendOperator);

        vm.prank(firstKeeper);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );

        frontendRegistry.setAuthorizedSnapshotFrontend(secondKeeper, frontendOperator);

        usdc.mint(secondKeeper, CHALLENGE_BOND);
        vm.startPrank(secondKeeper);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        oracle.challengeCorrelationEpoch(1, keccak256("rotated-keeper-challenge"));
        vm.stopPrank();

        ClusterPayoutOracle.CorrelationEpochSnapshot memory snapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Challenged));
        assertEq(snapshot.challenger, secondKeeper);
    }

    function test_PostProposalSnapshotProposerAssignmentCannotCensorCorrelationEpochChallenge() public {
        address frontendOperator = address(0xFEE);
        address challenger = address(0xCA11CE);

        frontendRegistry.setEligible(frontendOperator, true);

        vm.prank(frontendOperator);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );

        assertEq(oracle.correlationEpochSnapshot(1).proposalTimeSnapshotProposer, address(0));
        frontendRegistry.setAuthorizedSnapshotFrontend(challenger, frontendOperator);
        assertTrue(frontendRegistry.isAuthorizedSnapshotProposer(frontendOperator, challenger));

        usdc.mint(challenger, CHALLENGE_BOND);
        vm.startPrank(challenger);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        oracle.challengeCorrelationEpoch(1, keccak256("post-proposal-assignee-challenge"));
        vm.stopPrank();

        ClusterPayoutOracle.CorrelationEpochSnapshot memory snapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Challenged));
        assertEq(snapshot.challenger, challenger);
    }

    function test_PostProposalSnapshotProposerAssignmentCannotCensorRoundPayoutChallenge() public {
        address frontendOperator = address(0xFEE);
        address challenger = address(0xCA11CE);

        frontendRegistry.setEligible(frontendOperator, true);

        vm.prank(frontendOperator);
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        vm.prank(frontendOperator);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);

        assertEq(oracle.roundPayoutProposal(snapshotKey).proposalTimeSnapshotProposer, address(0));
        frontendRegistry.setAuthorizedSnapshotFrontend(challenger, frontendOperator);
        assertTrue(frontendRegistry.isAuthorizedSnapshotProposer(frontendOperator, challenger));

        usdc.mint(challenger, CHALLENGE_BOND);
        vm.startPrank(challenger);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        oracle.challengeRoundPayoutSnapshot(snapshotKey, keccak256("post-proposal-assignee-challenge"));
        vm.stopPrank();

        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(proposal.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Challenged));
        assertEq(proposal.challenger, challenger);
    }

    function test_ChallengesRequireUsdcApprovalAndRejectNativeToken() public {
        address challenger = address(0xCA11);
        usdc.mint(challenger, CHALLENGE_BOND);
        vm.deal(challenger, 1 ether);

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );

        vm.prank(challenger);
        vm.expectRevert();
        oracle.challengeCorrelationEpoch(1, keccak256("bad-root"));

        vm.prank(challenger);
        vm.expectRevert(ClusterPayoutOracle.InvalidBond.selector);
        oracle.challengeCorrelationEpoch{ value: 1 }(1, keccak256("bad-root"));
    }

    function test_ArbiterCanFinalizeChallengedSnapshots() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        _challengeCorrelationEpoch(1, keccak256("invalid-challenge"));
        oracle.finalizeChallengedCorrelationEpoch(1, keccak256("challenge-dismissed"));

        ClusterPayoutOracle.CorrelationEpochSnapshot memory epoch = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(epoch.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));

        IClusterPayoutOracle.PayoutWeight memory payout = IClusterPayoutOracle.PayoutWeight({
            domain: oracle.PAYOUT_DOMAIN_QUESTION_REWARD(),
            rewardPoolId: 7,
            contentId: 42,
            roundId: 3,
            commitKey: keccak256("commit"),
            identityKey: keccak256("identity"),
            account: address(0xBEEF),
            baseWeight: 10_000,
            independenceBps: 2_500,
            effectiveWeight: 2_500,
            reasonHash: keccak256("reason")
        });
        bytes32 leaf = oracle.payoutWeightLeaf(payout);

        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: oracle.PAYOUT_DOMAIN_QUESTION_REWARD(),
                rewardPoolId: 7,
                contentId: 42,
                roundId: 3,
                correlationEpochId: 1,
                rawEligibleVoters: 4,
                effectiveParticipantUnits: 25_000,
                totalClaimWeight: 2_500,
                weightRoot: leaf,
                reasonRoot: keccak256("reason-root"),
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://round"
            })
        );
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 3);
        _challengeRoundPayoutSnapshot(snapshotKey, keccak256("invalid-round-challenge"));
        oracle.finalizeChallengedRoundPayoutSnapshot(snapshotKey, keccak256("round-challenge-dismissed"));

        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot =
            oracle.getRoundPayoutSnapshot(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 3);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(address(questionConsumer));
        assertTrue(oracle.verifyPayoutWeight(payout, proof));
    }

    function test_ChallengesCloseWhenSnapshotIsFinalizable() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );

        vm.warp(2 hours + 2);
        vm.expectRevert(ClusterPayoutOracle.SnapshotNotFinalizable.selector);
        oracle.challengeCorrelationEpoch(1, keccak256("late-challenge"));

        oracle.finalizeCorrelationEpoch(1);

        uint8 questionRewardDomain = oracle.PAYOUT_DOMAIN_QUESTION_REWARD();
        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: questionRewardDomain,
                rewardPoolId: 7,
                contentId: 42,
                roundId: 3,
                correlationEpochId: 1,
                rawEligibleVoters: 4,
                effectiveParticipantUnits: 25_000,
                totalClaimWeight: 2_500,
                weightRoot: keccak256("leaf"),
                reasonRoot: keccak256("reason-root"),
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://round"
            })
        );
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(questionRewardDomain, 7, 42, 3);

        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(ClusterPayoutOracle.SnapshotNotFinalizable.selector);
        oracle.challengeRoundPayoutSnapshot(snapshotKey, keccak256("late-round-challenge"));
    }

    function test_ChallengeBondCreditsAccumulateUntilWithdrawal() public {
        BondChallengeForwarder challenger = new BondChallengeForwarder();
        usdc.mint(address(challenger), 100e6);

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        challenger.challengeCorrelationEpoch(usdc, oracle, 1, keccak256("bad-root"));
        oracle.rejectCorrelationEpoch(1, keccak256("bad-root"));
        assertEq(oracle.pendingBondWithdrawals(address(challenger)), CHALLENGE_BOND);

        oracle.proposeCorrelationEpoch(
            2,
            1,
            20,
            keccak256("cluster-root-2"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(2);

        uint8 questionRewardDomain = oracle.PAYOUT_DOMAIN_QUESTION_REWARD();
        oracle.proposeRoundPayoutSnapshot(_defaultRoundPayoutInput(2));
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(questionRewardDomain, 7, 42, 3);
        challenger.challengeRoundPayoutSnapshot(usdc, oracle, snapshotKey, keccak256("bad-round"));
        oracle.rejectRoundPayoutSnapshot(snapshotKey, keccak256("bad-round"));

        assertEq(oracle.pendingBondWithdrawals(address(challenger)), 2 * CHALLENGE_BOND);

        address recipient = address(0xB0B0);
        vm.prank(address(challenger));
        oracle.withdrawBondCreditTo(recipient);
        assertEq(oracle.pendingBondWithdrawals(address(challenger)), 0);
        assertEq(usdc.balanceOf(recipient), 2 * CHALLENGE_BOND);
    }

    function test_RejectedSnapshotPayloadCanBeReplacedWithSameRootAndCorrectedMetadata() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("bad-cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        _challengeCorrelationEpoch(1, keccak256("bad-root"));
        oracle.rejectCorrelationEpoch(1, keccak256("bad-root"));

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("replacement-cluster-root"),
            keccak256("params"),
            keccak256("replacement-epoch-artifact"),
            "ipfs://epoch-replacement",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.PayoutWeight memory payout = IClusterPayoutOracle.PayoutWeight({
            domain: oracle.PAYOUT_DOMAIN_QUESTION_REWARD(),
            rewardPoolId: 7,
            contentId: 42,
            roundId: 3,
            commitKey: keccak256("commit"),
            identityKey: keccak256("identity"),
            account: address(0xBEEF),
            baseWeight: 10_000,
            independenceBps: 1_000,
            effectiveWeight: 1_000,
            reasonHash: keccak256("reason")
        });

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = IClusterPayoutOracle.RoundPayoutSnapshotInput({
            domain: oracle.PAYOUT_DOMAIN_QUESTION_REWARD(),
            rewardPoolId: 7,
            contentId: 42,
            roundId: 3,
            correlationEpochId: 1,
            rawEligibleVoters: 4,
            effectiveParticipantUnits: 10_000,
            totalClaimWeight: 1_000,
            weightRoot: oracle.payoutWeightLeaf(payout),
            reasonRoot: keccak256("bad-reason-root"),
            artifactHash: keccak256("replacement-epoch-artifact"),
            artifactURI: "ipfs://round"
        });
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 3);
        _challengeRoundPayoutSnapshot(snapshotKey, keccak256("bad-round"));
        oracle.rejectRoundPayoutSnapshot(snapshotKey, keccak256("bad-round"));

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);

        input.rawEligibleVoters = 5;
        input.effectiveParticipantUnits = 10_001;
        input.totalClaimWeight = 1_001;
        input.reasonRoot = keccak256("replacement-reason-root");
        input.artifactURI = "ipfs://round-replacement";
        oracle.proposeRoundPayoutSnapshot(input);

        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(proposal.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(proposal.snapshot.weightRoot, oracle.payoutWeightLeaf(payout));
        assertEq(proposal.snapshot.totalClaimWeight, 1_001);
    }

    function test_RejectedSnapshotRootCannotBeReproposed() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("bad-cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        _challengeCorrelationEpoch(1, keccak256("bad-root"));
        oracle.rejectCorrelationEpoch(1, keccak256("bad-root"));

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("replacement-cluster-root"),
            keccak256("params"),
            keccak256("replacement-epoch-artifact"),
            "ipfs://epoch-replacement",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        input.artifactHash = keccak256("replacement-epoch-artifact");
        input.weightRoot = keccak256("bad-weight-root");
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        _challengeRoundPayoutSnapshot(snapshotKey, keccak256("bad-round-root"));
        oracle.rejectRoundPayoutSnapshotRoot(snapshotKey, keccak256("bad-round-root"));

        assertTrue(oracle.rejectedRoundPayoutSnapshotRoots(snapshotKey, input.weightRoot));
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);

        input.weightRoot = keccak256("replacement-weight-root");
        oracle.proposeRoundPayoutSnapshot(input);

        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(proposal.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(proposal.snapshot.weightRoot, keccak256("replacement-weight-root"));
    }

    function test_FinalizedRoundPayoutSnapshotCanBeRejectedWhenConsumerHasNotAppliedIt() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        vm.warp(block.timestamp + 2 hours + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("bad-finalized-root"));

        ClusterPayoutOracle.RoundPayoutProposal memory rejected = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(rejected.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Rejected));

        input.artifactHash = keccak256("epoch-artifact");
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);

        input.rawEligibleVoters = 5;
        input.effectiveParticipantUnits = 25_001;
        input.totalClaimWeight = 2_501;
        input.artifactURI = "ipfs://round-corrected";
        oracle.proposeRoundPayoutSnapshot(input);
        ClusterPayoutOracle.RoundPayoutProposal memory replacement = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(replacement.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(replacement.artifactHash, keccak256("epoch-artifact"));
        assertEq(replacement.consumer, address(questionConsumer));
        assertEq(replacement.snapshot.weightRoot, input.weightRoot);
        assertEq(replacement.snapshot.totalClaimWeight, 2_501);
    }

    function test_FinalizedRoundPayoutSnapshotRejectChecksConsumerAfterVetoWindow() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        vm.warp(block.timestamp + 2 hours + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        questionConsumer.setConsumed(true);

        // Past the veto window, the consumed flag locks rejection.
        vm.warp(block.timestamp + oracle.FINALIZATION_VETO_WINDOW() + 1);
        vm.expectRevert(ClusterPayoutOracle.SnapshotConsumed.selector);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("consumed"));
    }

    function test_FinalizedRoundPayoutSnapshotRejectAllowedWithinVetoWindowEvenIfConsumed() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        vm.warp(block.timestamp + 2 hours + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        questionConsumer.setConsumed(true);

        // Within the veto window the arbiter can still reject even after a claim landed.
        // Already-paid leaves stay paid; future claims revert via verifyPayoutWeight.
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("consumed"));
        ClusterPayoutOracle.RoundPayoutProposal memory rejected = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(rejected.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Rejected));
        assertTrue(oracle.rejectedRoundPayoutSnapshotConsumed(snapshotKey));

        input.artifactHash = keccak256("replacement-after-consumed");
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);

        input.weightRoot = keccak256("replacement-after-consumed-root");
        input.artifactHash = keccak256("epoch-artifact");
        vm.expectRevert(ClusterPayoutOracle.SnapshotConsumed.selector);
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function test_FinalizedRoundPayoutSnapshotRejectUsesSnapshottedConsumerAfterRotation() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        vm.warp(block.timestamp + 2 hours + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        MockRoundPayoutSnapshotConsumer replacementConsumer = new MockRoundPayoutSnapshotConsumer();
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), address(replacementConsumer));
        questionConsumer.setConsumed(true);

        // Past the veto window the original consumer (snapshotted on the proposal) still gates
        // the rejection; rotating to a fresh consumer does not bypass the consumed flag.
        vm.warp(block.timestamp + oracle.FINALIZATION_VETO_WINDOW() + 1);
        vm.expectRevert(ClusterPayoutOracle.SnapshotConsumed.selector);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("snapshotted-consumer"));
    }

    function test_FinalizedRoundPayoutSnapshotRejectAllowedPostVetoWhenConsumerViewReverts() public {
        RevertingConsumedRoundPayoutSnapshotConsumer revertingConsumer = new RevertingConsumedRoundPayoutSnapshotConsumer();
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), address(revertingConsumer));

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        vm.warp(block.timestamp + 2 hours + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        vm.warp(block.timestamp + oracle.FINALIZATION_VETO_WINDOW() + 1);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("broken-consumer-view"));
        ClusterPayoutOracle.RoundPayoutProposal memory rejected = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(rejected.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Rejected));
        assertFalse(oracle.rejectedRoundPayoutSnapshotConsumed(snapshotKey));
    }

    function test_FinalizedRoundPayoutSnapshotReproposalAllowedWhenConsumerViewReverts() public {
        RevertingConsumedRoundPayoutSnapshotConsumer revertingConsumer = new RevertingConsumedRoundPayoutSnapshotConsumer();
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), address(revertingConsumer));

        bytes32 firstArtifact = keccak256("epoch-artifact");
        _proposeDefaultCorrelationEpoch(1, keccak256("cluster-root"), firstArtifact);
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        vm.warp(block.timestamp + 2 hours + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        oracle.rejectFinalizedCorrelationEpoch(1, keccak256("bad-parent"));

        bytes32 replacementArtifact = keccak256("epoch-artifact-v2");
        _proposeDefaultCorrelationEpoch(1, keccak256("cluster-root"), replacementArtifact);
        input.artifactHash = replacementArtifact;
        input.artifactURI = "ipfs://round-v2";
        oracle.proposeRoundPayoutSnapshot(input);

        ClusterPayoutOracle.RoundPayoutProposal memory replacement = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(replacement.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(replacement.artifactHash, replacementArtifact);
    }

    function test_FinalizedRoundPayoutSnapshotReproposalWithLiveParentWhenConsumerViewReverts() public {
        RevertingConsumedRoundPayoutSnapshotConsumer revertingConsumer = new RevertingConsumedRoundPayoutSnapshotConsumer();
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), address(revertingConsumer));

        bytes32 firstArtifact = keccak256("epoch-artifact");
        _proposeDefaultCorrelationEpoch(1, keccak256("cluster-root"), firstArtifact);
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        vm.warp(block.timestamp + 2 hours + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        input.artifactHash = firstArtifact;
        input.artifactURI = "ipfs://round-v2-live-parent";
        input.weightRoot = keccak256("replacement-weight-root");
        oracle.proposeRoundPayoutSnapshot(input);

        ClusterPayoutOracle.RoundPayoutProposal memory replacement = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(replacement.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(replacement.artifactHash, firstArtifact);
    }

    /// @dev M9: direct reproposal of a Proposed round payout snapshot is blocked while the
    ///      parent correlation epoch remains live (Proposed/Finalized, not rejected).
    function test_ProposedRoundPayoutSnapshotDirectReproposalRevertsSnapshotExistsWithLiveParent() public {
        _proposeDefaultCorrelationEpoch(1, keccak256("cluster-root"), keccak256("epoch-artifact"));

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);

        input.weightRoot = keccak256("replacement-weight-root");
        input.artifactURI = "ipfs://round-replacement";
        vm.expectRevert(ClusterPayoutOracle.SnapshotExists.selector);
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function test_ChallengedRoundPayoutSnapshotDirectReproposalRevertsSnapshotExistsWithLiveParent() public {
        _proposeDefaultCorrelationEpoch(1, keccak256("cluster-root"), keccak256("epoch-artifact"));

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        _challengeRoundPayoutSnapshot(snapshotKey, keccak256("challenge-round"));

        input.weightRoot = keccak256("replacement-weight-root");
        input.artifactURI = "ipfs://round-replacement";
        vm.expectRevert(ClusterPayoutOracle.SnapshotExists.selector);
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function test_StaleProposedRoundPayoutSnapshotCanBeReplacedAfterParentReproposal() public {
        bytes32 firstArtifact = keccak256("epoch-artifact");
        _proposeDefaultCorrelationEpoch(1, keccak256("cluster-root"), firstArtifact);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        bytes32 staleDigest = oracle.roundPayoutSnapshotProposalDigest(snapshotKey);

        oracle.rejectCorrelationEpoch(1, keccak256("bad-parent"));
        IClusterPayoutOracle.RoundPayoutSnapshot memory staleSnapshot =
            oracle.getRoundPayoutSnapshot(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        assertEq(uint8(staleSnapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Rejected));

        bytes32 replacementArtifact = keccak256("epoch-artifact-v2");
        _proposeDefaultCorrelationEpoch(1, keccak256("cluster-root"), replacementArtifact);
        input.artifactHash = replacementArtifact;
        input.artifactURI = "ipfs://round-v2";
        oracle.proposeRoundPayoutSnapshot(input);

        ClusterPayoutOracle.RoundPayoutProposal memory replacement = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(replacement.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(replacement.artifactHash, replacementArtifact);
        assertTrue(oracle.rejectedRoundPayoutSnapshotDigests(snapshotKey, staleDigest));
    }

    function test_StaleChallengedRoundPayoutSnapshotReplacementCreditsChallengerBond() public {
        bytes32 firstArtifact = keccak256("epoch-artifact");
        _proposeDefaultCorrelationEpoch(1, keccak256("cluster-root"), firstArtifact);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        _challengeRoundPayoutSnapshot(snapshotKey, keccak256("bad-round"));
        bytes32 staleDigest = oracle.roundPayoutSnapshotProposalDigest(snapshotKey);

        oracle.rejectCorrelationEpoch(1, keccak256("bad-parent"));
        IClusterPayoutOracle.RoundPayoutSnapshot memory staleSnapshot =
            oracle.getRoundPayoutSnapshot(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        assertEq(uint8(staleSnapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Rejected));
        assertEq(oracle.pendingBondWithdrawals(CHALLENGER), 0);

        bytes32 replacementArtifact = keccak256("epoch-artifact-v2");
        _proposeDefaultCorrelationEpoch(1, keccak256("cluster-root"), replacementArtifact);
        input.artifactHash = replacementArtifact;
        input.artifactURI = "ipfs://round-v2";
        oracle.proposeRoundPayoutSnapshot(input);

        assertTrue(oracle.rejectedRoundPayoutSnapshotDigests(snapshotKey, staleDigest));
        assertEq(oracle.pendingBondWithdrawals(CHALLENGER), CHALLENGE_BOND);
        ClusterPayoutOracle.RoundPayoutProposal memory replacement = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(replacement.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(replacement.bond, 0);
        assertEq(replacement.challenger, address(0));
    }

    function test_StaleRoundPayoutSnapshotChallengeRevertsBeforeBondPull() public {
        _proposeDefaultCorrelationEpoch(1, keccak256("cluster-root"), keccak256("epoch-artifact"));

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        oracle.rejectCorrelationEpoch(1, keccak256("bad-parent"));

        usdc.mint(CHALLENGER, CHALLENGE_BOND);
        vm.startPrank(CHALLENGER);
        usdc.approve(address(oracle), CHALLENGE_BOND);
        uint256 balanceBefore = usdc.balanceOf(CHALLENGER);
        vm.expectRevert(ClusterPayoutOracle.SnapshotNotFinalizable.selector);
        oracle.challengeRoundPayoutSnapshot(snapshotKey, keccak256("stale-child"));
        assertEq(usdc.balanceOf(CHALLENGER), balanceBefore);
        vm.stopPrank();
    }

    function test_ChallengedParentKeepsMatchingRoundPayoutSnapshotLive() public {
        _proposeDefaultCorrelationEpoch(1, keccak256("cluster-root"), keccak256("epoch-artifact"));

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        _challengeCorrelationEpoch(1, keccak256("bad-parent"));

        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot =
            oracle.getRoundPayoutSnapshot(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));

        _challengeRoundPayoutSnapshot(snapshotKey, keccak256("bad-round"));
        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(proposal.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Challenged));
    }

    function test_LaunchSnapshotsUseZeroRewardPoolId() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        uint8 launchDomain = oracle.PAYOUT_DOMAIN_LAUNCH_CREDIT();
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: launchDomain,
                rewardPoolId: 7,
                contentId: 42,
                roundId: 3,
                correlationEpochId: 1,
                rawEligibleVoters: 4,
                effectiveParticipantUnits: 10_000,
                totalClaimWeight: 1_000,
                weightRoot: keccak256("leaf"),
                reasonRoot: keccak256("reason-root"),
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://round"
            })
        );
    }

    function test_RoundSnapshotMustStayWithinCorrelationEpochRange() public {
        oracle.proposeCorrelationEpoch(
            1,
            10,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _questionEpochSources(7, 42, 10)
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        uint8 questionRewardDomain = oracle.PAYOUT_DOMAIN_QUESTION_REWARD();
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: questionRewardDomain,
                rewardPoolId: 7,
                contentId: 42,
                roundId: 9,
                correlationEpochId: 1,
                rawEligibleVoters: 4,
                effectiveParticipantUnits: 10_000,
                totalClaimWeight: 1_000,
                weightRoot: keccak256("leaf"),
                reasonRoot: keccak256("reason-root"),
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://round"
            })
        );
    }

    function test_RoundSnapshotMustUseFinalizedEpochArtifactHash() public {
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _defaultEpochSources()
        );
        vm.warp(2 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        input.artifactHash = keccak256("other-artifact");

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function _defaultRoundPayoutInput(uint64 epochId)
        private
        view
        returns (IClusterPayoutOracle.RoundPayoutSnapshotInput memory)
    {
        return IClusterPayoutOracle.RoundPayoutSnapshotInput({
            domain: oracle.PAYOUT_DOMAIN_QUESTION_REWARD(),
            rewardPoolId: 7,
            contentId: 42,
            roundId: 3,
            correlationEpochId: epochId,
            rawEligibleVoters: 4,
            effectiveParticipantUnits: 25_000,
            totalClaimWeight: 2_500,
            weightRoot: keccak256("leaf"),
            reasonRoot: keccak256("reason-root"),
            artifactHash: keccak256("epoch-artifact"),
            artifactURI: "ipfs://round"
        });
    }

    function _proposeDefaultCorrelationEpoch(uint64 epochId, bytes32 clusterRoot, bytes32 artifactHash) private {
        oracle.proposeCorrelationEpoch(
            epochId, 1, 20, clusterRoot, keccak256("params"), artifactHash, "ipfs://epoch", _defaultEpochSources()
        );
    }
}

contract BondChallengeForwarder {
    function challengeCorrelationEpoch(MockERC20 token, ClusterPayoutOracle oracle, uint64 epochId, bytes32 reasonHash)
        external
    {
        token.approve(address(oracle), type(uint256).max);
        oracle.challengeCorrelationEpoch(epochId, reasonHash);
    }

    function challengeRoundPayoutSnapshot(
        MockERC20 token,
        ClusterPayoutOracle oracle,
        bytes32 snapshotKey,
        bytes32 reasonHash
    ) external {
        token.approve(address(oracle), type(uint256).max);
        oracle.challengeRoundPayoutSnapshot(snapshotKey, reasonHash);
    }
}

contract MockFrontendRegistry {
    uint256 public constant STAKE_AMOUNT = 1_000e6;

    mapping(address => bool) internal eligible;
    mapping(address => address) internal snapshotFrontend;
    mapping(address => address) public snapshotProposerForFrontend;

    function setEligible(address frontend, bool value) external {
        eligible[frontend] = value;
    }

    function setAuthorizedSnapshotFrontend(address proposer, address frontend) external {
        address previousProposer = snapshotProposerForFrontend[frontend];
        if (previousProposer != address(0)) {
            delete snapshotFrontend[previousProposer];
        }
        address previousFrontend = snapshotFrontend[proposer];
        if (previousFrontend != address(0) && previousFrontend != frontend) {
            delete snapshotProposerForFrontend[previousFrontend];
        }
        snapshotFrontend[proposer] = frontend;
        snapshotProposerForFrontend[frontend] = proposer;
    }

    function clearAuthorizedSnapshotFrontend(address frontend) external {
        address previousProposer = snapshotProposerForFrontend[frontend];
        if (previousProposer != address(0)) {
            delete snapshotFrontend[previousProposer];
        }
        delete snapshotProposerForFrontend[frontend];
    }

    function isEligible(address frontend) external view returns (bool) {
        return eligible[frontend];
    }

    function authorizedSnapshotFrontend(address proposer) external view returns (address frontend) {
        if (eligible[proposer]) return proposer;
        frontend = snapshotFrontend[proposer];
        if (!eligible[frontend]) return address(0);
    }

    function isAuthorizedSnapshotProposer(address frontend, address proposer) external view returns (bool) {
        if (!eligible[frontend] || proposer == address(0)) return false;
        if (frontend == proposer) return true;
        return snapshotFrontend[proposer] == frontend && snapshotProposerForFrontend[frontend] == proposer;
    }
}

contract MockRoundPayoutSnapshotConsumer {
    bool internal consumed;
    uint64 internal sourceReadyAt = 1; // default to "ready since unix-epoch second 1" so tests opt-in

    function setConsumed(bool value) external {
        consumed = value;
    }

    function setSourceReadyAt(uint64 value) external {
        sourceReadyAt = value;
    }

    function isRoundPayoutSnapshotConsumed(uint8, uint256, uint256, uint256) external view returns (bool) {
        return consumed;
    }

    function roundPayoutSnapshotSourceReadyAt(uint8, uint256, uint256, uint256) external view returns (uint64) {
        return sourceReadyAt;
    }
}

contract RevertingConsumedRoundPayoutSnapshotConsumer {
    function isRoundPayoutSnapshotConsumed(uint8, uint256, uint256, uint256) external pure returns (bool) {
        revert("consumer view reverts");
    }

    function roundPayoutSnapshotSourceReadyAt(uint8, uint256, uint256, uint256) external pure returns (uint64) {
        return 1;
    }
}
