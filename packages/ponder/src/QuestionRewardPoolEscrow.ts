import { ponder } from "ponder:registry";
import {
  content,
  questionBundleClaim,
  questionBundleRound,
  questionBundleRoundSet,
  questionBundleReward,
  questionBundleTerminalSkip,
  questionRewardPool,
  questionRewardPoolClaim,
  questionRewardPoolRound,
} from "ponder:schema";

function bundleRoundRowId(
  bundleId: bigint,
  roundSetIndex: bigint | number,
  bundleIndex: bigint | number,
) {
  return `${bundleId}-${roundSetIndex}-${bundleIndex}`;
}

function bundleRoundSetRowId(bundleId: bigint, roundSetIndex: bigint | number) {
  return `${bundleId}-${roundSetIndex}`;
}

function bundleClaimRowId(
  bundleId: bigint,
  roundSetIndex: bigint | number,
  claimant: string,
  identityKey: string,
) {
  return `${bundleId}-${roundSetIndex}-${claimant.toLowerCase()}-${identityKey}`;
}

function eventLogRowId(event: {
  block: { number: bigint };
  log?: { logIndex?: number | bigint | null };
  transaction?: { hash?: string | null };
}) {
  const logIndex = Number(event.log?.logIndex ?? 0);
  return event.transaction?.hash
    ? `${event.transaction.hash}-${logIndex}`
    : `${event.block.number.toString()}-${logIndex}`;
}

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

type RewardPoolAccountingRow = {
  fundedAmount: bigint;
  unallocatedAmount: bigint;
  allocatedAmount: bigint;
  claimedAmount: bigint;
  refundedAmount: bigint;
  qualifiedRounds: number;
  requiredSettledRounds: number;
};

// RewardPoolRefunded/Forfeited share one event shape for two on-chain paths:
// unallocated-only sweeps (pool stays live) vs complete post-grace sweeps (pool closed).
function isCompleteRewardPoolRefund(
  row: RewardPoolAccountingRow,
  amount: bigint,
): boolean {
  if (amount > row.unallocatedAmount) return true;
  if (row.unallocatedAmount === 0n && amount > 0n) return true;
  const remainingBalance =
    row.fundedAmount - row.claimedAmount - row.refundedAmount;
  return (
    amount === remainingBalance &&
    row.qualifiedRounds >= row.requiredSettledRounds
  );
}

function applyRewardPoolResidueUpdate(
  row: RewardPoolAccountingRow,
  amount: bigint,
  timestamp: bigint,
) {
  if (isCompleteRewardPoolRefund(row, amount)) {
    return {
      unallocatedAmount: 0n,
      allocatedAmount: 0n,
      refundedAmount: row.refundedAmount + amount,
      refunded: true,
      updatedAt: timestamp,
    };
  }

  return {
    unallocatedAmount: 0n,
    refundedAmount: row.refundedAmount + amount,
    updatedAt: timestamp,
  };
}

function applyBundleRewardResidueUpdate(
  row: { refundedAmount: bigint },
  amount: bigint,
  timestamp: bigint,
) {
  return {
    unallocatedAmount: 0n,
    allocatedAmount: 0n,
    refundedAmount: row.refundedAmount + amount,
    refunded: true,
    updatedAt: timestamp,
  };
}

