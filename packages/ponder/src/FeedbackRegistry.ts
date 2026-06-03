import { ponder } from "ponder:registry";
import { content, contentFeedback } from "ponder:schema";

function feedbackRowId(contentId: bigint, roundId: bigint, commitKey: string) {
  return `${contentId.toString()}-${roundId.toString()}-${commitKey}`;
}

async function touchContent(context: { db: any }, contentId: bigint, timestamp: bigint) {
  const existingContent = await context.db.find(content, { id: contentId });
  if (existingContent) {
    await context.db.update(content, { id: contentId }).set({
      lastActivityAt: timestamp,
    });
  }
}

ponder.on("FeedbackRegistry:FeedbackPublished", async ({ event, context }) => {
  const {
    contentId,
    roundId,
    commitKey,
    author,
    feedbackHash,
    feedbackType,
    body,
    sourceUrl,
    clientNonce,
  } = event.args;

  await context.db
    .insert(contentFeedback)
    .values({
      id: feedbackRowId(contentId, roundId, commitKey),
      contentId,
      roundId,
      commitKey,
      author,
      feedbackHash,
      committedAt: event.block.timestamp,
      commitTxHash: event.transaction.hash,
      commitBlockNumber: event.block.number,
      commitLogIndex: Number(event.log?.logIndex ?? 0),
      revealed: true,
      feedbackType,
      body,
      sourceUrl,
      clientNonce,
      revealedAt: event.block.timestamp,
      revealTxHash: event.transaction.hash,
      revealBlockNumber: event.block.number,
      revealLogIndex: Number(event.log?.logIndex ?? 0),
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate(() => ({
      author,
      feedbackHash,
      revealed: true,
      feedbackType,
      body,
      sourceUrl,
      clientNonce,
      revealedAt: event.block.timestamp,
      revealTxHash: event.transaction.hash,
      revealBlockNumber: event.block.number,
      revealLogIndex: Number(event.log?.logIndex ?? 0),
      updatedAt: event.block.timestamp,
    }));

  await touchContent(context, contentId, event.block.timestamp);
});
