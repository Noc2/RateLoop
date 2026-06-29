import { Hono } from "hono";
import {
  CORRELATION_VOTE_PAGE_SIZE,
  correlationVoteScanPageBudget,
} from "@rateloop/node-utils/correlationScoring";
import { afterEach, describe, expect, it, vi } from "vitest";

function createVoteRow(index: number) {
  return {
    account: "0x0000000000000000000000000000000000000001",
    voter: "0x0000000000000000000000000000000000000001",
    identityKey: `0x${"a".repeat(64)}`,
    commitKey: `0x${index.toString(16).padStart(64, "0")}`,
    isUp: true,
    stake: 25000000n,
    epochIndex: 0,
    revealWeight: 25000000n,
    baseWeight: 10000n,
    verifiedHuman: true,
    historicalVoteCount: 0,
    features: "",
  };
}

function createQueryBuilder<T>(result: T) {
  const builder = {
    from: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    where: vi.fn(() => builder),
    groupBy: vi.fn(() => builder),
    having: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    offset: vi.fn(() => builder),
    then: (
      resolve: (value: T) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };

  return builder;
}

function mockCorrelationVoteScan(results: unknown[]) {
  const queryBuilders = results.map((result) => createQueryBuilder(result));
  let selectCallCount = 0;
  const db = {
    select: vi.fn(() => {
      const queryBuilder =
        queryBuilders[Math.min(selectCallCount, queryBuilders.length - 1)]!;
      selectCallCount += 1;
      return queryBuilder;
    }),
  };

  vi.doMock("ponder:api", () => ({ db }));
  vi.doMock("ponder", () => ({
    and: (...args: unknown[]) => ({ kind: "and", args }),
    asc: (expr: unknown) => ({ kind: "asc", expr }),
    desc: (expr: unknown) => ({ kind: "desc", expr }),
    eq: (...args: unknown[]) => ({ kind: "eq", args }),
    gte: (...args: unknown[]) => ({ kind: "gte", args }),
    inArray: (...args: unknown[]) => ({ kind: "inArray", args }),
    lt: (...args: unknown[]) => ({ kind: "lt", args }),
    notInArray: (...args: unknown[]) => ({ kind: "notInArray", args }),
    or: (...args: unknown[]) => ({ kind: "or", args }),
    replaceBigInts: (data: unknown, replacer: (value: bigint) => unknown) =>
      JSON.parse(
        JSON.stringify(data, (_key, value) =>
          typeof value === "bigint" ? replacer(value) : value,
        ),
      ),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      kind: "sql",
      strings: [...strings],
      values,
    }),
  }));
  vi.doMock("ponder:schema", () => ({
    content: { id: "content.id", submitter: "content.submitter" },
    questionRewardPool: {
      bountyClosesAt: "questionRewardPool.bountyClosesAt",
      bountyEligibility: "questionRewardPool.bountyEligibility",
      bountyOpensAt: "questionRewardPool.bountyOpensAt",
      bountyStartBy: "questionRewardPool.bountyStartBy",
      bountyWindowSeconds: "questionRewardPool.bountyWindowSeconds",
      contentId: "questionRewardPool.contentId",
      funder: "questionRewardPool.funder",
      funderIdentityKey: "questionRewardPool.funderIdentityKey",
      id: "questionRewardPool.id",
      payerIdentity: "questionRewardPool.payerIdentity",
      payerIdentityKey: "questionRewardPool.payerIdentityKey",
      submitterIdentity: "questionRewardPool.submitterIdentity",
      submitterIdentityKey: "questionRewardPool.submitterIdentityKey",
    },
    raterHumanCredential: {
      expiresAt: "raterHumanCredential.expiresAt",
      nullifierHash: "raterHumanCredential.nullifierHash",
      provider: "raterHumanCredential.provider",
      rater: "raterHumanCredential.rater",
      revoked: "raterHumanCredential.revoked",
      updatedAt: "raterHumanCredential.updatedAt",
      verified: "raterHumanCredential.verified",
      verifiedAt: "raterHumanCredential.verifiedAt",
    },
    raterIdentityBan: {
      active: "raterIdentityBan.active",
      expiresAt: "raterIdentityBan.expiresAt",
      nullifierHash: "raterIdentityBan.nullifierHash",
      permanent: "raterIdentityBan.permanent",
      provider: "raterIdentityBan.provider",
      updatedAt: "raterIdentityBan.updatedAt",
    },
    round: {
      contentId: "round.contentId",
      downPool: "round.downPool",
      roundId: "round.roundId",
      settledAt: "round.settledAt",
      startTime: "round.startTime",
      state: "round.state",
      upPool: "round.upPool",
    },
    vote: {
      commitBlockNumber: "vote.commitBlockNumber",
      commitKey: "vote.commitKey",
      commitLogIndex: "vote.commitLogIndex",
      committedAt: "vote.committedAt",
      credentialMask: "vote.credentialMask",
      freshCredentialMask: "vote.freshCredentialMask",
      id: "vote.id",
      identityHolder: "vote.identityHolder",
      identityKey: "vote.identityKey",
      isUp: "vote.isUp",
      rbtsWeight: "vote.rbtsWeight",
      revealed: "vote.revealed",
      revealedAt: "vote.revealedAt",
      roundId: "vote.roundId",
      contentId: "vote.contentId",
      epochIndex: "vote.epochIndex",
      stake: "vote.stake",
      voter: "vote.voter",
    },
    voterStats: {
      totalSettledVotes: "voterStats.totalSettledVotes",
      voter: "voterStats.voter",
    },
  }));

  return { db };
}

function buildScanResults(probeRowCount: number) {
  const fullPage = Array.from({ length: CORRELATION_VOTE_PAGE_SIZE }, (_, index) =>
    createVoteRow(index),
  );
  const scanPages = correlationVoteScanPageBudget(0);
  return [
    fullPage,
    [],
    ...Array.from({ length: scanPages - 1 }, () => fullPage),
    probeRowCount > 0 ? [createVoteRow(9999)] : [],
    [
      {
        questionMetadataHash: `0x${"2".repeat(64)}`,
        questionMetadataUri: `https://rateloop.ai/question-metadata/0x${"2".repeat(64)}`,
        resultSpecHash: `0x${"3".repeat(64)}`,
        settledAt: 777n,
      },
    ],
    [],
  ];
}

describe("correlation vote scan routes", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("ponder:api");
    vi.doUnmock("ponder");
    vi.doUnmock("ponder:schema");
  });

  it("sets truncated when the post-budget probe finds more eligible votes", async () => {
    mockCorrelationVoteScan(buildScanResults(1));
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const response = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=7&contentId=9&roundId=2&limit=10&offset=0&now=1000",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.truncated).toBe(true);
    expect(body.items).toHaveLength(10);
  });

  it("clears truncated when the post-budget probe reaches the dataset end", async () => {
    mockCorrelationVoteScan(buildScanResults(0));
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const response = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=7&contentId=9&roundId=2&limit=10&offset=0&now=1000",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.truncated).toBe(false);
  });
});
