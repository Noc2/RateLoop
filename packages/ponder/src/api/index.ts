import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  lt,
  or,
  replaceBigInts,
  sql,
  sum,
} from "ponder";
import { db } from "ponder:api";
import {
  tokenlessClaim,
  tokenlessCommit,
  tokenlessCreditBalance,
  tokenlessCreditEvent,
  tokenlessIssuerEpoch,
  tokenlessFeedbackBonusEvent,
  tokenlessFeedbackBonusPool,
  tokenlessFeedbackRecord,
  tokenlessRound,
} from "ponder:schema";
import { isAddress } from "viem";
import {
  resolveTokenlessDeployment,
  roundKey,
  tokenlessDeploymentHealth,
} from "../protocol-deployment";
import { createOriginTtlCache } from "../origin-cache";
import {
  evaluateTokenlessIndexerHealth,
  tokenlessIndexerFreshnessThresholds,
} from "../indexer-health";
import { validateRuntimeTokenlessDeployment } from "../runtime-deployment-health";
import {
  keeperAction,
  publicRoundStatus,
  ROUND_STATE,
  verdictStatus,
} from "../status";
import { tokenlessStatusSummary } from "../status-summary";

const deployment = resolveTokenlessDeployment();
const app = new Hono();
const MAX_LIMIT = 500;
const STATUS_CACHE_TTL_MS = 15_000;
const INDEXER_FRESHNESS_THRESHOLDS = tokenlessIndexerFreshnessThresholds();
const statsCache = createOriginTtlCache<{ totalClaimedAtomic: string }>({
  ttlMs: 60_000,
});
let statusCache:
  | { expiresAt: number; value: Record<string, unknown> }
  | undefined;
type PonderIndexingStatus = Record<
  string,
  {
    block: { number: number; timestamp: number } | null;
    ready: boolean;
  }
>;

function ponderIndexingStatus() {
  const runtime = globalThis as typeof globalThis & {
    PONDER_DATABASE: {
      getStatus(): Promise<PonderIndexingStatus | null>;
    };
  };
  return runtime.PONDER_DATABASE.getStatus();
}

function jsonSafe<T>(value: T) {
  return replaceBigInts(value, (item) => item.toString());
}

function limit(value: string | undefined, fallback = 50) {
  if (!value || !/^[1-9]\d*$/u.test(value)) return fallback;
  return Math.min(Number(value), MAX_LIMIT);
}

function parseRoundId(value: string) {
  return /^(?:0|[1-9]\d*)$/u.test(value) ? BigInt(value) : null;
}

function parseTimestamp(value: string | undefined) {
  if (!value || !/^(?:0|[1-9]\d*)$/u.test(value)) return null;
  return BigInt(value);
}

function parseAddress(value: string) {
  return isAddress(value) ? (value.toLowerCase() as `0x${string}`) : null;
}

function keeperWorkPredicate(now: bigint) {
  const openOrRevealable = inArray(tokenlessRound.state, [
    ROUND_STATE.OPEN,
    ROUND_STATE.REVEALABLE,
  ]);
  const terminal = inArray(tokenlessRound.state, [
    ROUND_STATE.FINALIZED,
    ROUND_STATE.UNDER_QUORUM_COMPENSATION,
    ROUND_STATE.BEACON_FAILURE_COMPENSATION,
  ]);
  return or(
    and(
      openOrRevealable,
      lt(tokenlessRound.revealDeadline, now),
      or(
        eq(tokenlessRound.commitCount, 0),
        sql<boolean>`${tokenlessRound.revealCount} >= ${tokenlessRound.minimumReveals}`,
        lt(tokenlessRound.beaconFailureDeadline, now),
      ),
    ),
    inArray(tokenlessRound.state, [
      ROUND_STATE.AGGREGATING,
      ROUND_STATE.AWAITING_SEED,
      ROUND_STATE.SCORING,
    ]),
    and(
      terminal,
      eq(tokenlessRound.staleReturned, false),
      gt(tokenlessRound.claimDeadline, 0n),
      lt(tokenlessRound.claimDeadline, now),
    ),
  );
}

