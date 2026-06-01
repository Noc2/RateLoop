// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { ClusterPayoutOracle } from "../contracts/ClusterPayoutOracle.sol";
import { IClusterPayoutOracle } from "../contracts/interfaces/IClusterPayoutOracle.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";

contract ClusterPayoutOracleTest is Test {
    uint256 internal constant CHALLENGE_BOND = 5e6;
    address internal constant CHALLENGER = address(0xCA11);

    ClusterPayoutOracle internal oracle;
    MockFrontendRegistry internal frontendRegistry;
    MockRoundPayoutSnapshotConsumer internal questionConsumer;
    MockRoundPayoutSnapshotConsumer internal launchConsumer;
    MockERC20 internal usdc;

    receive() external payable { }

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        frontendRegistry = new MockFrontendRegistry();
        frontendRegistry.setEligible(address(this), true);
        oracle = new ClusterPayoutOracle(address(this), address(frontendRegistry), address(usdc));
        oracle.setOracleConfig(1 hours, CHALLENGE_BOND, address(this));
        questionConsumer = new MockRoundPayoutSnapshotConsumer();
        launchConsumer = new MockRoundPayoutSnapshotConsumer();
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), address(questionConsumer));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_LAUNCH_CREDIT(), address(launchConsumer));
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
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );

        frontendRegistry.setEligible(ineligibleFrontend, true);
        vm.prank(ineligibleFrontend);
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );

        vm.warp(1 hours + 2);
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
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );

        ClusterPayoutOracle.CorrelationEpochSnapshot memory epoch = oracle.correlationEpochSnapshot(1);
        assertEq(epoch.proposer, keeper);

        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        vm.prank(keeper);
        oracle.proposeRoundPayoutSnapshot(input);

        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        assertEq(proposal.proposer, keeper);

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
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
    }

    function test_ProposeCorrelationEpochRejectsZeroArtifactHash() public {
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), bytes32(0), "ipfs://epoch"
        );
    }

    function test_ProposeRoundPayoutSnapshotRejectsZeroArtifactHash() public {
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
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
        oracle.setOracleConfig(1 hours, maxChallengeBond, address(this));
        assertEq(oracle.challengeBond(), maxChallengeBond);

        vm.expectRevert(ClusterPayoutOracle.InvalidBond.selector);
        oracle.setOracleConfig(1 hours, maxChallengeBond + 1, address(this));
    }

    function test_RoundPayoutSnapshotConsumersMustBeConfigured() public {
        ClusterPayoutOracle unconfiguredOracle =
            new ClusterPayoutOracle(address(this), address(frontendRegistry), address(usdc));
        unconfiguredOracle.setOracleConfig(1 hours, CHALLENGE_BOND, address(this));
        unconfiguredOracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );

        vm.warp(1 hours + 2);
        unconfiguredOracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        vm.expectRevert(ClusterPayoutOracle.InvalidAddress.selector);
        unconfiguredOracle.proposeRoundPayoutSnapshot(input);
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
            "ipfs://ok"
        );
    }

    // M-Oracle-1: snapshot proposals must wait until the consumer signals the round source is
    // ready. Without this gate one eligible frontend could squat the slot at gas cost only and
    // censor honest payouts for the full challenge window. Verifies both the not-yet-ready
    // (sourceReadyAt == 0) and future-readyAt branches, plus the happy-path once ready.
    function test_RoundPayoutSnapshotProposalRequiresSourceReady() public {
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
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

    function test_OptimisticEpochAndRoundSnapshotFinalizeAndVerifyLeaf() public {
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );

        vm.warp(1 hours + 2);
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
        vm.warp(2 hours + 3);
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

    function test_EmptyRoundPayoutSnapshotFinalizesButCannotVerifyClaims() public {
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        input.rawEligibleVoters = 0;
        input.effectiveParticipantUnits = 0;
        input.totalClaimWeight = 0;
        input.weightRoot = bytes32(0);

        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        vm.warp(block.timestamp + 1 hours + 1);
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
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
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
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
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
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        _challengeCorrelationEpoch(1, keccak256("bad-root"));

        vm.warp(1 hours + 2);
        vm.expectRevert(ClusterPayoutOracle.SnapshotChallenged.selector);
        oracle.finalizeCorrelationEpoch(1);

        oracle.rejectCorrelationEpoch(1, keccak256("bad-root"));
        ClusterPayoutOracle.CorrelationEpochSnapshot memory snapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Rejected));
        // L-Oracle-A: a challenge-then-reject DOES still blacklist the root so identical
        // re-proposal is blocked. Only pre-challenge (Proposed-state) rejections skip blacklisting.
        assertTrue(oracle.rejectedCorrelationEpochRoots(1, keccak256("cluster-root")));
    }

    function test_FinalizedCorrelationEpochCanBeVetoedBeforeFutureChildProposals() public {
        bytes32 clusterRoot = keccak256("cluster-root");
        oracle.proposeCorrelationEpoch(
            1, 1, 20, clusterRoot, keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        oracle.rejectFinalizedCorrelationEpoch(1, keccak256("late-bad-root"));

        ClusterPayoutOracle.CorrelationEpochSnapshot memory snapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Rejected));
        assertTrue(oracle.rejectedCorrelationEpochRoots(1, clusterRoot));

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        vm.expectRevert(ClusterPayoutOracle.SnapshotNotFinalizable.selector);
        oracle.proposeRoundPayoutSnapshot(input);
    }

    function test_FinalizedCorrelationEpochVetoWindowExpires() public {
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        vm.warp(block.timestamp + oracle.FINALIZATION_VETO_WINDOW() + 1);
        vm.expectRevert(ClusterPayoutOracle.SnapshotNotFinalizable.selector);
        oracle.rejectFinalizedCorrelationEpoch(1, keccak256("too-late"));
    }

    function test_RejectedFinalizedCorrelationEpochBlocksChildFinalization() public {
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
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
            "ipfs://epoch-replacement"
        );
        vm.warp(block.timestamp + 1 hours + 1);
        oracle.finalizeCorrelationEpoch(1);

        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(ClusterPayoutOracle.SnapshotNotFinalizable.selector);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);
    }

    function test_RejectedFinalizedCorrelationEpochBlocksChallengedChildFinalization() public {
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
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
            "ipfs://epoch-replacement"
        );
        vm.warp(block.timestamp + 1 hours + 1);
        oracle.finalizeCorrelationEpoch(1);

        vm.expectRevert(ClusterPayoutOracle.SnapshotNotFinalizable.selector);
        oracle.finalizeChallengedRoundPayoutSnapshot(snapshotKey, keccak256("dismiss-child-challenge"));
    }

    function test_RejectedFinalizedCorrelationEpochBlocksFuturePayoutVerification() public {
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
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
        vm.warp(block.timestamp + 1 hours + 1);
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
            "ipfs://epoch-replacement"
        );
        vm.warp(3 hours + 4);
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
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        vm.warp(block.timestamp + 1 hours + 1);
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
            "ipfs://epoch-replacement"
        );
        vm.warp(3 hours + 4);
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
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        vm.warp(block.timestamp + 1 hours + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        oracle.rejectFinalizedCorrelationEpoch(1, keccak256("bad-parent"));
        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("replacement-cluster-root"),
            keccak256("params"),
            keccak256("replacement-epoch-artifact"),
            "ipfs://epoch-replacement"
        );
        vm.warp(3 hours + 4);
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
            1, 1, 20, badRoot, keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);
        oracle.rejectFinalizedCorrelationEpoch(1, keccak256("bad-root"));

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeCorrelationEpoch(
            1, 1, 20, badRoot, keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );

        oracle.proposeCorrelationEpoch(
            1,
            1,
            20,
            keccak256("replacement-cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch-replacement"
        );
        vm.warp(block.timestamp + 1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        ClusterPayoutOracle.CorrelationEpochSnapshot memory snapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
        assertEq(snapshot.clusterRoot, keccak256("replacement-cluster-root"));
    }

    // L-Oracle-A: the arbiter rejecting a Proposed (pre-challenge) correlation epoch must NOT
    // blacklist the clusterRoot — otherwise an M-Oracle-1 style slot-squat followed by an arbiter
    // reject would permanently strand the correct root (the deterministic scorer can't produce a
    // different root for the same epoch).
    function test_ProposedCorrelationEpochRejectionDoesNotBlacklistRoot() public {
        address squatter = address(0xBAD);
        frontendRegistry.setEligible(squatter, true);

        bytes32 honestRoot = keccak256("honest-cluster-root");

        vm.prank(squatter);
        oracle.proposeCorrelationEpoch(
            1, 1, 20, honestRoot, keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );

        // Arbiter clears the squatted slot without going through the challenge cycle.
        oracle.rejectCorrelationEpoch(1, keccak256("squat-cleanup"));

        // The clusterRoot is NOT blacklisted, so an honest proposer can re-submit it.
        assertFalse(oracle.rejectedCorrelationEpochRoots(1, honestRoot));
        oracle.proposeCorrelationEpoch(
            1, 1, 20, honestRoot, keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );

        vm.warp(block.timestamp + 1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);
        ClusterPayoutOracle.CorrelationEpochSnapshot memory finalSnapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(finalSnapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
    }

    function test_ChallengesPullConfiguredUsdcBond() public {
        address challenger = address(0xCA11);
        usdc.mint(challenger, CHALLENGE_BOND);

        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
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

    function test_ProposerCannotChallengeOwnCorrelationEpoch() public {
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.challengeCorrelationEpoch(1, keccak256("self-challenge"));
    }

    function test_ProposerCannotChallengeOwnRoundPayoutSnapshot() public {
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);

        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.challengeRoundPayoutSnapshot(snapshotKey, keccak256("self-challenge"));
    }

    function test_ChallengesRequireUsdcApprovalAndRejectNativeToken() public {
        address challenger = address(0xCA11);
        usdc.mint(challenger, CHALLENGE_BOND);
        vm.deal(challenger, 1 ether);

        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
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
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
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
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );

        vm.warp(1 hours + 2);
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

        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(ClusterPayoutOracle.SnapshotNotFinalizable.selector);
        oracle.challengeRoundPayoutSnapshot(snapshotKey, keccak256("late-round-challenge"));
    }

    function test_ChallengeBondCreditsAccumulateUntilWithdrawal() public {
        BondChallengeForwarder challenger = new BondChallengeForwarder();
        usdc.mint(address(challenger), 100e6);

        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        challenger.challengeCorrelationEpoch(usdc, oracle, 1, keccak256("bad-root"));
        oracle.rejectCorrelationEpoch(1, keccak256("bad-root"));
        assertEq(oracle.pendingBondWithdrawals(address(challenger)), CHALLENGE_BOND);

        oracle.proposeCorrelationEpoch(
            2, 1, 20, keccak256("cluster-root-2"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
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
            1, 1, 20, keccak256("bad-cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
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
            "ipfs://epoch-replacement"
        );
        vm.warp(1 hours + 2);
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
            1, 1, 20, keccak256("bad-cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
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
            "ipfs://epoch-replacement"
        );
        vm.warp(1 hours + 2);
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
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        vm.warp(2 hours + 3);
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
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        vm.warp(2 hours + 3);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        questionConsumer.setConsumed(true);

        // Past the veto window, the consumed flag locks rejection.
        vm.warp(block.timestamp + oracle.FINALIZATION_VETO_WINDOW() + 1);
        vm.expectRevert(ClusterPayoutOracle.SnapshotConsumed.selector);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("consumed"));
    }

    function test_FinalizedRoundPayoutSnapshotRejectAllowedWithinVetoWindowEvenIfConsumed() public {
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        vm.warp(2 hours + 3);
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
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = _defaultRoundPayoutInput(1);
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), input.rewardPoolId, input.contentId, input.roundId
        );
        vm.warp(2 hours + 3);
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

    function test_LaunchSnapshotsUseZeroRewardPoolId() public {
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
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
            1, 10, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
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
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
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
}

contract ClusterPayoutOracleProposerBondTest is Test {
    uint256 internal constant CHALLENGE_BOND = 5e6;
    uint256 internal constant PROPOSER_BOND = 100e6;

    TestableClusterPayoutOracle internal oracle;
    MockFrontendRegistry internal frontendRegistry;
    MockRoundPayoutSnapshotConsumer internal questionConsumer;
    MockERC20 internal usdc;
    address internal arbiter;
    address internal bondRecipient;
    address internal proposer;

    event ProposerBondUnrecoverable(bytes32 indexed snapshotKey, address indexed proposer, uint256 missingAmount);

    receive() external payable { }

    function setUp() public {
        arbiter = address(this);
        bondRecipient = address(this);
        proposer = address(0xBEEF);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        frontendRegistry = new MockFrontendRegistry();
        frontendRegistry.setEligible(proposer, true);
        oracle = new TestableClusterPayoutOracle(arbiter, address(frontendRegistry), address(usdc));
        oracle.setOracleConfig(1 hours, CHALLENGE_BOND, bondRecipient);
        questionConsumer = new MockRoundPayoutSnapshotConsumer();
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), address(questionConsumer));
        usdc.mint(address(this), 100e6);
        usdc.approve(address(oracle), type(uint256).max);
    }

    /// @dev Sanity check that our manual storage slot calc for proposerBond is correct: the bond
    ///      field (offset 14) sits one slot before proposerBond (offset 15), and bond is observable
    ///      via the public proposal accessor.
    function test_ProposerBondSlotMatchesBondField() public {
        bytes32 snapshotKey = _proposeAndFinalize();

        // Seed proposerBond via the test helper.
        oracle.setProposerBondForTest(snapshotKey, 12_345);
        assertEq(oracle.readProposerBond(snapshotKey), 12_345);

        // Verify other proposal fields are still intact (the slot calc only touched proposerBond).
        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(proposal.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
        assertEq(proposal.proposer, proposer);
        assertEq(proposal.bond, 0);
    }

    function test_RejectFinalizedClawsBackProposerBondToBondRecipient() public {
        bytes32 snapshotKey = _proposeAndFinalize();
        oracle.setProposerBondForTest(snapshotKey, PROPOSER_BOND);

        // Simulate the proposer-bond credit that a future finalize path would push: credit the
        // proposer's pending balance directly via a contract that does not exist today, so we
        // synthesize the effect by adjusting via a private storage write.
        _seedPendingBondWithdrawal(proposer, PROPOSER_BOND);
        uint256 recipientBefore = oracle.pendingBondWithdrawals(bondRecipient);

        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("clawback-full"));

        assertEq(oracle.pendingBondWithdrawals(proposer), 0, "proposer balance fully clawed back");
        assertEq(
            oracle.pendingBondWithdrawals(bondRecipient), recipientBefore + PROPOSER_BOND, "bond recipient credited"
        );
        assertEq(oracle.readProposerBond(snapshotKey), 0, "proposerBond cleared");
    }

    function test_RejectFinalizedEmitsUnrecoverableIfProposerAlreadyWithdrew() public {
        bytes32 snapshotKey = _proposeAndFinalize();
        oracle.setProposerBondForTest(snapshotKey, PROPOSER_BOND);

        // Proposer's pending balance covers only half of the proposer bond (already withdrew the
        // rest), so the rejection should claw back what it can and emit ProposerBondUnrecoverable
        // for the missing half.
        uint256 partialAmount = PROPOSER_BOND / 2;
        _seedPendingBondWithdrawal(proposer, partialAmount);

        vm.expectEmit(true, true, false, true, address(oracle));
        emit ProposerBondUnrecoverable(snapshotKey, proposer, PROPOSER_BOND - partialAmount);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("clawback-partial"));

        assertEq(oracle.pendingBondWithdrawals(proposer), 0, "available balance fully clawed back");
        assertEq(oracle.readProposerBond(snapshotKey), 0, "proposerBond cleared even on partial");
    }

    function test_RejectFinalizedNoOpWhenProposerBondIsZero() public {
        bytes32 snapshotKey = _proposeAndFinalize();
        uint256 recipientBefore = oracle.pendingBondWithdrawals(bondRecipient);

        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("no-bond"));

        assertEq(
            oracle.pendingBondWithdrawals(bondRecipient),
            recipientBefore,
            "no recipient credit when proposerBond is zero"
        );
    }

    function _proposeAndFinalize() internal returns (bytes32 snapshotKey) {
        vm.prank(proposer);
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory input = IClusterPayoutOracle.RoundPayoutSnapshotInput({
            domain: oracle.PAYOUT_DOMAIN_QUESTION_REWARD(),
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
        });
        vm.prank(proposer);
        oracle.proposeRoundPayoutSnapshot(input);
        snapshotKey = oracle.roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        vm.warp(2 hours + 3);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);
    }

    /// @dev Writes pendingBondWithdrawals[account] directly. The mapping sits at slot 8
    ///      (challengeBondToken is immutable so does not consume a slot — see comment in
    ///      TestableClusterPayoutOracle._proposerBondSlot for the layout walk).
    function _seedPendingBondWithdrawal(address account, uint256 amount) internal {
        uint256 BASE_SLOT_PENDING_BOND_WITHDRAWALS = 8;
        bytes32 slot = keccak256(abi.encode(account, BASE_SLOT_PENDING_BOND_WITHDRAWALS));
        vm.store(address(oracle), slot, bytes32(amount));
        assertEq(oracle.pendingBondWithdrawals(account), amount, "pendingBondWithdrawals seed sanity");
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

    function setEligible(address frontend, bool value) external {
        eligible[frontend] = value;
    }

    function setAuthorizedSnapshotFrontend(address proposer, address frontend) external {
        snapshotFrontend[proposer] = frontend;
    }

    function isEligible(address frontend) external view returns (bool) {
        return eligible[frontend];
    }

    function authorizedSnapshotFrontend(address proposer) external view returns (address frontend) {
        if (eligible[proposer]) return proposer;
        frontend = snapshotFrontend[proposer];
        if (!eligible[frontend]) return address(0);
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

/// @dev Test harness exposing a setter for proposerBond so the L-Integrations-1 clawback path can
///      be exercised without introducing a production-facing proposer-bond mechanism (intentionally
///      deferred per M-Oracle-1 mitigation discussion).
contract TestableClusterPayoutOracle is ClusterPayoutOracle {
    constructor(address admin, address frontendRegistry, address challengeBondToken)
        ClusterPayoutOracle(admin, frontendRegistry, challengeBondToken)
    { }

    /// @dev Sets proposerBond directly via the inherited (private) mapping. Because the storage
    ///      mapping is `private`, we re-declare an internal shim that maps onto the same slot by
    ///      using a child storage variable with the same declaration order is not possible; the
    ///      simplest reliable mechanism is to expose the mapping at the same slot by computing it
    ///      from the struct's storage slot derivation rules and writing the trailing uint256.
    function setProposerBondForTest(bytes32 snapshotKey, uint256 amount) external {
        bytes32 slot = _proposerBondSlot(snapshotKey);
        assembly {
            sstore(slot, amount)
        }
    }

    function readProposerBond(bytes32 snapshotKey) external view returns (uint256 amount) {
        bytes32 slot = _proposerBondSlot(snapshotKey);
        assembly {
            amount := sload(slot)
        }
    }

    function _proposerBondSlot(bytes32 snapshotKey) private pure returns (bytes32) {
        // AccessControl._roles occupies slot 0. ClusterPayoutOracle then declares:
        //   slot 1: challengeWindow (uint64)
        //   slot 2: challengeBond (uint256)
        //   slot 3: bondRecipient (address)
        //   slot 4: frontendRegistry (address; challengeBondToken is immutable, no slot)
        //   slot 5: correlationEpochSnapshots (mapping)
        //   slot 6: roundPayoutProposals (mapping)
        // proposerBond sits at offset 15 within RoundPayoutProposal
        // (RoundPayoutSnapshot packs into slots 0-8, then proposedAt+consumer=9, proposer=10,
        // challenger=11, artifactHash=12, artifactURI=13, bond=14, proposerBond=15,
        // correlationEpochDigest=16). This layout is asserted by
        // test_ProposerBondSlotMatchesBondField below.
        uint256 BASE_SLOT_ROUND_PAYOUT_PROPOSALS = 6;
        uint256 PROPOSER_BOND_OFFSET = 15;
        bytes32 structRoot = keccak256(abi.encode(snapshotKey, BASE_SLOT_ROUND_PAYOUT_PROPOSALS));
        return bytes32(uint256(structRoot) + PROPOSER_BOND_OFFSET);
    }
}
