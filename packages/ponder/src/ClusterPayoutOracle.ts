import { ponder } from "ponder:registry";
import { correlationEpochSnapshot, roundPayoutSnapshot } from "ponder:schema";

const SNAPSHOT_STATUS = {
  Proposed: 1,
  Challenged: 2,
  Finalized: 3,
  Rejected: 4,
} as const;

ponder.on(
  "ClusterPayoutOracle:CorrelationEpochProposed",
  async ({ event, context }) => {
    const {
      epochId,
      fromRoundId,
      toRoundId,
      proposer,
      clusterRoot,
      parameterHash,
      artifactHash,
      artifactURI,
    } = event.args;

    await context.db
      .insert(correlationEpochSnapshot)
      .values({
        id: epochId,
        fromRoundId,
        toRoundId,
        proposer,
        challenger: null,
        clusterRoot,
        parameterHash,
        artifactHash,
        artifactUri: artifactURI,
        status: SNAPSHOT_STATUS.Proposed,
        proposedAt: event.block.timestamp,
        finalizedAt: null,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        fromRoundId,
        toRoundId,
        proposer,
        challenger: null,
        clusterRoot,
        parameterHash,
        artifactHash,
        artifactUri: artifactURI,
        status: SNAPSHOT_STATUS.Proposed,
        proposedAt: event.block.timestamp,
        finalizedAt: null,
        updatedAt: event.block.timestamp,
      });
  },
);

ponder.on(
  "ClusterPayoutOracle:CorrelationEpochChallenged",
  async ({ event, context }) => {
    const { epochId, challenger } = event.args;

    await context.db.update(correlationEpochSnapshot, { id: epochId }).set({
      challenger,
      status: SNAPSHOT_STATUS.Challenged,
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "ClusterPayoutOracle:CorrelationEpochFinalized",
  async ({ event, context }) => {
    const { epochId } = event.args;

    await context.db.update(correlationEpochSnapshot, { id: epochId }).set({
      status: SNAPSHOT_STATUS.Finalized,
      finalizedAt: event.block.timestamp,
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "ClusterPayoutOracle:CorrelationEpochRejected",
  async ({ event, context }) => {
    const { epochId } = event.args;

    await context.db.update(correlationEpochSnapshot, { id: epochId }).set({
      status: SNAPSHOT_STATUS.Rejected,
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "ClusterPayoutOracle:RoundPayoutSnapshotProposed",
  async ({ event, context }) => {
    const {
      snapshotKey,
      domain,
      rewardPoolId,
      contentId,
      roundId,
      correlationEpochId,
      proposer,
      rawEligibleVoters,
      effectiveParticipantUnits,
      totalClaimWeight,
      weightRoot,
      reasonRoot,
      artifactHash,
      artifactURI,
    } = event.args;

    await context.db
      .insert(roundPayoutSnapshot)
      .values({
        id: snapshotKey,
        domain: Number(domain),
        rewardPoolId,
        contentId,
        roundId,
        correlationEpochId,
        proposer,
        challenger: null,
        rawEligibleVoters: Number(rawEligibleVoters),
        effectiveParticipantUnits: Number(effectiveParticipantUnits),
        totalClaimWeight,
        weightRoot,
        reasonRoot,
        artifactHash,
        artifactUri: artifactURI,
        status: SNAPSHOT_STATUS.Proposed,
        proposedAt: event.block.timestamp,
        finalizedAt: null,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        domain: Number(domain),
        rewardPoolId,
        contentId,
        roundId,
        correlationEpochId,
        proposer,
        challenger: null,
        rawEligibleVoters: Number(rawEligibleVoters),
        effectiveParticipantUnits: Number(effectiveParticipantUnits),
        totalClaimWeight,
        weightRoot,
        reasonRoot,
        artifactHash,
        artifactUri: artifactURI,
        status: SNAPSHOT_STATUS.Proposed,
        proposedAt: event.block.timestamp,
        finalizedAt: null,
        updatedAt: event.block.timestamp,
      });
  },
);

ponder.on(
  "ClusterPayoutOracle:RoundPayoutSnapshotChallenged",
  async ({ event, context }) => {
    const { snapshotKey, challenger } = event.args;

    await context.db.update(roundPayoutSnapshot, { id: snapshotKey }).set({
      challenger,
      status: SNAPSHOT_STATUS.Challenged,
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "ClusterPayoutOracle:RoundPayoutSnapshotFinalized",
  async ({ event, context }) => {
    const { snapshotKey } = event.args;

    await context.db.update(roundPayoutSnapshot, { id: snapshotKey }).set({
      status: SNAPSHOT_STATUS.Finalized,
      finalizedAt: event.block.timestamp,
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "ClusterPayoutOracle:RoundPayoutSnapshotRejected",
  async ({ event, context }) => {
    const { snapshotKey } = event.args;

    await context.db.update(roundPayoutSnapshot, { id: snapshotKey }).set({
      status: SNAPSHOT_STATUS.Rejected,
      updatedAt: event.block.timestamp,
    });
  },
);
