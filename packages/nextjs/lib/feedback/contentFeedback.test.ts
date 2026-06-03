import { ROUND_STATE } from "@rateloop/contracts/protocol";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

process.env.DATABASE_URL = "memory:";

type ContentFeedbackModule = typeof import("./contentFeedback");
type NormalizedContentFeedbackInput = import("./contentFeedback").NormalizedContentFeedbackInput;
type ContentFeedbackRoundContext = import("./contentFeedback").ContentFeedbackRoundContext;
type PonderFeedbackBonusAward = import("~~/services/ponder/client").PonderFeedbackBonusAward;
type PonderFeedbackBonusPool = import("~~/services/ponder/client").PonderFeedbackBonusPool;
type PonderRoundItem = import("~~/services/ponder/client").PonderRoundItem;
type PonderVoteItem = import("~~/services/ponder/client").PonderVoteItem;
type PonderVotesResponse = import("~~/services/ponder/client").PonderVotesResponse;
type DbModule = typeof import("../db");
type DbTestMemoryModule = typeof import("../db/testMemory");

let contentFeedback: ContentFeedbackModule;
let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;

const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;
const OTHER_WALLET = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const;
const CHAIN_ID = 31337;
const SIGNATURE = `0x${"11".repeat(65)}` as `0x${string}`;
let nonceCounter = 1n;

function nextNonce(): `0x${string}` {
  return `0x${(nonceCounter++).toString(16).padStart(64, "0")}` as `0x${string}`;
}

function prepareFeedback(payload: NormalizedContentFeedbackInput, context: ContentFeedbackRoundContext) {
  assert.ok(context.currentRoundId);
  return contentFeedback.buildPreparedContentFeedbackInput(payload, {
    chainId: CHAIN_ID,
    roundId: context.currentRoundId,
    commitKey: nextNonce(),
    clientNonce: nextNonce(),
    payloadSignature: SIGNATURE,
  });
}

function buildVotesResponse(items: PonderVoteItem[]): PonderVotesResponse {
  return {
    items,
    limit: items.length,
    offset: 0,
    settledTotal: 0,
    total: items.length,
  };
}

function buildVoteItem(params: { contentId: string; roundId: string; voter: string }): PonderVoteItem {
  return {
    id: `${params.contentId}-${params.roundId}-${params.voter}`,
    contentId: params.contentId,
    roundId: params.roundId,
    voter: params.voter,
    isUp: null,
    stake: "0",
    epochIndex: 0,
    revealed: false,
    committedAt: "1000",
    revealedAt: null,
    roundStartTime: null,
    roundState: ROUND_STATE.Open,
    roundUpWins: null,
  };
}

function buildRoundItem(params: { contentId?: string; roundId: string; state: number }): PonderRoundItem {
  return {
    id: `${params.contentId ?? "1"}-${params.roundId}`,
    contentId: params.contentId ?? "1",
    roundId: params.roundId,
    state: params.state,
    voteCount: 0,
    revealedCount: 0,
    totalStake: "0",
    upPool: "0",
    downPool: "0",
    upCount: 0,
    downCount: 0,
    upWins: null,
    losingPool: null,
    startTime: null,
    settledAt: null,
    title: null,
    description: null,
    url: null,
    submitter: null,
    categoryId: null,
  };
}

function buildFeedbackBonusPool(params: Partial<PonderFeedbackBonusPool> = {}): PonderFeedbackBonusPool {
  return {
    id: "7",
    contentId: "13",
    roundId: "8",
    funder: WALLET,
    awarder: WALLET,
    asset: 0,
    fundedAmount: "5000000",
    remainingAmount: "3000000",
    awardedAmount: "2000000",
    voterAwardedAmount: "1940000",
    frontendAwardedAmount: "60000",
    forfeitedAmount: "0",
    awardCount: 1,
    feedbackClosesAt: "2000",
    awardDeadline: "2600",
    frontendFeeBps: 300,
    forfeited: false,
    createdAt: "1000",
    updatedAt: "1200",
    ...params,
  };
}

