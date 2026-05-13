import { ponder } from "ponder:registry";
import {
  content,
  questionBundleClaim,
  questionBundleQuestion,
  questionBundleRound,
  questionBundleRoundSet,
  questionBundleReward,
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

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

function serializeDeclarationIds(ids: readonly string[]) {
  return JSON.stringify(ids.map((id) => id.toLowerCase()));
}

ponder.on(
  "QuestionRewardPoolEscrow:RewardPoolCreated",
  async ({ event, context }) => {
    const {
      rewardPoolId,
      contentId,
      funder,
      funderVoterId,
      asset,
      nonRefundable,
      amount,
      requiredVoters,
      requiredSettledRounds,
      startRoundId,
      bountyOpensAt,
      bountyClosesAt,
      feedbackClosesAt,
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
        funderVoterId,
        asset: Number(asset),
        nonRefundable,
        bountyKind: 0,
        bountyEligibility: Number(bountyEligibility),
        bountyEligibilityDataHash,
        eligibleAiDeclarationIds: "[]",
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
        bountyOpensAt,
        bountyClosesAt,
        feedbackClosesAt,
        expiresAt: bountyClosesAt,
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
  "QuestionRewardPoolEscrow:RewardPoolEligibilitySet",
  async ({ event, context }) => {
    const { rewardPoolId, bountyEligibility, allowedAiDeclarationIds } =
      event.args;

    await context.db.update(questionRewardPool, { id: rewardPoolId }).set({
      bountyEligibility: Number(bountyEligibility),
      eligibleAiDeclarationIds: serializeDeclarationIds(
        allowedAiDeclarationIds,
      ),
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
      .set((row) => ({
        unallocatedAmount: 0n,
        refundedAmount: row.refundedAmount + amount,
        refunded: true,
        updatedAt: event.block.timestamp,
      }));

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

    await context.db
      .insert(questionRewardPoolRound)
      .values({
        id: `${rewardPoolId}-${roundId}`,
        rewardPoolId,
        contentId,
        roundId,
        allocation,
        frontendFeeAllocation,
        eligibleVoters: Number(eligibleVoters),
        rawEligibleVoters: Number(eligibleVoters),
        effectiveParticipantUnits: Number(eligibleVoters),
        totalClaimWeight: eligibleVoters,
        claimedAmount: 0n,
        voterClaimedAmount: 0n,
        frontendClaimedAmount: 0n,
        claimedCount: 0,
        qualifiedAt: event.block.timestamp,
      })
      .onConflictDoNothing();

    await context.db
      .update(questionRewardPool, { id: rewardPoolId })
      .set((row) => ({
        unallocatedAmount: row.unallocatedAmount - allocation,
        allocatedAmount: row.allocatedAmount + allocation,
        qualifiedRounds: row.qualifiedRounds + 1,
        updatedAt: event.block.timestamp,
      }));

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
  "QuestionRewardPoolEscrow:QuestionRewardClaimed",
  async ({ event, context }) => {
    const {
      rewardPoolId,
      contentId,
      roundId,
      claimant,
      voterId,
      amount,
      frontend,
      frontendRecipient,
      frontendFee,
      grossAmount,
    } = event.args;

    await context.db
      .insert(questionRewardPoolClaim)
      .values({
        id: `${rewardPoolId}-${roundId}-${claimant.toLowerCase()}-${voterId}`,
        rewardPoolId,
        contentId,
        roundId,
        claimant,
        voterId,
        amount,
        grossAmount,
        frontend,
        frontendRecipient,
        frontendFee,
        claimedAt: event.block.timestamp,
      })
      .onConflictDoNothing();

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
      .set((row) => ({
        unallocatedAmount: 0n,
        refundedAmount: row.refundedAmount + amount,
        refunded: true,
        updatedAt: event.block.timestamp,
      }));

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
      funderVoterId,
      amount,
      requiredCompleters,
      questionCount,
      requiredSettledRounds,
      bountyOpensAt,
      bountyClosesAt,
      feedbackClosesAt,
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
        funderVoterId,
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
        eligibleAiDeclarationIds: "[]",
        bountyOpensAt,
        bountyClosesAt,
        feedbackClosesAt,
        expiresAt: bountyClosesAt,
        failed: false,
        refunded: false,
        createdAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate((row) => ({
        funder,
        funderVoterId,
        asset: Number(asset),
        fundedAmount: amount,
        requiredCompleters: Number(requiredCompleters),
        requiredSettledRounds: Number(requiredSettledRounds),
        questionCount: Number(questionCount),
        frontendFeeBps: Number(frontendFeeBps),
        bountyEligibility: Number(bountyEligibility),
        bountyEligibilityDataHash,
        bountyOpensAt,
        bountyClosesAt,
        feedbackClosesAt,
        expiresAt: bountyClosesAt,
        updatedAt: event.block.timestamp,
        claimedAmount: row.claimedAmount,
        voterClaimedAmount: row.voterClaimedAmount,
        frontendClaimedAmount: row.frontendClaimedAmount,
        refundedAmount: row.refundedAmount,
        unallocatedAmount: row.unallocatedAmount,
        allocatedAmount: row.allocatedAmount,
        completedRoundSetCount: row.completedRoundSetCount,
        totalRecordedQuestionRounds: row.totalRecordedQuestionRounds,
        claimedCount: row.claimedCount,
        failed: row.failed,
        refunded: row.refunded,
      }));
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:QuestionBundleEligibilitySet",
  async ({ event, context }) => {
    const { bundleId, bountyEligibility, allowedAiDeclarationIds } =
      event.args;

    await context.db.update(questionBundleReward, { id: bundleId }).set({
      bountyEligibility: Number(bountyEligibility),
      eligibleAiDeclarationIds: serializeDeclarationIds(
        allowedAiDeclarationIds,
      ),
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
  "QuestionRewardPoolEscrow:QuestionBundleRewardClaimed",
  async ({ event, context }) => {
    const {
      bundleId,
      roundSetIndex,
      claimant,
      voterId,
      amount,
      frontend,
      frontendRecipient,
      frontendFee,
      grossAmount,
    } = event.args;
    const id = `${bundleId}-${roundSetIndex}-${voterId}`;
    const existingClaim = await context.db.find(questionBundleClaim, { id });

    await context.db
      .insert(questionBundleClaim)
      .values({
        id,
        bundleId,
        roundSetIndex: Number(roundSetIndex),
        claimant,
        voterId,
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
      .set((row) => ({
        unallocatedAmount: 0n,
        refundedAmount: row.refundedAmount + amount,
        refunded: true,
        updatedAt: event.block.timestamp,
      }));
  },
);

ponder.on(
  "QuestionRewardPoolEscrow:QuestionBundleRewardForfeited",
  async ({ event, context }) => {
    const { bundleId, amount } = event.args;

    await context.db
      .update(questionBundleReward, { id: bundleId })
      .set((row) => ({
        unallocatedAmount: 0n,
        refundedAmount: row.refundedAmount + amount,
        refunded: true,
        updatedAt: event.block.timestamp,
      }));
  },
);
