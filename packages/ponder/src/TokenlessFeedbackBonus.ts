import { ponder } from "ponder:registry";
import {
  tokenlessFeedbackBonusEvent,
  tokenlessFeedbackBonusPool,
  tokenlessFeedbackRecord,
} from "ponder:schema";
import {
  deploymentEventKey,
  feedbackBonusPoolKey,
  feedbackBonusRecordKey,
  resolveTokenlessDeployment,
} from "./protocol-deployment";

const deployment = resolveTokenlessDeployment();

async function eventWasIndexed(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
  id: string,
) {
  return Boolean(await context.db.find(tokenlessFeedbackBonusEvent, { id }));
}

ponder.on("TokenlessFeedbackBonus:PoolCreated", async ({ event, context }) => {
  const eventId = deploymentEventKey(
    deployment.deploymentKey,
    event.transaction.hash,
    event.log.logIndex,
  );
  if (await eventWasIndexed(context, eventId)) return;
  const {
    poolId,
    reviewId,
    contentId,
    admissionPolicyHash,
    payer,
    funder,
    awarder,
    amount,
    feedbackDeadline,
    awardDeadline,
  } = event.args;
  await context.db.insert(tokenlessFeedbackBonusPool).values({
    id: feedbackBonusPoolKey(deployment.deploymentKey, poolId),
    deploymentKey: deployment.deploymentKey,
    poolId,
    reviewId,
    contentId,
    admissionPolicyHash,
    payer,
    funder,
    awarder,
    depositedAmount: amount,
    awardedAmount: 0n,
    feedbackDeadline,
    awardDeadline,
    refunded: false,
    refundedAmount: 0n,
    createdAt: event.block.timestamp,
    createdBlock: event.block.number,
    createdTxHash: event.transaction.hash,
    updatedAt: event.block.timestamp,
  });
  await context.db.insert(tokenlessFeedbackBonusEvent).values({
    id: eventId,
    deploymentKey: deployment.deploymentKey,
    eventType: "pool_created",
    poolId,
    feedbackKey: null,
    responseHash: null,
    actor: payer,
    payoutAddress: null,
    amount,
    occurredAt: event.block.timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
  });
});

ponder.on(
  "TokenlessFeedbackBonus:FeedbackRegistered",
  async ({ event, context }) => {
    const eventId = deploymentEventKey(
      deployment.deploymentKey,
      event.transaction.hash,
      event.log.logIndex,
    );
    if (await eventWasIndexed(context, eventId)) return;
    const { poolId, feedbackKey, responseHash, voteKey, payoutCommitment } =
      event.args;
    const pool = await context.db.find(tokenlessFeedbackBonusPool, {
      id: feedbackBonusPoolKey(deployment.deploymentKey, poolId),
    });
    if (!pool) {
      throw new Error(
        `Feedback registration references unknown pool ${poolId}.`,
      );
    }
    await context.db.insert(tokenlessFeedbackRecord).values({
      id: feedbackBonusRecordKey(deployment.deploymentKey, feedbackKey),
      deploymentKey: deployment.deploymentKey,
      poolId,
      feedbackKey,
      responseHash,
      voteKey,
      payoutCommitment,
      awarded: false,
      awardAmount: 0n,
      payoutAddress: null,
      registeredAt: event.block.timestamp,
      registeredBlock: event.block.number,
      registeredTxHash: event.transaction.hash,
      registeredLogIndex: event.log.logIndex,
      awardedAt: null,
      awardTxHash: null,
      awardLogIndex: null,
    });
    await context.db.insert(tokenlessFeedbackBonusEvent).values({
      id: eventId,
      deploymentKey: deployment.deploymentKey,
      eventType: "feedback_registered",
      poolId,
      feedbackKey,
      responseHash,
      actor: voteKey,
      payoutAddress: null,
      amount: 0n,
      occurredAt: event.block.timestamp,
      blockNumber: event.block.number,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
    });
  },
);

ponder.on(
  "TokenlessFeedbackBonus:FeedbackAwarded",
  async ({ event, context }) => {
    const eventId = deploymentEventKey(
      deployment.deploymentKey,
      event.transaction.hash,
      event.log.logIndex,
    );
    if (await eventWasIndexed(context, eventId)) return;
    const {
      poolId,
      feedbackKey,
      responseHash,
      voteKey,
      payoutAddress,
      amount,
    } = event.args;
    const poolIdKey = feedbackBonusPoolKey(deployment.deploymentKey, poolId);
    const feedbackId = feedbackBonusRecordKey(
      deployment.deploymentKey,
      feedbackKey,
    );
    const [pool, feedback] = await Promise.all([
      context.db.find(tokenlessFeedbackBonusPool, { id: poolIdKey }),
      context.db.find(tokenlessFeedbackRecord, { id: feedbackId }),
    ]);
    if (!pool || !feedback) {
      throw new Error(
        `Feedback award references unknown pool or feedback ${poolId}.`,
      );
    }
    if (
      feedback.poolId !== poolId ||
      feedback.responseHash !== responseHash ||
      feedback.voteKey.toLowerCase() !== voteKey.toLowerCase()
    ) {
      throw new Error(
        `Feedback award does not match registered feedback ${feedbackKey}.`,
      );
    }
    await context.db.update(tokenlessFeedbackRecord, { id: feedbackId }).set({
      awarded: true,
      awardAmount: amount,
      payoutAddress,
      awardedAt: event.block.timestamp,
      awardTxHash: event.transaction.hash,
      awardLogIndex: event.log.logIndex,
    });
    await context.db.update(tokenlessFeedbackBonusPool, { id: poolIdKey }).set({
      awardedAmount: pool.awardedAmount + amount,
      updatedAt: event.block.timestamp,
    });
    await context.db.insert(tokenlessFeedbackBonusEvent).values({
      id: eventId,
      deploymentKey: deployment.deploymentKey,
      eventType: "feedback_awarded",
      poolId,
      feedbackKey,
      responseHash,
      actor: voteKey,
      payoutAddress,
      amount,
      occurredAt: event.block.timestamp,
      blockNumber: event.block.number,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
    });
  },
);

ponder.on(
  "TokenlessFeedbackBonus:RemainderRefunded",
  async ({ event, context }) => {
    const eventId = deploymentEventKey(
      deployment.deploymentKey,
      event.transaction.hash,
      event.log.logIndex,
    );
    if (await eventWasIndexed(context, eventId)) return;
    const { poolId, funder, amount } = event.args;
    const id = feedbackBonusPoolKey(deployment.deploymentKey, poolId);
    const pool = await context.db.find(tokenlessFeedbackBonusPool, { id });
    if (!pool || pool.funder.toLowerCase() !== funder.toLowerCase()) {
      throw new Error(
        `Feedback refund references unknown or mismatched pool ${poolId}.`,
      );
    }
    await context.db.update(tokenlessFeedbackBonusPool, { id }).set({
      refunded: true,
      refundedAmount: amount,
      updatedAt: event.block.timestamp,
    });
    await context.db.insert(tokenlessFeedbackBonusEvent).values({
      id: eventId,
      deploymentKey: deployment.deploymentKey,
      eventType: "remainder_refunded",
      poolId,
      feedbackKey: null,
      responseHash: null,
      actor: funder,
      payoutAddress: funder,
      amount,
      occurredAt: event.block.timestamp,
      blockNumber: event.block.number,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
    });
  },
);
