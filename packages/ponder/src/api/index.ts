import { Hono } from "hono";
import { cors } from "hono/cors";
import { and, asc, desc, eq, replaceBigInts } from "ponder";
import { db } from "ponder:api";
import {
  tokenlessClaim,
  tokenlessCommit,
  tokenlessCreditBalance,
  tokenlessCreditEvent,
  tokenlessIssuerEpoch,
  tokenlessRound,
} from "ponder:schema";
import { isAddress } from "viem";
import { resolveTokenlessDeployment, roundKey } from "../protocol-deployment";
import { keeperAction, publicRoundStatus, verdictStatus } from "../status";

const deployment = resolveTokenlessDeployment();
const app = new Hono();
const MAX_LIMIT = 500;

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
  return isAddress(value) ? value.toLowerCase() as `0x${string}` : null;
}

function keeperAuthorization(header: string | undefined) {
  const token = process.env.PONDER_KEEPER_WORK_TOKEN?.trim();
  if (!token) return process.env.NODE_ENV === "production" ? "missing" : null;
  return header === `Bearer ${token}` ? null : "invalid";
}

const origins = process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()).filter(Boolean);
if (process.env.NODE_ENV === "production" && (!origins || origins.length === 0)) {
  throw new Error("CORS_ORIGIN is required in production.");
}
app.use("/*", cors({ origin: origins ?? ["http://localhost:3000"] }));

app.onError((error, c) => {
  console.error("[tokenless-ponder]", error);
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/deployment", (c) => c.json(deployment));

app.get("/status/tokenless", async (c) => {
  const [rows, creditBalances, creditEvents] = await Promise.all([
    db
      .select({ state: tokenlessRound.state })
      .from(tokenlessRound)
      .where(eq(tokenlessRound.deploymentKey, deployment.deploymentKey)),
    db
      .select({ remainingCredit: tokenlessCreditBalance.remainingCredit })
      .from(tokenlessCreditBalance)
      .where(eq(tokenlessCreditBalance.deploymentKey, deployment.deploymentKey)),
    db
      .select({ id: tokenlessCreditEvent.id })
      .from(tokenlessCreditEvent)
      .where(eq(tokenlessCreditEvent.deploymentKey, deployment.deploymentKey)),
  ]);
  const byState: Record<string, number> = {};
  for (const row of rows) byState[String(row.state)] = (byState[String(row.state)] ?? 0) + 1;
  return c.json({
    status: "ok",
    deploymentKey: deployment.deploymentKey,
    rounds: rows.length,
    byState,
    creditOwners: creditBalances.length,
    creditEvents: creditEvents.length,
    totalRemainingCredit: creditBalances
      .reduce((total, row) => total + row.remainingCredit, 0n)
      .toString(),
  });
});

app.get("/rounds", async (c) => {
  const now = parseTimestamp(c.req.query("now")) ?? BigInt(Math.floor(Date.now() / 1_000));
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
  if (roundId === null) return c.json({ error: "roundId must be an unsigned integer" }, 400);
  const row = await db.query.tokenlessRound.findFirst({
    where: and(
      eq(tokenlessRound.id, roundKey(deployment.deploymentKey, roundId)),
      eq(tokenlessRound.deploymentKey, deployment.deploymentKey),
    ),
  });
  if (!row) return c.json({ error: "Round not found" }, 404);
  const now = parseTimestamp(c.req.query("now")) ?? BigInt(Math.floor(Date.now() / 1_000));
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
  if (roundId === null) return c.json({ error: "roundId must be an unsigned integer" }, 400);
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
  if (roundId === null) return c.json({ error: "roundId must be an unsigned integer" }, 400);
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
  if (roundId === null) return c.json({ error: "roundId must be an unsigned integer" }, 400);
  const rows = await db
    .select()
    .from(tokenlessCreditEvent)
    .where(
      and(
        eq(tokenlessCreditEvent.deploymentKey, deployment.deploymentKey),
        eq(tokenlessCreditEvent.roundId, roundId),
      ),
    )
    .orderBy(asc(tokenlessCreditEvent.blockNumber), asc(tokenlessCreditEvent.logIndex));
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
      .orderBy(desc(tokenlessCreditEvent.blockNumber), desc(tokenlessCreditEvent.logIndex))
      .limit(limit(c.req.query("limit"), 100)),
  ]);
  return c.json(jsonSafe({
    deploymentKey: deployment.deploymentKey,
    owner,
    remainingCredit: balance?.remainingCredit ?? 0n,
    totalAccrued: balance?.totalAccrued ?? 0n,
    totalWithdrawn: balance?.totalWithdrawn ?? 0n,
    events,
  }));
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

app.get("/keeper/work", async (c) => {
  const authorization = keeperAuthorization(c.req.header("authorization"));
  if (authorization === "missing") return c.json({ error: "PONDER_KEEPER_WORK_TOKEN is required" }, 503);
  if (authorization === "invalid") return c.json({ error: "Invalid keeper token" }, 401);
  const now = parseTimestamp(c.req.query("now"));
  if (now === null) return c.json({ error: "now must be an unsigned integer timestamp" }, 400);

  const rows = await db
    .select()
    .from(tokenlessRound)
    .where(eq(tokenlessRound.deploymentKey, deployment.deploymentKey))
    .orderBy(asc(tokenlessRound.roundId))
    .limit(MAX_LIMIT);
  const work = rows.flatMap((row) => {
    const action = keeperAction(row, now);
    if (!action) return [];
    return [{
      action,
      roundId: row.roundId.toString(),
      cursor:
        action === "process_aggregate"
          ? row.aggregateCursor
          : action === "process_weights"
            ? row.weightCursor
            : null,
    }];
  });
  return c.json({
    deploymentKey: deployment.deploymentKey,
    chainId: deployment.chainId,
    panelAddress: deployment.panelAddress,
    now: now.toString(),
    work,
  });
});

export default app;
