// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ClusterPayoutOracle} from "../contracts/ClusterPayoutOracle.sol";
import {IClusterPayoutOracle} from "../contracts/interfaces/IClusterPayoutOracle.sol";

contract ClusterPayoutOracleTest is Test {
    ClusterPayoutOracle internal oracle;

    receive() external payable {}

    function setUp() public {
        oracle = new ClusterPayoutOracle(address(this));
        oracle.setOracleConfig(1 hours, 0.01 ether, address(this));
        vm.deal(address(this), 10 ether);
    }

    function test_OptimisticEpochAndRoundSnapshotFinalizeAndVerifyLeaf() public {
        oracle.proposeCorrelationEpoch{value: 0.01 ether}(
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

        oracle.proposeRoundPayoutSnapshot{value: 0.01 ether}(
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
        oracle.proposeCorrelationEpoch{value: 0.01 ether}(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        oracle.challengeCorrelationEpoch{value: 0.01 ether}(1, keccak256("bad-root"));

        vm.warp(1 hours + 2);
        vm.expectRevert(ClusterPayoutOracle.SnapshotChallenged.selector);
        oracle.finalizeCorrelationEpoch(1);

        oracle.rejectCorrelationEpoch(1, keccak256("bad-root"));
        ClusterPayoutOracle.CorrelationEpochSnapshot memory snapshot = oracle.correlationEpochSnapshot(1);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Rejected));
    }

    function test_ArbiterCanFinalizeChallengedSnapshots() public {
        oracle.proposeCorrelationEpoch{value: 0.01 ether}(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        oracle.challengeCorrelationEpoch{value: 0.01 ether}(1, keccak256("invalid-challenge"));
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

        oracle.proposeRoundPayoutSnapshot{value: 0.01 ether}(
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
        oracle.challengeRoundPayoutSnapshot{value: 0.01 ether}(snapshotKey, keccak256("invalid-round-challenge"));
        oracle.finalizeChallengedRoundPayoutSnapshot(snapshotKey, keccak256("round-challenge-dismissed"));

        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot =
            oracle.getRoundPayoutSnapshot(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 3);
        assertEq(uint8(snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Finalized));
        bytes32[] memory proof = new bytes32[](0);
        assertTrue(oracle.verifyPayoutWeight(payout, proof));
    }

    function test_ChallengesCloseWhenSnapshotIsFinalizable() public {
        oracle.proposeCorrelationEpoch{value: 0.01 ether}(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );

        vm.warp(1 hours + 2);
        vm.expectRevert(ClusterPayoutOracle.SnapshotNotFinalizable.selector);
        oracle.challengeCorrelationEpoch{value: 0.01 ether}(1, keccak256("late-challenge"));

        oracle.finalizeCorrelationEpoch(1);

        uint8 questionRewardDomain = oracle.PAYOUT_DOMAIN_QUESTION_REWARD();
        oracle.proposeRoundPayoutSnapshot{value: 0.01 ether}(
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
        oracle.challengeRoundPayoutSnapshot{value: 0.01 ether}(snapshotKey, keccak256("late-round-challenge"));
    }

    function test_RejectedSnapshotsCanBeReplaced() public {
        oracle.proposeCorrelationEpoch{value: 0.01 ether}(
            1, 1, 20, keccak256("bad-cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        oracle.challengeCorrelationEpoch{value: 0.01 ether}(1, keccak256("bad-root"));
        oracle.rejectCorrelationEpoch(1, keccak256("bad-root"));

        oracle.proposeCorrelationEpoch{value: 0.01 ether}(
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
        oracle.proposeRoundPayoutSnapshot{value: 0.01 ether}(input);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), 7, 42, 3);
        oracle.challengeRoundPayoutSnapshot{value: 0.01 ether}(snapshotKey, keccak256("bad-round"));
        oracle.rejectRoundPayoutSnapshot(snapshotKey, keccak256("bad-round"));

        input.reasonRoot = keccak256("replacement-reason-root");
        input.artifactHash = keccak256("replacement-round-artifact");
        input.artifactURI = "ipfs://round-replacement";
        oracle.proposeRoundPayoutSnapshot{value: 0.01 ether}(input);

        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        assertEq(uint8(proposal.snapshot.status), uint8(IClusterPayoutOracle.SnapshotStatus.Proposed));
        assertEq(proposal.artifactHash, keccak256("replacement-round-artifact"));
    }

    function test_LaunchSnapshotsUseZeroRewardPoolId() public {
        oracle.proposeCorrelationEpoch{value: 0.01 ether}(
            1, 1, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        uint8 launchDomain = oracle.PAYOUT_DOMAIN_LAUNCH_CREDIT();
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot{value: 0.01 ether}(
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
        oracle.proposeCorrelationEpoch{value: 0.01 ether}(
            1, 10, 20, keccak256("cluster-root"), keccak256("params"), keccak256("epoch-artifact"), "ipfs://epoch"
        );
        vm.warp(1 hours + 2);
        oracle.finalizeCorrelationEpoch(1);

        uint8 questionRewardDomain = oracle.PAYOUT_DOMAIN_QUESTION_REWARD();
        vm.expectRevert(ClusterPayoutOracle.InvalidSnapshot.selector);
        oracle.proposeRoundPayoutSnapshot{value: 0.01 ether}(
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
}
