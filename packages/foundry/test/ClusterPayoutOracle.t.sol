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

    function test_RejectedSnapshotsCanBeReplaced() public {
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
        oracle.proposeRoundPayoutSnapshot(input);
        ClusterPayoutOracle.RoundPayoutProposal memory replacement = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(replacement.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(replacement.artifactHash, keccak256("replacement-round-artifact"));
        assertEq(replacement.consumer, address(questionConsumer));
    }

    function test_FinalizedRoundPayoutSnapshotRejectChecksConsumer() public {
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

        vm.expectRevert(ClusterPayoutOracle.SnapshotConsumed.selector);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("consumed"));
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