function buildFeedbackBonusAward(params: Partial<PonderFeedbackBonusAward> = {}): PonderFeedbackBonusAward {
  return {
    id: "7-1",
    poolId: "7",
    contentId: "13",
    roundId: "8",
    recipient: WALLET,
    identityKey: `0x${"22".repeat(32)}`,
    feedbackHash: `0x${"33".repeat(32)}`,
    asset: 0,
    grossAmount: "1000000",
    recipientAmount: "970000",
    frontend: WALLET,
    frontendRecipient: WALLET,
    frontendFee: "30000",
    awardedAt: "1500",
    ...params,
  };
}

before(async () => {
  dbModule = await import("../db");
  dbTestMemory = await import("../db/testMemory");
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  contentFeedback = await import("./contentFeedback");
});

beforeEach(async () => {
  contentFeedback.__setContentFeedbackVoteEligibilityTestOverridesForTests(null);
  await dbModule.dbClient.execute("DELETE FROM content_feedback");
});

after(() => {
  contentFeedback.__setContentFeedbackVoteEligibilityTestOverridesForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);
});

test("normalizes structured feedback input", () => {
  const normalized = contentFeedback.normalizeContentFeedbackInput({
    address: "0x1234567890ABCDEF1234567890ABCDEF12345678",
    contentId: "00042",
    feedbackType: "AI_NOTE",
    body: "  This needs the publication date checked.  ",
    sourceUrl: "https://example.com/source",
  });

  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;
  assert.deepEqual(normalized.payload, {
    normalizedAddress: WALLET,
    contentId: "42",
    feedbackType: "ai_note",
    body: "This needs the publication date checked.",
    sourceUrl: "https://example.com/source",
  });
});

test("normalizes feature testing feedback types", () => {
  const normalized = contentFeedback.normalizeContentFeedbackInput({
    address: WALLET,
    contentId: "43",
    feedbackType: "REPRO_STEPS",
    body: "Steps: open preview, connect wallet, refresh, and observe the disconnected state.",
  });

  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;
  assert.equal(normalized.payload.feedbackType, "repro_steps");
});

test("normalizes other feedback type", () => {
  const normalized = contentFeedback.normalizeContentFeedbackInput({
    address: WALLET,
    contentId: "44",
    feedbackType: "OTHER",
    body: "This note does not fit the predefined feedback buckets.",
  });

  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;
  assert.equal(normalized.payload.feedbackType, "other");
});

test("rejects invalid feedback fields", () => {
  assert.equal(
    contentFeedback.normalizeContentFeedbackInput({
      address: WALLET,
      contentId: "1",
      feedbackType: "chat",
      body: "Valid body",
    }).ok,
    false,
  );
  assert.equal(
    contentFeedback.normalizeContentFeedbackInput({
      address: WALLET,
      contentId: "1",
      feedbackType: "evidence",
      body: "x",
    }).ok,
    false,
  );
  assert.equal(
    contentFeedback.normalizeContentFeedbackInput({
      address: WALLET,
      contentId: "1",
      feedbackType: "evidence",
      body: "Valid body",
      sourceUrl: "ipfs://example",
    }).ok,
    false,
  );
});

test("builds stable canonical feedback hash metadata", () => {
  const context = contentFeedback.buildContentFeedbackRoundContext([{ roundId: "7", state: ROUND_STATE.Open }]);
  const payload = contentFeedback.normalizeContentFeedbackInput({
    address: WALLET,
    contentId: "12",
    feedbackType: "concern",
    body: "The wording could be interpreted two different ways.",
  });
  assert.equal(payload.ok, true);
  if (!payload.ok) return;

  const clientNonce = nextNonce();
  const commitKey = nextNonce();
  const prepared = contentFeedback.buildPreparedContentFeedbackInput(payload.payload, {
    chainId: CHAIN_ID,
    roundId: context.currentRoundId!,
    commitKey,
    clientNonce,
    payloadSignature: SIGNATURE,
  });
  const preparedAgain = contentFeedback.buildPreparedContentFeedbackInput(payload.payload, {
    chainId: CHAIN_ID,
    roundId: context.currentRoundId!,
    commitKey,
    clientNonce,
    feedbackHash: prepared.feedbackHash,
    payloadSignature: SIGNATURE,
  });

  assert.equal(prepared.feedbackHash, preparedAgain.feedbackHash);
  assert.equal(prepared.feedbackHash.length, 66);
  assert.equal(prepared.chainId, CHAIN_ID);
  assert.equal(prepared.roundId, "7");
  assert.equal(prepared.clientNonce, clientNonce);
});

