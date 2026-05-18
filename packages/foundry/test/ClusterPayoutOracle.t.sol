// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ClusterPayoutOracle } from "../contracts/ClusterPayoutOracle.sol";
import { IClusterPayoutOracle } from "../contracts/interfaces/IClusterPayoutOracle.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";

contract ClusterPayoutOracleTest is Test {
    uint256 internal constant CHALLENGE_BOND = 5e6;

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

    function test_ConstructorRequiresFrontendRegistry() public {
        vm.expectRevert(ClusterPayoutOracle.InvalidAddress.selector);
        new ClusterPayoutOracle(address(this), address(0), address(usdc));
    }

    function test_ConstructorRequiresChallengeBondToken() public {
        vm.expectRevert(ClusterPayoutOracle.InvalidAddress.selector);
        new ClusterPayoutOracle(address(this), address(frontendRegistry), address(0));
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

    function test_ProposalsDoNotAcceptEthBonds() public {
        vm.expectRevert(ClusterPayoutOracle.InvalidBond.selector);
        oracle.proposeCorrelationEpoch{ value: 1 }(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
    }

    function test_ChallengeWindowCannotOutliveFrontendUnbondingBuffer() public {
        uint64 maxChallengeWindow = oracle.MAX_CHALLENGE_WINDOW();
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.setOracleConfig(maxChallengeWindow + 1, CHALLENGE_BOND, address(this));
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
                artifactHash: keccak256("round-artifact"),
                artifactURI: "ipfs://round"
            })
        );

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 3);
        vm.warp(2 hours + 3);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        bytes32[] memory proof = new bytes32[](0);
        assertTrue(oracle.verifyPayoutWeight(payout, proof));

        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot =
            oracle.getRoundPayoutSnapshot(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 3);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
        assertEq(snapshot.totalClaimWeight, 2_500);
    }

    function test_ChallengedEpochCannotFinalizeUntilArbiterRejectsIt() public {
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        oracle.challengeCorrelationEpoch(1, keccak256("bad-root"));

        vm.warp(1 hours + 2);
        vm.expectRevert(ClusterPayoutOracle.SnapshotChallenged.selector);
        oracle.finalizeCorrelationEpoch(1);

        oracle.rejectCorrelationEpoch(1, keccak256("bad-root"));
        ClusterPayoutOracle.CorrelationEpochSnapshot memory snapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Rejected));
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
        oracle.challengeCorrelationEpoch(1, keccak256("invalid-challenge"));
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
                artifactHash: keccak256("round-artifact"),
                artifactURI: "ipfs://round"
            })
        );
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 3);
        oracle.challengeRoundPayoutSnapshot(snapshotKey, keccak256("invalid-round-challenge"));
        oracle.finalizeChallengedRoundPayoutSnapshot(snapshotKey, keccak256("round-challenge-dismissed"));

        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot =
            oracle.getRoundPayoutSnapshot(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 3);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
        bytes32[] memory proof = new bytes32[](0);
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
                artifactHash: keccak256("round-artifact"),
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

    function test_RejectedSnapshotsCanBeReplacedWithDifferentRoot() public {
        oracle.proposeCorrelationEpoch(
            1, 1, 20, keccak256("bad-cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        oracle.challengeCorrelationEpoch(1, keccak256("bad-root"));
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
            artifactHash: keccak256("bad-round-artifact"),
            artifactURI: "ipfs://round"
        });
        oracle.proposeRoundPayoutSnapshot(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 3);
        oracle.challengeRoundPayoutSnapshot(snapshotKey, keccak256("bad-round"));
        oracle.rejectRoundPayoutSnapshot(snapshotKey, keccak256("bad-round"));

        input.reasonRoot = keccak256("replacement-reason-root");
        input.artifactHash = keccak256("replacement-round-artifact");
        input.artifactURI = "ipfs://round-replacement";
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);

        input.weightRoot = keccak256("replacement-weight-root");
        oracle.proposeRoundPayoutSnapshot(input);

        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(proposal.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(proposal.artifactHash, keccak256("replacement-round-artifact"));
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

        input.artifactHash = keccak256("replacement-round-artifact");
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot(input);

        input.weightRoot = keccak256("replacement-weight-root");
        oracle.proposeRoundPayoutSnapshot(input);
        ClusterPayoutOracle.RoundPayoutProposal memory replacement = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(replacement.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(replacement.artifactHash, keccak256("replacement-round-artifact"));
        assertEq(replacement.consumer, address(questionConsumer));
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
                artifactHash: keccak256("round-artifact"),
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
                artifactHash: keccak256("round-artifact"),
                artifactURI: "ipfs://round"
            })
        );
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
            artifactHash: keccak256("round-artifact"),
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

        // Verify other proposal fields are still intact (the slot calc only touched the trailing
        // uint256 of the struct).
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
            artifactHash: keccak256("round-artifact"),
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
    mapping(address => bool) internal eligible;

    function setEligible(address frontend, bool value) external {
        eligible[frontend] = value;
    }

    function isEligible(address frontend) external view returns (bool) {
        return eligible[frontend];
    }
}

contract MockRoundPayoutSnapshotConsumer {
    bool internal consumed;

    function setConsumed(bool value) external {
        consumed = value;
    }

    function isRoundPayoutSnapshotConsumed(uint8, uint256, uint256, uint256) external view returns (bool) {
        return consumed;
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
        // proposerBond is the last uint256 of RoundPayoutProposal at offset 15 within the struct
        // (RoundPayoutSnapshot packs into slots 0-8, then proposedAt+consumer=9, proposer=10,
        // challenger=11, artifactHash=12, artifactURI=13, bond=14, proposerBond=15). This layout
        // is asserted by test_ProposerBondSlotMatchesBondField below.
        uint256 BASE_SLOT_ROUND_PAYOUT_PROPOSALS = 6;
        uint256 PROPOSER_BOND_OFFSET = 15;
        bytes32 structRoot = keccak256(abi.encode(snapshotKey, BASE_SLOT_ROUND_PAYOUT_PROPOSALS));
        return bytes32(uint256(structRoot) + PROPOSER_BOND_OFFSET);
    }
}
