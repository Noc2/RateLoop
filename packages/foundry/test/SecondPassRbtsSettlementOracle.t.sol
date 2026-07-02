// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ClusterPayoutOracle } from "../contracts/ClusterPayoutOracle.sol";
import { IClusterPayoutOracle } from "../contracts/interfaces/IClusterPayoutOracle.sol";
import { RoundVotingEngineRbtsSettlementModule } from "../contracts/RoundVotingEngineRbtsSettlementModule.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { SecondPassAuditRegressionBase } from "./helpers/SecondPassAuditRegressionBase.sol";

contract SecondPassRbtsSettlementOracleTest is SecondPassAuditRegressionBase {
    function testMalformedRbtsSnapshotMustBeInvalidatedBeforeTimeout() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("rbts-malformed-snapshot");
        uint256 roundId = _moveRoundToRbtsSettlementPending(contentId);
        bytes32 snapshotKey = _proposeMalformedRbtsSnapshot(oracle, contentId, roundId);

        vm.warp(block.timestamp + 1 hours);

        IClusterPayoutOracle.PayoutWeight[] memory emptyWeights = new IClusterPayoutOracle.PayoutWeight[](0);
        bytes32[][] memory emptyProofs = new bytes32[][](0);
        vm.expectRevert(RoundVotingEngineRbtsSettlementModule.SnapshotAvailable.selector);
        votingEngine.applyRbtsSettlementSnapshot(contentId, roundId, emptyWeights, emptyProofs);

        oracle.invalidateObjectivelyInvalidRoundPayoutSnapshot(snapshotKey, keccak256("wrong-rbts-revealed-count"));
        IClusterPayoutOracle.RoundPayoutSnapshot memory rejected =
            oracle.getRoundPayoutSnapshot(oracle.PAYOUT_DOMAIN_RBTS_SETTLEMENT(), 0, contentId, roundId);
        assertEq(uint8(rejected.status), uint8(IClusterPayoutOracle.SnapshotStatus.Rejected));

        votingEngine.applyRbtsSettlementSnapshot(contentId, roundId, emptyWeights, emptyProofs);
        RoundLib.Round memory settled = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(uint8(settled.state), uint8(RoundLib.RoundState.Settled));
    }

    function _moveRoundToRbtsSettlementPending(uint256 contentId) internal returns (uint256 roundId) {
        roundId = _revealRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        vm.roll(block.number + 1);
        votingEngine.settleRound(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(uint8(round.state), uint8(RoundLib.RoundState.SettlementPending));
    }

    function _proposeMalformedRbtsSnapshot(ClusterPayoutOracle oracle, uint256 contentId, uint256 roundId)
        internal
        returns (bytes32 snapshotKey)
    {
        uint64 correlationEpochId = uint64(uint256(keccak256(abi.encode("malformed-rbts", contentId, roundId))));
        bytes32 artifactHash = keccak256("malformed-rbts-artifact");
        IClusterPayoutOracle.CorrelationEpochSourceRef[] memory sources =
            new IClusterPayoutOracle.CorrelationEpochSourceRef[](1);
        sources[0] = IClusterPayoutOracle.CorrelationEpochSourceRef({
            domain: oracle.PAYOUT_DOMAIN_RBTS_SETTLEMENT(), rewardPoolId: 0, contentId: contentId, roundId: roundId
        });
        oracle.proposeCorrelationEpoch(
            correlationEpochId,
            uint64(roundId),
            uint64(roundId),
            keccak256("malformed-rbts-cluster-root"),
            keccak256("malformed-rbts-params"),
            artifactHash,
            "ipfs://malformed-rbts",
            sources
        );

        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: oracle.PAYOUT_DOMAIN_RBTS_SETTLEMENT(),
                rewardPoolId: 0,
                contentId: contentId,
                roundId: roundId,
                correlationEpochId: correlationEpochId,
                rawEligibleVoters: 2,
                effectiveParticipantUnits: 20_000,
                totalClaimWeight: 20_000,
                weightRoot: keccak256("wrong-rbts-root"),
                reasonRoot: keccak256("wrong-rbts-reasons"),
                artifactHash: artifactHash,
                artifactURI: "ipfs://malformed-rbts"
            })
        );
        snapshotKey = oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_RBTS_SETTLEMENT(), 0, contentId, roundId);
    }
}