function keeperAuthorization(header: string | undefined) {
  const token = process.env.PONDER_KEEPER_WORK_TOKEN?.trim();
  if (!token) return process.env.NODE_ENV === "production" ? "missing" : null;
  return header === `Bearer ${token}` ? null : "invalid";
}

const origins = process.env.CORS_ORIGIN?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (
  process.env.NODE_ENV === "production" &&
  (!origins || origins.length === 0)
) {
  throw new Error("CORS_ORIGIN is required in production.");
}
app.use("/*", cors({ origin: origins ?? ["http://localhost:3000"] }));

app.onError((error, c) => {
  console.error("[tokenless-ponder]", error);
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/deployment", (c) => c.json(deployment));

app.get("/health/tokenless", async (c) => {
  c.header("cache-control", "no-store");
  const [chain, initialIssuerEpoch, indexingStatus] = await Promise.all([
    validateRuntimeTokenlessDeployment(),
    db.query.tokenlessIssuerEpoch.findFirst({
      where: and(
        eq(tokenlessIssuerEpoch.deploymentKey, deployment.deploymentKey),
        eq(tokenlessIssuerEpoch.epoch, 1n),
      ),
    }),
    ponderIndexingStatus(),
  ]);
  const index = indexingStatus?.[deployment.network];
  const indexBlock = index?.block?.number ?? null;
  const indexTimestamp = index?.block?.timestamp ?? null;
  const indexReady = index?.ready === true;
  const deploymentEventIndexed = Boolean(initialIssuerEpoch);
  const freshness = evaluateTokenlessIndexerHealth({
    chainHead: chain.chainHead,
    startBlock: deployment.startBlock,
    indexBlock,
    indexTimestamp,
    indexReady,
    initialEpochIndexed: deploymentEventIndexed,
    enforceWallClockFreshness: deployment.network !== "hardhat",
    thresholds: INDEXER_FRESHNESS_THRESHOLDS,
  });
  if (freshness.status !== "ok") {
    return c.json(
      {
        ...tokenlessDeploymentHealth(deployment),
        status: freshness.status,
        error:
          freshness.status === "syncing"
            ? "Historical indexing has not reached readiness."
            : "Indexer freshness exceeded its operational bound.",
        healthReasons: freshness.reasons,
        chainHead: chain.chainHead.toString(),
        indexBlock,
        indexTimestamp,
        indexReady,
        indexBlockLag: freshness.blockLag,
        indexAgeSeconds: freshness.indexAgeSeconds,
        freshnessThresholds: freshness.thresholds,
        blocksIndexedFromStart:
          indexBlock === null
            ? null
            : Math.max(0, indexBlock - deployment.startBlock),
        initialEpochIndexed: deploymentEventIndexed,
      },
      503,
    );
  }
  return c.json({
    ...tokenlessDeploymentHealth(deployment),
    chainHead: chain.chainHead.toString(),
    indexBlock,
    indexTimestamp,
    indexReady,
    indexBlockLag: freshness.blockLag,
    indexAgeSeconds: freshness.indexAgeSeconds,
    freshnessThresholds: freshness.thresholds,
    blocksIndexedFromStart: indexBlock! - deployment.startBlock,
    usdcAddress: chain.usdcAddress,
    adapterConfigured: chain.adapterConfigured,
    initialEpochIndexed: true,
  });
});

app.get("/status/tokenless", async (c) => {
  if (statusCache && statusCache.expiresAt > Date.now()) {
    c.header("cache-control", "public, max-age=5, s-maxage=15");
    return c.json(statusCache.value);
  }
  const [
    roundStates,
    [creditSummary],
    [creditEventSummary],
    [feedbackBonusPoolSummary],
    [feedbackBonusEventSummary],
  ] = await Promise.all([
    db
      .select({ state: tokenlessRound.state, total: count() })
      .from(tokenlessRound)
      .where(eq(tokenlessRound.deploymentKey, deployment.deploymentKey))
      .groupBy(tokenlessRound.state),
    db
      .select({
        owners: count(),
        totalRemainingCredit: sum(tokenlessCreditBalance.remainingCredit),
      })
      .from(tokenlessCreditBalance)
      .where(
        eq(tokenlessCreditBalance.deploymentKey, deployment.deploymentKey),
      ),
    db
      .select({ total: count() })
      .from(tokenlessCreditEvent)
      .where(eq(tokenlessCreditEvent.deploymentKey, deployment.deploymentKey)),
    db
      .select({ total: count() })
      .from(tokenlessFeedbackBonusPool)
      .where(
        eq(tokenlessFeedbackBonusPool.deploymentKey, deployment.deploymentKey),
      ),
    db
      .select({ total: count() })
      .from(tokenlessFeedbackBonusEvent)
      .where(
        eq(tokenlessFeedbackBonusEvent.deploymentKey, deployment.deploymentKey),
      ),
  ]);
  const value = {
    ...tokenlessDeploymentHealth(deployment),
    ...tokenlessStatusSummary({
      roundStates,
      creditOwners: creditSummary?.owners,
      creditEvents: creditEventSummary?.total,
      feedbackBonusPools: feedbackBonusPoolSummary?.total,
      feedbackBonusEvents: feedbackBonusEventSummary?.total,
      totalRemainingCredit: creditSummary?.totalRemainingCredit,
    }),
  };
  statusCache = { expiresAt: Date.now() + STATUS_CACHE_TTL_MS, value };
  c.header("cache-control", "public, max-age=5, s-maxage=15");
  return c.json(value);
});

app.get("/stats", async (c) => {
  const value = await statsCache.get(async () => {
    const [totals] = await db
      .select({ totalClaimedAtomic: sum(tokenlessClaim.amount) })
      .from(tokenlessClaim)
      .where(eq(tokenlessClaim.deploymentKey, deployment.deploymentKey));
    return {
      totalClaimedAtomic: String(totals?.totalClaimedAtomic ?? 0),
    };
  });
  c.header("cache-control", "public, max-age=60, s-maxage=300");
  return c.json(value);
});

app.get("/rounds", async (c) => {
  const now =
    parseTimestamp(c.req.query("now")) ??
    BigInt(Math.floor(Date.now() / 1_000));
  const rows = await db
    .select()
    .from(tokenlessRound)
    .where(eq(tokenlessRound.deploymentKey, deployment.deploymentKey))
    .orderBy(desc(tokenlessRound.roundId))
    .limit(limit(c.req.query("limit")));
  return c.json(
    jsonSafe(
      rows.map((row) => ({
        ...row,
        status: publicRoundStatus(row, now),
        verdictStatus: verdictStatus(row.state),
      })),
    ),
  );
});

app.get("/rounds/:roundId", async (c) => {
  const roundId = parseRoundId(c.req.param("roundId"));
  if (roundId === null)
    return c.json({ error: "roundId must be an unsigned integer" }, 400);
  const row = await db.query.tokenlessRound.findFirst({
    where: and(
      eq(tokenlessRound.id, roundKey(deployment.deploymentKey, roundId)),
      eq(tokenlessRound.deploymentKey, deployment.deploymentKey),
    ),
  });
  if (!row) return c.json({ error: "Round not found" }, 404);
  const now =
    parseTimestamp(c.req.query("now")) ??
    BigInt(Math.floor(Date.now() / 1_000));
  return c.json(
    jsonSafe({
      ...row,
      status: publicRoundStatus(row, now),
      verdictStatus: verdictStatus(row.state),
    }),
  );
});

app.get("/rounds/:roundId/commits", async (c) => {
  const roundId = parseRoundId(c.req.param("roundId"));
  if (roundId === null)
    return c.json({ error: "roundId must be an unsigned integer" }, 400);
  const rows = await db
    .select()
    .from(tokenlessCommit)
    .where(
      and(
        eq(tokenlessCommit.deploymentKey, deployment.deploymentKey),
        eq(tokenlessCommit.roundId, roundId),
      ),
    )
    .orderBy(asc(tokenlessCommit.commitLogIndex))
    .limit(limit(c.req.query("limit"), 100));
  return c.json(jsonSafe(rows));
});

app.get("/rounds/:roundId/claims", async (c) => {
  const roundId = parseRoundId(c.req.param("roundId"));
  if (roundId === null)
    return c.json({ error: "roundId must be an unsigned integer" }, 400);
  const rows = await db
    .select()
    .from(tokenlessClaim)
    .where(
      and(
        eq(tokenlessClaim.deploymentKey, deployment.deploymentKey),
        eq(tokenlessClaim.roundId, roundId),
      ),
    )
    .orderBy(asc(tokenlessClaim.logIndex));
  return c.json(jsonSafe(rows));
});

app.get("/rounds/:roundId/credits", async (c) => {
  const roundId = parseRoundId(c.req.param("roundId"));
  if (roundId === null)
    return c.json({ error: "roundId must be an unsigned integer" }, 400);
  const rows = await db
    .select()
    .from(tokenlessCreditEvent)
    .where(
      and(
        eq(tokenlessCreditEvent.deploymentKey, deployment.deploymentKey),
        eq(tokenlessCreditEvent.roundId, roundId),
      ),
    )
    .orderBy(
      asc(tokenlessCreditEvent.blockNumber),
      asc(tokenlessCreditEvent.logIndex),
    );
  return c.json(jsonSafe(rows));
});

app.get("/credits/:owner", async (c) => {
  const owner = parseAddress(c.req.param("owner"));
  if (!owner) return c.json({ error: "owner must be an EVM address" }, 400);
  const [balance, events] = await Promise.all([
    db.query.tokenlessCreditBalance.findFirst({
      where: and(
        eq(tokenlessCreditBalance.deploymentKey, deployment.deploymentKey),
        eq(tokenlessCreditBalance.owner, owner),
      ),
    }),
    db
      .select()
      .from(tokenlessCreditEvent)
      .where(
        and(
          eq(tokenlessCreditEvent.deploymentKey, deployment.deploymentKey),
          eq(tokenlessCreditEvent.owner, owner),
        ),
      )
      .orderBy(
        desc(tokenlessCreditEvent.blockNumber),
        desc(tokenlessCreditEvent.logIndex),
      )
      .limit(limit(c.req.query("limit"), 100)),
  ]);
  return c.json(
    jsonSafe({
      deploymentKey: deployment.deploymentKey,
      owner,
      remainingCredit: balance?.remainingCredit ?? 0n,
      totalAccrued: balance?.totalAccrued ?? 0n,
      totalWithdrawn: balance?.totalWithdrawn ?? 0n,
      events,
    }),
  );
});

app.get("/issuer/epochs", async (c) => {
  const rows = await db
    .select()
    .from(tokenlessIssuerEpoch)
    .where(eq(tokenlessIssuerEpoch.deploymentKey, deployment.deploymentKey))
    .orderBy(desc(tokenlessIssuerEpoch.epoch))
    .limit(limit(c.req.query("limit"), 20));
  return c.json(jsonSafe(rows));
});

app.get("/feedback-bonuses", async (c) => {
  const rows = await db
    .select()
    .from(tokenlessFeedbackBonusPool)
    .where(
      eq(tokenlessFeedbackBonusPool.deploymentKey, deployment.deploymentKey),
    )
    .orderBy(desc(tokenlessFeedbackBonusPool.poolId))
    .limit(limit(c.req.query("limit")));
  return c.json(jsonSafe(rows));
});

app.get("/feedback-bonuses/:poolId", async (c) => {
  const poolId = parseRoundId(c.req.param("poolId"));
  if (poolId === null)
    return c.json({ error: "poolId must be an unsigned integer" }, 400);
  const row = await db.query.tokenlessFeedbackBonusPool.findFirst({
    where: and(
      eq(
        tokenlessFeedbackBonusPool.id,
        `${deployment.deploymentKey}:feedback-bonus:${poolId}`,
      ),
      eq(tokenlessFeedbackBonusPool.deploymentKey, deployment.deploymentKey),
    ),
  });
  if (!row) return c.json({ error: "Feedback bonus pool not found" }, 404);
  return c.json(jsonSafe(row));
});

app.get("/feedback-bonuses/:poolId/feedback", async (c) => {
  const poolId = parseRoundId(c.req.param("poolId"));
  if (poolId === null)
    return c.json({ error: "poolId must be an unsigned integer" }, 400);
  const rows = await db
    .select()
    .from(tokenlessFeedbackRecord)
    .where(
      and(
        eq(tokenlessFeedbackRecord.deploymentKey, deployment.deploymentKey),
        eq(tokenlessFeedbackRecord.poolId, poolId),
      ),
    )
    .orderBy(
      asc(tokenlessFeedbackRecord.registeredBlock),
      asc(tokenlessFeedbackRecord.registeredLogIndex),
    )
    .limit(limit(c.req.query("limit"), 100));
  return c.json(jsonSafe(rows));
});

app.get("/feedback-bonuses/:poolId/events", async (c) => {
  const poolId = parseRoundId(c.req.param("poolId"));
  if (poolId === null)
    return c.json({ error: "poolId must be an unsigned integer" }, 400);
  const rows = await db
    .select()
    .from(tokenlessFeedbackBonusEvent)
    .where(
      and(
        eq(tokenlessFeedbackBonusEvent.deploymentKey, deployment.deploymentKey),
        eq(tokenlessFeedbackBonusEvent.poolId, poolId),
      ),
    )
    .orderBy(
      asc(tokenlessFeedbackBonusEvent.blockNumber),
      asc(tokenlessFeedbackBonusEvent.logIndex),
    )
    .limit(limit(c.req.query("limit"), 100));
  return c.json(jsonSafe(rows));
});

app.get("/keeper/work", async (c) => {
  const authorization = keeperAuthorization(c.req.header("authorization"));
  if (authorization === "missing")
    return c.json({ error: "PONDER_KEEPER_WORK_TOKEN is required" }, 503);
  if (authorization === "invalid")
    return c.json({ error: "Invalid keeper token" }, 401);
  const now = parseTimestamp(c.req.query("now"));
  if (now === null)
    return c.json({ error: "now must be an unsigned integer timestamp" }, 400);
  const direction = c.req.query("direction") === "asc" ? "asc" : "desc";
  const rawCursor = c.req.query("cursor");
  const cursor = rawCursor === undefined ? null : parseRoundId(rawCursor);
  if (rawCursor !== undefined && cursor === null) {
    return c.json({ error: "cursor must be an unsigned round ID" }, 400);
  }
  const pageLimit = limit(c.req.query("limit"), 100);
  const cursorPredicate =
    cursor === null
      ? undefined
      : direction === "asc"
        ? gt(tokenlessRound.roundId, cursor)
        : lt(tokenlessRound.roundId, cursor);

  const rows = await db
    .select()
    .from(tokenlessRound)
    .where(
      and(
        eq(tokenlessRound.deploymentKey, deployment.deploymentKey),
        keeperWorkPredicate(now),
        cursorPredicate,
      ),
    )
    .orderBy(
      direction === "asc"
        ? asc(tokenlessRound.roundId)
        : desc(tokenlessRound.roundId),
    )
    .limit(pageLimit + 1);
  const page = rows.slice(0, pageLimit);
  const work = page.flatMap((row) => {
    const action = keeperAction(row, now);
    if (!action) return [];
    return [
      {
        action,
        roundId: row.roundId.toString(),
        cursor:
          action === "process_aggregate"
            ? row.aggregateCursor
            : action === "process_scores"
              ? row.scoreCursor
              : null,
      },
    ];
  });
  return c.json({
    deploymentKey: deployment.deploymentKey,
    chainId: deployment.chainId,
    panelAddress: deployment.panelAddress,
    now: now.toString(),
    direction,
    nextCursor:
      rows.length > pageLimit && page.length > 0
        ? page[page.length - 1]?.roundId.toString()
        : null,
    work,
  });
});

export default app;