test("builds round context from terminal and open rounds", () => {
  const context = contentFeedback.buildContentFeedbackRoundContext([
    { roundId: "1", state: ROUND_STATE.Settled },
    { roundId: "2", state: ROUND_STATE.Open },
  ]);

  assert.equal(context.openRoundId, "2");
  assert.equal(context.currentRoundId, "2");
  assert.equal(context.settlementComplete, false);
  assert.equal(context.terminalRoundIds.has("1"), true);
  assert.equal(context.terminalRoundIds.has("2"), false);
});

test("resolves open feedback round from on-chain fallback when ponder is stale", async () => {
  let observedContentId: string | undefined;
  let observedChainId: number | undefined;
  contentFeedback.__setContentFeedbackVoteEligibilityTestOverridesForTests({
    getContentById: async () => ({ content: { openRound: null } }) as any,
    getAllRounds: async () => [buildRoundItem({ contentId: "18", roundId: "1", state: ROUND_STATE.Settled })],
    resolveOnchainOpenRoundId: async params => {
      observedContentId = params.contentId;
      observedChainId = params.chainId;
      return "3";
    },
  });

  const context = await contentFeedback.resolveContentFeedbackRoundContext("18", CHAIN_ID);

  assert.equal(context.openRoundId, "3");
  assert.equal(context.currentRoundId, "3");
  assert.equal(context.terminalRoundIds.has("1"), true);
  assert.equal(context.settlementComplete, false);
  assert.equal(observedContentId, "18");
  assert.equal(observedChainId, CHAIN_ID);
});

test("keeps ponder open round ahead of on-chain fallback", async () => {
  let fallbackCalled = false;
  contentFeedback.__setContentFeedbackVoteEligibilityTestOverridesForTests({
    getContentById: async () => ({ content: { openRound: { roundId: "2" } } }) as any,
    getAllRounds: async () => [buildRoundItem({ contentId: "19", roundId: "2", state: ROUND_STATE.Open })],
    resolveOnchainOpenRoundId: async () => {
      fallbackCalled = true;
      return "3";
    },
  });

  const context = await contentFeedback.resolveContentFeedbackRoundContext("19", CHAIN_ID);

  assert.equal(context.openRoundId, "2");
  assert.equal(context.currentRoundId, "2");
  assert.equal(fallbackCalled, false);
});

test("preserves stale ponder context when no on-chain open round exists", async () => {
  contentFeedback.__setContentFeedbackVoteEligibilityTestOverridesForTests({
    getContentById: async () => ({ content: { openRound: null } }) as any,
    getAllRounds: async () => [buildRoundItem({ contentId: "20", roundId: "4", state: ROUND_STATE.Settled })],
    resolveOnchainOpenRoundId: async () => null,
  });

  const context = await contentFeedback.resolveContentFeedbackRoundContext("20", CHAIN_ID);

  assert.equal(context.openRoundId, null);
  assert.equal(context.currentRoundId, "4");
  assert.equal(context.settlementComplete, true);
});

test("accepts feedback eligibility from indexed staked votes", async () => {
  contentFeedback.__setContentFeedbackVoteEligibilityTestOverridesForTests({
    getVotes: async () => buildVotesResponse([buildVoteItem({ contentId: "15", roundId: "2", voter: WALLET })]),
    hasOnchainFeedbackEligibleVote: async () => false,
  });

  await assert.doesNotReject(() =>
    contentFeedback.assertContentFeedbackVoterEligibility({
      address: WALLET,
      chainId: CHAIN_ID,
      contentId: "15",
      roundId: "2",
    }),
  );
});

