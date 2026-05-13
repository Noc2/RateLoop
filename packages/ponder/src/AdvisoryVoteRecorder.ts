import { ponder } from "ponder:registry";
import { advisoryVote } from "ponder:schema";

ponder.on("AdvisoryVoteRecorder:AdvisoryVoteRecorded", async ({ event, context }) => {
  const {
    contentId,
    roundId,
    voter,
    advisoryCommitKey,
    commitHash,
    roundReferenceRatingBps,
    targetRound,
    drandChainHash,
  } = event.args;

  await context.db
    .insert(advisoryVote)
    .values({
      id: advisoryCommitKey,
      contentId,
      roundId,
      voter,
      commitHash,
      targetRound,
      drandChainHash,
      roundReferenceRatingBps: Number(roundReferenceRatingBps),
      paidAmount: 0n,
      launchCreditClaimed: false,
      revealed: false,
      committedAt: event.block.timestamp,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      commitHash,
      targetRound,
      drandChainHash,
      roundReferenceRatingBps: Number(roundReferenceRatingBps),
      updatedAt: event.block.timestamp,
    });
});

ponder.on("AdvisoryVoteRecorder:AdvisoryVoteRevealed", async ({ event, context }) => {
  const { advisoryCommitKey, isUp, predictedUpBps } = event.args;

  await context.db
    .update(advisoryVote, { id: advisoryCommitKey })
    .set({
      isUp,
      predictedUpBps: Number(predictedUpBps),
      revealed: true,
      revealedAt: event.block.timestamp,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("AdvisoryVoteRecorder:AdvisoryLaunchCreditClaimed", async ({ event, context }) => {
  const { advisoryCommitKey, scoreBps, paidAmount } = event.args;

  await context.db
    .update(advisoryVote, { id: advisoryCommitKey })
    .set((row: any) => ({
      scoreBps: Number(scoreBps),
      paidAmount: row.paidAmount + paidAmount,
      launchCreditClaimed: true,
      creditedAt: event.block.timestamp,
      updatedAt: event.block.timestamp,
    }));
});