ponder.on(
  "QuestionRewardPoolEscrow:RewardPoolCreated",
  async ({ event, context }) => {
    const {
      rewardPoolId,
      contentId,
      funder,
      funderIdentityKey,
      asset,
      nonRefundable,
      amount,
      requiredVoters,
      requiredSettledRounds,
      startRoundId,
      bountyStartBy,
      bountyWindowSeconds,
      feedbackWindowSeconds,
      frontendFeeBps,
      bountyEligibility,
      bountyEligibilityDataHash,
    } = event.args;

    await context.db
      .insert(questionRewardPool)
      .values({
        id: rewardPoolId,
        contentId,
        funder,
        funderIdentityKey,
        asset: Number(asset),
        nonRefundable,
        bountyKind: 0,
        bountyEligibility: Number(bountyEligibility),
        bountyEligibilityDataHash,
        challengedRoundId: 0n,
        reasonHash: ZERO_HASH,
        fundedAmount: amount,
        unallocatedAmount: amount,
        allocatedAmount: 0n,
        claimedAmount: 0n,
        voterClaimedAmount: 0n,
        frontendClaimedAmount: 0n,
        refundedAmount: 0n,
        requiredVoters: Number(requiredVoters),
        requiredSettledRounds: Number(requiredSettledRounds),
        qualifiedRounds: 0,
        frontendFeeBps: Number(frontendFeeBps),
        startRoundId,
        bountyStartBy,
        // Windowless pools (bountyWindowSeconds == 0) never emit RewardPoolWindowActivated; the
        // contract opens them at creation time (bountyOpensAt = block.timestamp). Mirror that here
        // instead of leaving bountyOpensAt at 0. Windowed pools stay 0 until activation fills it in.
        bountyOpensAt: bountyWindowSeconds === 0n ? event.block.timestamp : 0n,
        bountyClosesAt: 0n,
        feedbackClosesAt: 0n,
        bountyWindowSeconds: Number(bountyWindowSeconds),
        feedbackWindowSeconds: Number(feedbackWindowSeconds),
        expiresAt: bountyStartBy,
        refunded: false,
        createdAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoNothing();

    const existingContent = await context.db.find(content, { id: contentId });
    if (existingContent) {
      await context.db.update(content, { id: contentId }).set({
        lastActivityAt: event.block.timestamp,
      });
    }
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:RewardPoolWindowActivated",
  async ({ event, context }) => {
    const { rewardPoolId, bountyOpensAt, bountyClosesAt, feedbackClosesAt } =
      event.args;

    await context.db.update(questionRewardPool, { id: rewardPoolId }).set({
      bountyOpensAt,
      bountyClosesAt,
      feedbackClosesAt,
      expiresAt: bountyClosesAt,
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:RewardPoolEligibilitySet",
  async ({ event, context }) => {
    const { rewardPoolId, bountyEligibility } = event.args;

    await context.db.update(questionRewardPool, { id: rewardPoolId }).set({
      bountyEligibility: Number(bountyEligibility),
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:RewardPoolPurposeSet",
  async ({ event, context }) => {
    const { rewardPoolId, bountyKind, challengedRoundId, reasonHash } =
      event.args;

    await context.db.update(questionRewardPool, { id: rewardPoolId }).set({
      bountyKind: Number(bountyKind),
      challengedRoundId,
      reasonHash,
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:RewardPoolForfeited",
  async ({ event, context }) => {
    const { rewardPoolId, amount } = event.args;
    const existingRewardPool = await context.db.find(questionRewardPool, {
      id: rewardPoolId,
    });

    await context.db
      .update(questionRewardPool, { id: rewardPoolId })
      .set((row) =>
        applyRewardPoolResidueUpdate(row, amount, event.block.timestamp),
      );

    if (existingRewardPool) {
      const existingContent = await context.db.find(content, {
        id: existingRewardPool.contentId,
      });
      if (existingContent) {
        await context.db
          .update(content, { id: existingRewardPool.contentId })
          .set({
            lastActivityAt: event.block.timestamp,
          });
      }
    }
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:RewardPoolRoundQualified",
  async ({ event, context }) => {
    const {
      rewardPoolId,
      contentId,
      roundId,
      allocation,
      eligibleVoters,
      frontendFeeAllocation,
    } = event.args;
    const id = `${rewardPoolId}-${roundId}`;
    const existingRound = await context.db.find(questionRewardPoolRound, {
      id,
    });

    // Re-qualification after a snapshot recovery works through this same insert: the
    // RejectedSnapshotRoundRecovered handler deletes the questionRewardPoolRound row (mirroring
    // the contract's `delete roundSnapshots[rewardPoolId][roundId]`), so a later
    // RewardPoolRoundQualified for the same round inserts a fresh row with the (possibly
    // different) new allocation and re-applies the pool aggregates below.
    await context.db
      .insert(questionRewardPoolRound)
      .values({
        id,
        rewardPoolId,
        contentId,
        roundId,
        allocation,
        frontendFeeAllocation,
        eligibleVoters: Number(eligibleVoters),
        rawEligibleVoters: Number(eligibleVoters),
        effectiveParticipantUnits: Number(eligibleVoters),
        totalClaimWeight: eligibleVoters,
        correlationEpochId: null,
        correlationWeightRoot: null,
        claimedAmount: 0n,
        voterClaimedAmount: 0n,
        frontendClaimedAmount: 0n,
        claimedCount: 0,
        qualifiedAt: event.block.timestamp,
      })
      .onConflictDoNothing();

    if (!existingRound) {
      await context.db
        .update(questionRewardPool, { id: rewardPoolId })
        .set((row) => ({
          unallocatedAmount: row.unallocatedAmount - allocation,
          allocatedAmount: row.allocatedAmount + allocation,
          qualifiedRounds: row.qualifiedRounds + 1,
          updatedAt: event.block.timestamp,
        }));
    }

    const existingContent = await context.db.find(content, { id: contentId });
    if (existingContent) {
      await context.db.update(content, { id: contentId }).set({
        lastActivityAt: event.block.timestamp,
      });
    }
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:RejectedSnapshotRoundRecovered",
  async ({ event, context }) => {
    const { rewardPoolId, contentId, roundId, allocationReturned } = event.args;
    const id = `${rewardPoolId}-${roundId}`;
    const existingRound = await context.db.find(questionRewardPoolRound, {
      id,
    });

    // Mirrors QuestionRewardPoolEscrowRecoveryLib.recoverRejectedSnapshotRound: the round is
    // un-qualified (qualifiedRounds -= 1), its allocation flows back into the unallocated
    // balance, and the round snapshot is deleted on-chain. Delete the round row so consumers
    // (which treat row presence as "qualified/claimable") stop presenting it, and so a later
    // re-qualification after RecoveredSnapshotRoundReopened inserts a fresh row via the
    // RewardPoolRoundQualified handler. The contract guarantees no claims were paid for the
    // round (`!snapshot.firstClaimPaid`), so no claim accounting is lost by the delete.
    if (existingRound) {
      await context.db.delete(questionRewardPoolRound, { id });

      await context.db
        .update(questionRewardPool, { id: rewardPoolId })
        .set((row) => ({
          unallocatedAmount: row.unallocatedAmount + allocationReturned,
          allocatedAmount: row.allocatedAmount - allocationReturned,
          qualifiedRounds: row.qualifiedRounds - 1,
          updatedAt: event.block.timestamp,
        }));
    }

    const existingContent = await context.db.find(content, { id: contentId });
    if (existingContent) {
      await context.db.update(content, { id: contentId }).set({
        lastActivityAt: event.block.timestamp,
      });
    }
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:RecoveredSnapshotRoundReopened",
  async ({ event, context }) => {
    const { rewardPoolId, contentId } = event.args;

    // Mirrors QuestionRewardPoolEscrowRecoveryLib.reopenRecoveredSnapshotRound: the round only
    // re-enters evaluation (cursor rewind + recovery flag reset) with no balance or
    // qualification change. The round row is re-created when the contract re-emits
    // RewardPoolRoundQualified, so here we only surface the activity to consumers.
    const existingRewardPool = await context.db.find(questionRewardPool, {
      id: rewardPoolId,
    });
    if (existingRewardPool) {
      await context.db.update(questionRewardPool, { id: rewardPoolId }).set({
        updatedAt: event.block.timestamp,
      });
    }

    const existingContent = await context.db.find(content, { id: contentId });
    if (existingContent) {
      await context.db.update(content, { id: contentId }).set({
        lastActivityAt: event.block.timestamp,
      });
    }
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:RewardPoolRoundEffectiveUnits",
  async ({ event, context }) => {
    const {
      rewardPoolId,
      roundId,
      rawEligibleVoters,
      effectiveParticipantUnits,
      totalClaimWeight,
    } = event.args;

    await context.db
      .update(questionRewardPoolRound, { id: `${rewardPoolId}-${roundId}` })
      .set({
        rawEligibleVoters: Number(rawEligibleVoters),
        effectiveParticipantUnits: Number(effectiveParticipantUnits),
        totalClaimWeight,
      });
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:RewardPoolRoundCorrelationSnapshotApplied",
  async ({ event, context }) => {
    const { rewardPoolId, roundId, correlationEpochId, weightRoot } =
      event.args;

    await context.db
      .update(questionRewardPoolRound, { id: `${rewardPoolId}-${roundId}` })
      .set({
        correlationEpochId,
        correlationWeightRoot: weightRoot,
      });
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:QuestionRewardClaimed",
  async ({ event, context }) => {
    const {
      rewardPoolId,
      contentId,
      roundId,
      claimant,
      identityKey,
      amount,
      frontend,
      frontendRecipient,
      frontendFee,
      grossAmount,
    } = event.args;
    const id = `${rewardPoolId}-${roundId}-${claimant.toLowerCase()}-${identityKey}`;
    const existingClaim = await context.db.find(questionRewardPoolClaim, {
      id,
    });

    await context.db
      .insert(questionRewardPoolClaim)
      .values({
        id,
        rewardPoolId,
        contentId,
        roundId,
        claimant,
        identityKey,
        amount,
        grossAmount,
        frontend,
        frontendRecipient,
        frontendFee,
        claimedAt: event.block.timestamp,
      })
      .onConflictDoNothing();

    if (!existingClaim) {
      await context.db
        .update(questionRewardPoolRound, { id: `${rewardPoolId}-${roundId}` })
        .set((row) => ({
          claimedAmount: row.claimedAmount + grossAmount,
          voterClaimedAmount: row.voterClaimedAmount + amount,
          frontendClaimedAmount: row.frontendClaimedAmount + frontendFee,
          claimedCount: row.claimedCount + 1,
        }));

      await context.db
        .update(questionRewardPool, { id: rewardPoolId })
        .set((row) => ({
          claimedAmount: row.claimedAmount + grossAmount,
          voterClaimedAmount: row.voterClaimedAmount + amount,
          frontendClaimedAmount: row.frontendClaimedAmount + frontendFee,
          updatedAt: event.block.timestamp,
        }));
    }
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:RewardPoolRefunded",
  async ({ event, context }) => {
    const { rewardPoolId, amount } = event.args;
    const existingRewardPool = await context.db.find(questionRewardPool, {
      id: rewardPoolId,
    });

    await context.db
      .update(questionRewardPool, { id: rewardPoolId })
      .set((row) =>
        applyRewardPoolResidueUpdate(row, amount, event.block.timestamp),
      );

    if (existingRewardPool) {
      const existingContent = await context.db.find(content, {
        id: existingRewardPool.contentId,
      });
      if (existingContent) {
        await context.db
          .update(content, { id: existingRewardPool.contentId })
          .set({
            lastActivityAt: event.block.timestamp,
          });
      }
    }
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:QuestionBundleRewardCreated",
  async ({ event, context }) => {
    const {
      bundleId,
      funder,
      funderIdentityKey,
      amount,
      requiredCompleters,
      questionCount,
      requiredSettledRounds,
      bountyStartBy,
      bountyWindowSeconds,
      feedbackWindowSeconds,
      frontendFeeBps,
      asset,
      bountyEligibility,
      bountyEligibilityDataHash,
    } = event.args;

    await context.db
      .insert(questionBundleReward)
      .values({
        id: bundleId,
        funder,
        funderIdentityKey,
        asset: Number(asset),
        fundedAmount: amount,
        claimedAmount: 0n,
        voterClaimedAmount: 0n,
        frontendClaimedAmount: 0n,
        refundedAmount: 0n,
        unallocatedAmount: amount,
        allocatedAmount: 0n,
        requiredCompleters: Number(requiredCompleters),
        requiredSettledRounds: Number(requiredSettledRounds),
        questionCount: Number(questionCount),
        completedRoundSetCount: 0,
        totalRecordedQuestionRounds: 0,
        claimedCount: 0,
        frontendFeeBps: Number(frontendFeeBps),
        bountyEligibility: Number(bountyEligibility),
        bountyEligibilityDataHash,
        bountyStartBy,
        // See RewardPoolCreated: windowless bundles open at creation time and never emit an
        // activation event, so mirror the contract's bountyOpensAt = block.timestamp here.
        bountyOpensAt: bountyWindowSeconds === 0n ? event.block.timestamp : 0n,
        bountyClosesAt: 0n,
        feedbackClosesAt: 0n,
        bountyWindowSeconds: Number(bountyWindowSeconds),
        feedbackWindowSeconds: Number(feedbackWindowSeconds),
        expiresAt: bountyStartBy,
        failed: false,
        refunded: false,
        createdAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      })
      // Bundles are created once. Use DoNothing (like the RewardPoolCreated sibling) so a
      // duplicate/replayed create cannot clobber an already-activated window: the previous
      // onConflictDoUpdate reset expiresAt back to bountyStartBy while leaving the activated
      // bountyOpensAt/bountyClosesAt set by QuestionBundleWindowActivated, an inconsistent state.
      .onConflictDoNothing();
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:QuestionBundleWindowActivated",
  async ({ event, context }) => {
    const { bundleId, bountyOpensAt, bountyClosesAt, feedbackClosesAt } =
      event.args;

    await context.db.update(questionBundleReward, { id: bundleId }).set({
      bountyOpensAt,
      bountyClosesAt,
      feedbackClosesAt,
      expiresAt: bountyClosesAt,
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:QuestionBundleEligibilitySet",
  async ({ event, context }) => {
    const { bundleId, bountyEligibility } = event.args;

    await context.db.update(questionBundleReward, { id: bundleId }).set({
      bountyEligibility: Number(bountyEligibility),
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:QuestionBundleRoundRecorded",
  async ({ event, context }) => {
    const { bundleId, contentId, roundId, bundleIndex, roundSetIndex } =
      event.args;
    const id = bundleRoundRowId(bundleId, roundSetIndex, bundleIndex);
    const existingRound = await context.db.find(questionBundleRound, { id });

    await context.db
      .insert(questionBundleRound)
      .values({
        id,
        bundleId,
        contentId,
        bundleIndex: Number(bundleIndex),
        roundSetIndex: Number(roundSetIndex),
        roundId,
        settled: true,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate(() => ({
        contentId,
        bundleIndex: Number(bundleIndex),
        roundSetIndex: Number(roundSetIndex),
        roundId,
        settled: true,
        updatedAt: event.block.timestamp,
      }));

    if (!existingRound) {
      await context.db
        .update(questionBundleReward, { id: bundleId })
        .set((row) => ({
          totalRecordedQuestionRounds: row.totalRecordedQuestionRounds + 1,
          updatedAt: event.block.timestamp,
        }));
    } else {
      await context.db.update(questionBundleReward, { id: bundleId }).set({
        updatedAt: event.block.timestamp,
      });
    }

    const existingContent = await context.db.find(content, { id: contentId });
    if (existingContent) {
      await context.db.update(content, { id: contentId }).set({
        lastActivityAt: event.block.timestamp,
      });
    }
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:QuestionBundleRoundSetQualified",
  async ({ event, context }) => {
    const { bundleId, roundSetIndex, allocation, frontendFeeAllocation } =
      event.args;
    const id = bundleRoundSetRowId(bundleId, roundSetIndex);
    const existingRoundSet = await context.db.find(questionBundleRoundSet, {
      id,
    });

    await context.db
      .insert(questionBundleRoundSet)
      .values({
        id,
        bundleId,
        roundSetIndex: Number(roundSetIndex),
        allocation,
        frontendFeeAllocation,
        rawEligibleCompleters: 0,
        effectiveParticipantUnits: 0,
        totalClaimWeight: 0n,
        correlationEpochId: null,
        correlationWeightRoot: null,
        claimedAmount: 0n,
        voterClaimedAmount: 0n,
        frontendClaimedAmount: 0n,
        claimedCount: 0,
        qualifiedAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoNothing();

    if (!existingRoundSet) {
      await context.db
        .update(questionBundleReward, { id: bundleId })
        .set((row) => ({
          unallocatedAmount: row.unallocatedAmount - allocation,
          allocatedAmount: row.allocatedAmount + allocation,
          completedRoundSetCount: row.completedRoundSetCount + 1,
          updatedAt: event.block.timestamp,
        }));
    }
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:RejectedSnapshotBundleRoundSetRecovered",
  async ({ event, context }) => {
    const { bundleId, roundSetIndex, allocationReturned } = event.args;
    const id = bundleRoundSetRowId(bundleId, roundSetIndex);
    const existingRoundSet = await context.db.find(questionBundleRoundSet, {
      id,
    });

    if (existingRoundSet) {
      await context.db.delete(questionBundleRoundSet, { id });

      await context.db.update(questionBundleReward, { id: bundleId }).set((row) => ({
        unallocatedAmount: row.unallocatedAmount + allocationReturned,
        allocatedAmount: row.allocatedAmount - allocationReturned,
        updatedAt: event.block.timestamp,
      }));
    }
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:RecoveredSnapshotBundleRoundSetReopened",
  async ({ event, context }) => {
    const { bundleId } = event.args;

    await context.db.update(questionBundleReward, { id: bundleId }).set({
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:QuestionBundleTerminalSkipped",
  async ({ event, context }) => {
    const { bundleId, contentId, roundId, reasonCode } = event.args;
    const logIndex = Number(event.log?.logIndex ?? 0);

    await context.db
      .insert(questionBundleTerminalSkip)
      .values({
        id: eventLogRowId(event),
        bundleId,
        contentId,
        roundId,
        reasonCode: Number(reasonCode),
        blockNumber: event.block.number,
        logIndex,
        transactionHash: event.transaction?.hash ?? null,
        skippedAt: event.block.timestamp,
      })
      .onConflictDoNothing();
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:QuestionBundleRoundSetCorrelationSnapshotApplied",
  async ({ event, context }) => {
    const {
      bundleId,
      roundSetIndex,
      correlationEpochId,
      rawEligibleCompleters,
      effectiveParticipantUnits,
      totalClaimWeight,
      weightRoot,
    } = event.args;

    await context.db
      .update(questionBundleRoundSet, {
        id: bundleRoundSetRowId(bundleId, roundSetIndex),
      })
      .set({
        rawEligibleCompleters: Number(rawEligibleCompleters),
        effectiveParticipantUnits: Number(effectiveParticipantUnits),
        totalClaimWeight,
        correlationEpochId,
        correlationWeightRoot: weightRoot,
        updatedAt: event.block.timestamp,
      });
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:QuestionBundleRewardClaimed",
  async ({ event, context }) => {
    const {
      bundleId,
      roundSetIndex,
      claimant,
      identityKey,
      amount,
      frontend,
      frontendRecipient,
      frontendFee,
      grossAmount,
    } = event.args;
    const id = bundleClaimRowId(bundleId, roundSetIndex, claimant, identityKey);
    const existingClaim = await context.db.find(questionBundleClaim, { id });

    await context.db
      .insert(questionBundleClaim)
      .values({
        id,
        bundleId,
        roundSetIndex: Number(roundSetIndex),
        claimant,
        identityKey,
        amount,
        grossAmount,
        frontend,
        frontendRecipient,
        frontendFee,
        claimedAt: event.block.timestamp,
      })
      .onConflictDoNothing();

    if (!existingClaim) {
      await context.db
        .update(questionBundleRoundSet, {
          id: bundleRoundSetRowId(bundleId, roundSetIndex),
        })
        .set((row) => ({
          claimedAmount: row.claimedAmount + grossAmount,
          voterClaimedAmount: row.voterClaimedAmount + amount,
          frontendClaimedAmount: row.frontendClaimedAmount + frontendFee,
          claimedCount: row.claimedCount + 1,
          updatedAt: event.block.timestamp,
        }));

      await context.db
        .update(questionBundleReward, { id: bundleId })
        .set((row) => ({
          claimedAmount: row.claimedAmount + grossAmount,
          voterClaimedAmount: row.voterClaimedAmount + amount,
          frontendClaimedAmount: row.frontendClaimedAmount + frontendFee,
          claimedCount: row.claimedCount + 1,
          updatedAt: event.block.timestamp,
        }));
    }
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:QuestionBundleRewardRefunded",
  async ({ event, context }) => {
    const { bundleId, amount } = event.args;

    await context.db
      .update(questionBundleReward, { id: bundleId })
      .set((row) =>
        applyBundleRewardResidueUpdate(row, amount, event.block.timestamp),
      );
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:QuestionBundleRewardForfeited",
  async ({ event, context }) => {
    const { bundleId, amount } = event.args;

    await context.db
      .update(questionBundleReward, { id: bundleId })
      .set((row) =>
        applyBundleRewardResidueUpdate(row, amount, event.block.timestamp),
      );
  },
);