test("accepts feedback eligibility from on-chain advisory votes", async () => {
  let observedChainId: number | undefined;
  contentFeedback.__setContentFeedbackVoteEligibilityTestOverridesForTests({
    getVotes: async () => buildVotesResponse([]),
    hasOnchainFeedbackEligibleVote: async params => {
      observedChainId = params.chainId;
      return params.contentId === "16" && params.roundId === "3" && params.address === WALLET;
    },
  });

  await assert.doesNotReject(() =>
    contentFeedback.assertContentFeedbackVoterEligibility({
      address: WALLET,
      chainId: CHAIN_ID,
      contentId: "16",
      roundId: "3",
    }),
  );
  assert.equal(observedChainId, CHAIN_ID);
});

test("rejects feedback eligibility when neither indexed nor advisory votes exist", async () => {
  contentFeedback.__setContentFeedbackVoteEligibilityTestOverridesForTests({
    getVotes: async () => buildVotesResponse([]),
    hasOnchainFeedbackEligibleVote: async () => false,
  });

  await assert.rejects(
    () =>
      contentFeedback.assertContentFeedbackVoterEligibility({
        address: WALLET,
        chainId: CHAIN_ID,
        contentId: "17",
        roundId: "4",
      }),
    contentFeedback.ContentFeedbackVoterEligibilityError,
  );
});

test("public reads show active round feedback immediately", async () => {
  const activeContext = contentFeedback.buildContentFeedbackRoundContext([{ roundId: "7", state: ROUND_STATE.Open }]);
  const payload = contentFeedback.normalizeContentFeedbackInput({
    address: WALLET,
    contentId: "12",
    feedbackType: "concern",
    body: "The wording could be interpreted two different ways.",
  });
  assert.equal(payload.ok, true);
  if (!payload.ok) return;

  await contentFeedback.addContentFeedback(prepareFeedback(payload.payload, activeContext), activeContext);

  const publicResult = await contentFeedback.listContentFeedback({
    contentId: "12",
    context: activeContext,
  });
  assert.equal(publicResult.count, 1);
  assert.equal(publicResult.publicCount, 1);
  assert.equal(publicResult.items[0]?.isPublic, true);

  const ownerResult = await contentFeedback.listContentFeedback({
    contentId: "12",
    context: activeContext,
    viewerAddress: WALLET,
  });
  assert.equal(ownerResult.count, 1);
  assert.equal(ownerResult.ownHiddenCount, 0);
  assert.equal(ownerResult.items[0]?.chainId, CHAIN_ID);
  assert.equal(ownerResult.items[0]?.feedbackHash?.length, 66);

  const otherResult = await contentFeedback.listContentFeedback({
    contentId: "12",
    context: activeContext,
    viewerAddress: OTHER_WALLET,
  });
  assert.equal(otherResult.count, 1);
});

test("terminal round feedback becomes public", async () => {
  const activeContext = contentFeedback.buildContentFeedbackRoundContext([{ roundId: "8", state: ROUND_STATE.Open }]);
  const settledContext = contentFeedback.buildContentFeedbackRoundContext([
    { roundId: "8", state: ROUND_STATE.Settled },
  ]);
  const payload = contentFeedback.normalizeContentFeedbackInput({
    address: WALLET,
    contentId: "13",
    feedbackType: "evidence",
    body: "The cited report confirms the central claim.",
  });
  assert.equal(payload.ok, true);
  if (!payload.ok) return;

  await contentFeedback.addContentFeedback(prepareFeedback(payload.payload, activeContext), activeContext);

  const result = await contentFeedback.listContentFeedback({
    contentId: "13",
    context: settledContext,
  });
  assert.equal(result.count, 1);
  assert.equal(result.publicCount, 1);
  assert.equal(result.items[0]?.isPublic, true);
});

