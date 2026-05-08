import { ponder } from "ponder:registry";
import {
  aiRaterDeclaration,
  aiRaterDeclarationChallenge,
  aiRaterDeclarationHistory,
  aiRaterDriftFlag,
  aiRaterOperatorBond,
  aiRaterProbeResult,
} from "ponder:schema";

function declarationHistoryId(rater: string, version: number) {
  return `${rater}-${version}`;
}

function eventId(event: { transaction: { hash: string }; log: { logIndex: number } }) {
  return `${event.transaction.hash}-${event.log.logIndex}`;
}

ponder.on("RaterDeclarationRegistry:OperatorBondDeposited", async ({ event, context }) => {
  const { operator, totalBond } = event.args;

  await context.db
    .insert(aiRaterOperatorBond)
    .values({
      operator,
      totalBond,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      totalBond,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("RaterDeclarationRegistry:OperatorBondWithdrawn", async ({ event, context }) => {
  const { operator, remainingBond } = event.args;

  await context.db
    .insert(aiRaterOperatorBond)
    .values({
      operator,
      totalBond: remainingBond,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      totalBond: remainingBond,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("RaterDeclarationRegistry:DeclarationSubmitted", async ({ event, context }) => {
  const {
    rater,
    operator,
    version,
    tier,
    behaviorChanged,
    probePending,
    declarationHash,
    modelClass,
    modelId,
    provider,
    promptTemplateHash,
    retrievalConfigHash,
    toolingHash,
    disclosure,
  } = event.args;

  const values = {
    rater,
    operator,
    version: Number(version),
    tier: Number(tier),
    behaviorChanged,
    probePending,
    declarationHash,
    modelClass: Number(modelClass),
    modelId,
    provider,
    promptTemplateHash,
    retrievalConfigHash,
    toolingHash,
    disclosure: Number(disclosure),
    declaredAt: event.block.timestamp,
    retiredAt: null,
    lastProbeResultHash: null,
    updatedAt: event.block.timestamp,
  };

  await context.db.insert(aiRaterDeclaration).values(values).onConflictDoUpdate(values);

  await context.db
    .insert(aiRaterDeclarationHistory)
    .values({
      id: declarationHistoryId(rater, Number(version)),
      ...values,
    })
    .onConflictDoUpdate(values);
});

ponder.on("RaterDeclarationRegistry:DeclarationRetired", async ({ event, context }) => {
  const { rater, version } = event.args;
  const historyId = declarationHistoryId(rater, Number(version));

  await context.db.update(aiRaterDeclaration, { rater }).set({
    tier: 0,
    probePending: false,
    retiredAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
  });

  await context.db.update(aiRaterDeclarationHistory, { id: historyId }).set({
    tier: 0,
    probePending: false,
    retiredAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
  });
});

ponder.on("RaterDeclarationRegistry:ProbeResultRecorded", async ({ event, context }) => {
  const { rater, operator, version, passed, confidenceBps, probeLibraryHash, resultHash } = event.args;
  const numericVersion = Number(version);
  const tier = passed ? 2 : 1;
  const historyId = declarationHistoryId(rater, numericVersion);

  await context.db
    .insert(aiRaterProbeResult)
    .values({
      id: `${rater}-${numericVersion}-${eventId(event)}`,
      rater,
      operator,
      version: numericVersion,
      passed,
      confidenceBps: Number(confidenceBps),
      probeLibraryHash,
      resultHash,
      recordedAt: event.block.timestamp,
    })
    .onConflictDoNothing();

  await context.db.update(aiRaterDeclaration, { rater }).set({
    tier,
    probePending: false,
    lastProbeResultHash: resultHash,
    updatedAt: event.block.timestamp,
  });

  await context.db.update(aiRaterDeclarationHistory, { id: historyId }).set({
    tier,
    probePending: false,
    lastProbeResultHash: resultHash,
    updatedAt: event.block.timestamp,
  });
});

ponder.on("RaterDeclarationRegistry:BehavioralDriftFlagged", async ({ event, context }) => {
  const { rater, operator, version, driftScoreBps, evidenceHash } = event.args;
  const numericVersion = Number(version);
  const historyId = declarationHistoryId(rater, numericVersion);

  await context.db
    .insert(aiRaterDriftFlag)
    .values({
      id: eventId(event),
      rater,
      operator,
      version: numericVersion,
      driftScoreBps: Number(driftScoreBps),
      evidenceHash,
      flaggedAt: event.block.timestamp,
    })
    .onConflictDoNothing();

  await context.db.update(aiRaterDeclaration, { rater }).set({
    tier: 1,
    updatedAt: event.block.timestamp,
  });

  await context.db.update(aiRaterDeclarationHistory, { id: historyId }).set({
    tier: 1,
    updatedAt: event.block.timestamp,
  });
});

ponder.on("RaterDeclarationRegistry:ChallengeOpened", async ({ event, context }) => {
  const { challengeId, challenger, rater, operator, declarationVersion, bondAmount, evidenceHash } = event.args as typeof event.args & {
    bondAmount: bigint;
  };

  await context.db
    .insert(aiRaterDeclarationChallenge)
    .values({
      challengeId,
      challenger,
      rater,
      operator,
      declarationVersion: Number(declarationVersion),
      evidenceHash,
      resolutionHash: null,
      bondAmount,
      status: 1,
      operatorSlash: 0n,
      challengerReward: 0n,
      openedAt: event.block.timestamp,
      resolvedAt: null,
    })
    .onConflictDoNothing();
});

ponder.on("RaterDeclarationRegistry:ChallengeResolved", async ({ event, context }) => {
  const { challengeId, status, operatorSlash, challengerReward, resolutionHash } = event.args;

  await context.db.update(aiRaterDeclarationChallenge, { challengeId }).set({
    status: Number(status),
    operatorSlash,
    challengerReward,
    resolutionHash,
    resolvedAt: event.block.timestamp,
  });
});
