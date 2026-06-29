import { ponder } from "ponder:registry";
import { content, feedbackBonusAward, feedbackBonusPool, round } from "ponder:schema";
import { resolveFeedbackBonusAwardDeadline } from "./feedback-bonus-deadlines.js";

async function touchContent(context: { db: any }, contentId: bigint, timestamp: bigint) {
  const existingContent = await context.db.find(content, { id: contentId });
  if (existingContent) {
    await context.db.update(content, { id: contentId }).set({
      lastActivityAt: timestamp,
    });
  }
}

function toPositiveBigInt(value: bigint | number | string | null | undefined) {
  if (typeof value === "bigint") return value > 0n ? value : 0n;
  if (typeof value === "number") return value > 0 ? BigInt(value) : 0n;
  if (typeof value === "string" && value.length > 0) {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : 0n;
  }
  return 0n;
}

function resolveCreationAnchoredFeedbackClose({
  contentRecord,
  fallbackFeedbackClosesAt,
}: {
  contentRecord?: {
    createdAt?: bigint | null;
    roundEpochDuration?: number | null;
    roundMaxDuration?: number | null;
  } | null;
  fallbackFeedbackClosesAt: bigint;
}) {
  const createdAt = toPositiveBigInt(contentRecord?.createdAt);
  const duration =
    toPositiveBigInt(contentRecord?.roundEpochDuration) ||
    toPositiveBigInt(contentRecord?.roundMaxDuration);

  if (createdAt > 0n && duration > 0n) {
    return createdAt + duration;
  }

  return fallbackFeedbackClosesAt;
}

ponder.on("FeedbackBonusEscrow:FeedbackBonusPoolCreated", async ({ event, context }) => {
  const { poolId, contentId, roundId, funder, awarder, amount, feedbackClosesAt, frontendFeeBps, asset } = event.args;
  const contentRecord = await context.db.find(content, { id: contentId });
  const effectiveFeedbackClosesAt = resolveCreationAnchoredFeedbackClose({
    contentRecord,
    fallbackFeedbackClosesAt: feedbackClosesAt,
  });

  // Existing pools can be indexed after their target round is already settled.
  // Apply the same settledAt-aware deadline calculation here because no later
  // Round* terminal event will fire for this pool during a reindex. Cancelled
  // rounds deliberately never set settledAt and keep the requested deadline,
  // matching the contract.
  const targetRound = await context.db.find(round, {
    id: `${contentId}-${roundId}`,
  });
  const awardDeadline = resolveFeedbackBonusAwardDeadline(
    effectiveFeedbackClosesAt,
    targetRound?.settledAt ?? null,
  );

  await context.db
    .insert(feedbackBonusPool)
    .values({
      id: poolId,
      contentId,
      roundId,
      funder,
      awarder,
      asset: Number(asset ?? 1),
      fundedAmount: amount,
      remainingAmount: amount,
      awardedAmount: 0n,
      voterAwardedAmount: 0n,
      frontendAwardedAmount: 0n,
      forfeitedAmount: 0n,
      awardCount: 0,
      feedbackClosesAt: effectiveFeedbackClosesAt,
      awardDeadline,
      frontendFeeBps: Number(frontendFeeBps),
      forfeited: false,
      createdAt: event.block.timestamp,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoNothing();

  if (contentRecord) {
    await context.db.update(content, { id: contentId }).set({
      lastActivityAt: event.block.timestamp,
    });
  }
});

ponder.on("FeedbackBonusEscrow:FeedbackBonusAwarded", async ({ event, context }) => {
  const {
    poolId,
    contentId,
    roundId,
    recipient,
    identityKey,
    feedbackHash,
    grossAmount,
    recipientAmount,
    frontend,
    frontendRecipient,
    frontendFee,
  } = event.args;
  const awardId = `${poolId}-${feedbackHash}`;
  const existingPool = await context.db.find(feedbackBonusPool, { id: poolId });
  const existingAward = await context.db.find(feedbackBonusAward, { id: awardId });

  await context.db
    .insert(feedbackBonusAward)
    .values({
      id: awardId,
      poolId,
      contentId,
      roundId,
      recipient,
      identityKey,
      feedbackHash,
      asset: existingPool?.asset ?? 1,
      grossAmount,
      recipientAmount,
      frontend,
      frontendRecipient,
      frontendFee,
      awardedAt: event.block.timestamp,
    })
    .onConflictDoNothing();

  if (!existingAward) {
    await context.db.update(feedbackBonusPool, { id: poolId }).set((row) => ({
      remainingAmount: row.remainingAmount - grossAmount,
      awardedAmount: row.awardedAmount + grossAmount,
      voterAwardedAmount: row.voterAwardedAmount + recipientAmount,
      frontendAwardedAmount: row.frontendAwardedAmount + frontendFee,
      awardCount: row.awardCount + 1,
      updatedAt: event.block.timestamp,
    }));
  }

  await touchContent(context, contentId, event.block.timestamp);
});

// forfeitExpiredFeedbackBonus has two on-chain exit paths that both drain the
// pool to the same terminal state (remainingAmount=0, forfeited=true): the
// normal path sends the residue to the protocol treasury and emits
// FeedbackBonusForfeited, while the fallback (treasury unset) refunds the
// original funder and emits FeedbackBonusFunderRefunded. Both must drive the
// identical indexer transition, or a funder-refunded pool would forever report
// stale remaining funds. Index them through one shared handler.
async function indexFeedbackBonusForfeiture(
  event: { args: { poolId: bigint; amount: bigint }; block: { timestamp: bigint } },
  context: { db: any },
) {
  const { poolId, amount } = event.args;
  const existingPool = await context.db.find(feedbackBonusPool, { id: poolId });

  await context.db.update(feedbackBonusPool, { id: poolId }).set((row: any) => ({
    remainingAmount: 0n,
    forfeitedAmount: row.forfeitedAmount + amount,
    forfeited: true,
    updatedAt: event.block.timestamp,
  }));

  if (existingPool) {
    await touchContent(context, existingPool.contentId, event.block.timestamp);
  }
}

ponder.on("FeedbackBonusEscrow:FeedbackBonusForfeited", async ({ event, context }) => {
  await indexFeedbackBonusForfeiture(event, context);
});

ponder.on("FeedbackBonusEscrow:FeedbackBonusFunderRefunded", async ({ event, context }) => {
  await indexFeedbackBonusForfeiture(event, context);
});