test("does not lease reveal candidates for immediately published feedback", async () => {
  const activeContext = contentFeedback.buildContentFeedbackRoundContext([{ roundId: "8", state: ROUND_STATE.Open }]);
  const payload = contentFeedback.normalizeContentFeedbackInput({
    address: WALLET,
    contentId: "31",
    feedbackType: "evidence",
    body: "The cited report confirms the central claim.",
  });
  assert.equal(payload.ok, true);
  if (!payload.ok) return;

  const added = await contentFeedback.addContentFeedback(
    prepareFeedback(payload.payload, activeContext),
    activeContext,
  );
  assert.equal(added.onchainRevealStatus, "revealed");

  contentFeedback.__setContentFeedbackVoteEligibilityTestOverridesForTests({
    getContentById: async () => ({ content: { openRound: { roundId: "8" } } }) as any,
    getAllRounds: async () => [buildRoundItem({ contentId: "31", roundId: "8", state: ROUND_STATE.Open })],
  });
  const activeCandidates = await contentFeedback.leaseContentFeedbackRevealCandidates({
    chainId: CHAIN_ID,
    limit: 5,
    now: new Date("2026-06-03T05:00:00.000Z"),
  });
  assert.equal(activeCandidates.length, 0);

  contentFeedback.__setContentFeedbackVoteEligibilityTestOverridesForTests({
    getContentById: async () => ({ content: { openRound: null } }) as any,
    getAllRounds: async () => [buildRoundItem({ contentId: "31", roundId: "8", state: ROUND_STATE.Settled })],
    resolveOnchainOpenRoundId: async () => null,
  });
  const settledCandidates = await contentFeedback.leaseContentFeedbackRevealCandidates({
    chainId: CHAIN_ID,
    limit: 5,
    now: new Date("2026-06-03T05:01:00.000Z"),
  });

  assert.equal(settledCandidates.length, 0);
});

test("does not lease cancelled round feedback for on-chain reveal", async () => {
  const activeContext = contentFeedback.buildContentFeedbackRoundContext([{ roundId: "8", state: ROUND_STATE.Open }]);
  const payload = contentFeedback.normalizeContentFeedbackInput({
    address: WALLET,
    contentId: "32",
    feedbackType: "concern",
    body: "This cancelled round note can be displayed locally but cannot be revealed on-chain.",
  });
  assert.equal(payload.ok, true);
  if (!payload.ok) return;

  await contentFeedback.addContentFeedback(prepareFeedback(payload.payload, activeContext), activeContext);
  contentFeedback.__setContentFeedbackVoteEligibilityTestOverridesForTests({
    getContentById: async () => ({ content: { openRound: null } }) as any,
    getAllRounds: async () => [buildRoundItem({ contentId: "32", roundId: "8", state: ROUND_STATE.Cancelled })],
    resolveOnchainOpenRoundId: async () => null,
  });

  const candidates = await contentFeedback.leaseContentFeedbackRevealCandidates({
    chainId: CHAIN_ID,
    limit: 5,
    now: new Date("2026-06-03T05:02:00.000Z"),
  });

  assert.equal(candidates.length, 0);
});

test("legacy malformed reveal metadata is not leased after direct publishing", async () => {
  const activeContext = contentFeedback.buildContentFeedbackRoundContext([{ roundId: "8", state: ROUND_STATE.Open }]);
  const settledContext = contentFeedback.buildContentFeedbackRoundContext([
    { roundId: "8", state: ROUND_STATE.Settled },
  ]);
  const payload = contentFeedback.normalizeContentFeedbackInput({
    address: WALLET,
    contentId: "34",
    feedbackType: "vote_rationale",
    body: "This legacy feedback row has no on-chain reveal payload yet.",
  });
  assert.equal(payload.ok, true);
  if (!payload.ok) return;

  const added = await contentFeedback.addContentFeedback(
    prepareFeedback(payload.payload, activeContext),
    activeContext,
  );
  await dbModule.dbClient.execute(`
    UPDATE content_feedback
    SET feedback_hash = NULL,
        commit_key = NULL,
        client_nonce = NULL,
        updated_at = '2026-06-03T05:02:30.000Z'
    WHERE id = ${added.id}
  `);

  contentFeedback.__setContentFeedbackVoteEligibilityTestOverridesForTests({
    getContentById: async () => ({ content: { openRound: { roundId: "8" } } }) as any,
    getAllRounds: async () => [buildRoundItem({ contentId: "34", roundId: "8", state: ROUND_STATE.Open })],
  });
  const activeCandidates = await contentFeedback.leaseContentFeedbackRevealCandidates({
    chainId: CHAIN_ID,
    limit: 5,
    now: new Date("2026-06-03T05:03:00.000Z"),
  });
  assert.equal(activeCandidates.length, 0);

  const activeResult = await contentFeedback.listContentFeedback({
    contentId: "34",
    context: activeContext,
    viewerAddress: WALLET,
  });
  assert.equal(activeResult.items[0]?.onchainRevealStatus, "revealed");
  assert.equal(activeResult.items[0]?.onchainRevealError, null);

  contentFeedback.__setContentFeedbackVoteEligibilityTestOverridesForTests({
    getContentById: async () => ({ content: { openRound: null } }) as any,
    getAllRounds: async () => [buildRoundItem({ contentId: "34", roundId: "8", state: ROUND_STATE.Settled })],
    resolveOnchainOpenRoundId: async () => null,
  });
  const settledCandidates = await contentFeedback.leaseContentFeedbackRevealCandidates({
    chainId: CHAIN_ID,
    limit: 5,
    now: new Date("2026-06-03T05:04:00.000Z"),
  });
  assert.equal(settledCandidates.length, 0);

  const settledResult = await contentFeedback.listContentFeedback({
    contentId: "34",
    context: settledContext,
    viewerAddress: WALLET,
  });
  assert.equal(settledResult.items[0]?.onchainRevealStatus, "revealed");
  assert.equal(settledResult.items[0]?.onchainRevealError, null);
});

test("records legacy reveal success state", async () => {
  const activeContext = contentFeedback.buildContentFeedbackRoundContext([{ roundId: "8", state: ROUND_STATE.Open }]);
  const payload = contentFeedback.normalizeContentFeedbackInput({
    address: WALLET,
    contentId: "33",
    feedbackType: "clarification",
    body: "This note has already been published on-chain.",
  });
  assert.equal(payload.ok, true);
  if (!payload.ok) return;

  const added = await contentFeedback.addContentFeedback(
    prepareFeedback(payload.payload, activeContext),
    activeContext,
  );

  await contentFeedback.recordContentFeedbackRevealSuccess({
    id: added.id as number,
    txHash: `0x${"44".repeat(32)}`,
    now: new Date("2026-06-03T05:05:00.000Z"),
  });
  const successResult = await contentFeedback.listContentFeedback({
    contentId: "33",
    context: contentFeedback.buildContentFeedbackRoundContext([{ roundId: "8", state: ROUND_STATE.Settled }]),
    viewerAddress: WALLET,
  });

  assert.equal(successResult.items[0]?.onchainRevealStatus, "revealed");
  assert.equal(successResult.items[0]?.onchainRevealTxHash, `0x${"44".repeat(32)}`);
  assert.equal(successResult.items[0]?.onchainRevealError, null);
});

test("returns awardable feedback bonus pools and awards for public feedback", async () => {
  const activeContext = contentFeedback.buildContentFeedbackRoundContext([{ roundId: "8", state: ROUND_STATE.Open }]);
  const settledContext = contentFeedback.buildContentFeedbackRoundContext([
    { roundId: "8", state: ROUND_STATE.Settled },
  ]);
  const payload = contentFeedback.normalizeContentFeedbackInput({
    address: WALLET,
    contentId: "13",
    feedbackType: "evidence",
    body: "The cited report confirms the central claim.",
  });
  assert.equal(payload.ok, true);
  if (!payload.ok) return;

  const added = await contentFeedback.addContentFeedback(
    prepareFeedback(payload.payload, activeContext),
    activeContext,
  );
  assert.ok(added.feedbackHash);

  contentFeedback.__setContentFeedbackVoteEligibilityTestOverridesForTests({
    getFeedbackBonusAwards: async params => ({
      items: [buildFeedbackBonusAward({ feedbackHash: params.feedbackHashes?.split(",")[0] })],
      limit: 1,
      offset: 0,
      hasMore: false,
    }),
    getFeedbackBonusPools: async params => ({
      items: [buildFeedbackBonusPool({ awarder: params.awarder })],
      limit: 1,
      offset: 0,
      hasMore: false,
    }),
  });

  const activeResult = await contentFeedback.listContentFeedback({
    contentId: "13",
    context: activeContext,
    awarderAddress: WALLET,
  });
  assert.equal(activeResult.items[0]?.isPublic, true);
  assert.equal(activeResult.awardableFeedbackBonusPools?.length, 0);

  const result = await contentFeedback.listContentFeedback({
    contentId: "13",
    context: settledContext,
    awarderAddress: WALLET,
  });

  assert.equal(result.awardableFeedbackBonusPools?.length, 1);
  assert.equal(result.awardableFeedbackBonusPools?.[0]?.id, "7");
  assert.equal(result.awardableFeedbackBonusPools?.[0]?.awarder, WALLET);
  assert.equal(result.awardableFeedbackBonusPools?.[0]?.currency, "LREP");
  assert.equal(result.items[0]?.feedbackBonusAwards?.length, 1);
  assert.equal(result.items[0]?.feedbackBonusAwards?.[0]?.poolId, "7");
  assert.equal(result.items[0]?.feedbackBonusAwards?.[0]?.feedbackHash, added.feedbackHash);
  assert.equal(result.items[0]?.feedbackBonusAwards?.[0]?.currency, "LREP");
});

test("public feedback includes newer active-round rows", async () => {
  const initialContext = contentFeedback.buildContentFeedbackRoundContext([{ roundId: "8", state: ROUND_STATE.Open }]);
  const currentContext = contentFeedback.buildContentFeedbackRoundContext([
    { roundId: "8", state: ROUND_STATE.Settled },
    { roundId: "9", state: ROUND_STATE.Open },
  ]);
  const publicPayload = contentFeedback.normalizeContentFeedbackInput({
    address: WALLET,
    contentId: "21",
    feedbackType: "evidence",
    body: "The settled answer includes clear supporting evidence.",
  });
  assert.equal(publicPayload.ok, true);
  if (!publicPayload.ok) return;

  await contentFeedback.addContentFeedback(prepareFeedback(publicPayload.payload, initialContext), initialContext);

  for (let index = 0; index < 100; index++) {
    const wallet = `0x${(index + 1).toString(16).padStart(40, "0")}` as const;
    const activePayload = contentFeedback.normalizeContentFeedbackInput({
      address: wallet,
      contentId: "21",
      feedbackType: "concern",
      body: `Active round public feedback number ${index}.`,
    });
    assert.equal(activePayload.ok, true);
    if (!activePayload.ok) return;

    await contentFeedback.addContentFeedback(prepareFeedback(activePayload.payload, currentContext), currentContext);
  }

  const result = await contentFeedback.listContentFeedback({
    contentId: "21",
    context: currentContext,
  });

  assert.equal(result.count, 100);
  assert.equal(result.publicCount, 101);
  assert.equal(result.items[0]?.body, "Active round public feedback number 99.");
});

test("rejects duplicate feedback from the same author in the same round", async () => {
  const activeContext = contentFeedback.buildContentFeedbackRoundContext([{ roundId: "9", state: ROUND_STATE.Open }]);
  const payload = contentFeedback.normalizeContentFeedbackInput({
    address: WALLET,
    contentId: "14",
    feedbackType: "clarification",
    body: "The question should specify which source of truth wins.",
  });
  assert.equal(payload.ok, true);
  if (!payload.ok) return;

  await contentFeedback.addContentFeedback(prepareFeedback(payload.payload, activeContext), activeContext);
  await assert.rejects(
    () => contentFeedback.addContentFeedback(prepareFeedback(payload.payload, activeContext), activeContext),
    contentFeedback.ContentFeedbackDuplicateError,
  );
});
