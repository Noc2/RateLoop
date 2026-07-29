import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";
import type { PoolClient } from "pg";
import { drainEnterpriseIdentityAuditOutbox } from "~~/lib/auth/enterpriseIdentityAudit";
import { synchronizeScimUser } from "~~/lib/auth/enterpriseIdentityPolicy";
import { drainPrepaidTopupAuditOutbox } from "~~/lib/billing/prepaidTopups";
import { processStripeWebhook } from "~~/lib/billing/webhooks";
import {
  AdvisoryLockReleaseError,
  AdvisoryLockUnavailableError,
  acquireSessionAdvisoryLock,
  acquireTransactionAdvisoryLock,
  releaseSessionAdvisoryLocksAndConnection,
  tryAcquireSessionAdvisoryLock,
} from "~~/lib/db/advisoryLocks";
import { projectAssuranceLifecycleEvents } from "~~/lib/tokenless/assuranceEventStreaming";
import { ingestAutomatedEvalReceipt } from "~~/lib/tokenless/automatedEvalReceipts";
import { ensureFeedbackBonusPool } from "~~/lib/tokenless/feedbackBonusPoolProjection";
import { produceScheduledIntegrityEpoch } from "~~/lib/tokenless/integrityEpochProducer";
import { reserveSurpriseBountyCapacity } from "~~/lib/tokenless/surpriseBountyService";

type QueryResult = { rows: Record<string, unknown>[] };

function lockClient(results: QueryResult[]) {
  const queries: { sql: string; values: readonly unknown[] }[] = [];
  const releases: (Error | boolean | undefined)[] = [];
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      queries.push({ sql, values });
      const result = results.shift();
      if (!result) throw new Error("Unexpected advisory-lock query.");
      return result;
    },
    release(error?: Error | boolean) {
      releases.push(error);
    },
  } as unknown as Pick<PoolClient, "query" | "release">;
  return { client, queries, releases };
}

test("successful acquisition uses only non-blocking PostgreSQL primitives", async () => {
  const session = lockClient([{ rows: [{ acquired: true }] }]);
  await acquireSessionAdvisoryLock(session.client, "session-key");
  assert.equal(session.queries[0]?.sql, "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired");

  const transaction = lockClient([{ rows: [{ acquired: true }] }]);
  await acquireTransactionAdvisoryLock(transaction.client, "transaction-key");
  assert.equal(transaction.queries[0]?.sql, "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired");
});

test("session and transaction acquisition fail immediately when coordination is busy", async () => {
  const session = lockClient([{ rows: [{ acquired: false }] }]);
  assert.equal(await tryAcquireSessionAdvisoryLock(session.client, "session-key"), false);
  assert.deepEqual(session.queries, [
    {
      sql: "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      values: ["session-key"],
    },
  ]);

  const requiredSession = lockClient([{ rows: [{ acquired: false }] }]);
  await assert.rejects(
    acquireSessionAdvisoryLock(requiredSession.client, "session-key"),
    (error: unknown) =>
      error instanceof AdvisoryLockUnavailableError &&
      error.code === "database_coordination_busy" &&
      error.retryable &&
      error.status === 503,
  );

  const transaction = lockClient([{ rows: [{ acquired: false }] }]);
  await assert.rejects(
    acquireTransactionAdvisoryLock(transaction.client, "transaction-key"),
    AdvisoryLockUnavailableError,
  );
  assert.equal(transaction.queries[0]?.sql, "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired");
});

test("session locks release in reverse order before returning the connection", async () => {
  const connection = lockClient([{ rows: [{ released: true }] }, { rows: [{ released: true }] }]);
  await releaseSessionAdvisoryLocksAndConnection(connection.client, ["first", "second"]);
  assert.deepEqual(
    connection.queries.map(query => query.values[0]),
    ["second", "first"],
  );
  assert.deepEqual(connection.releases, [undefined]);
});

test("a busy optional worker lock returns its connection without issuing an unmatched unlock", async () => {
  const connection = lockClient([]);
  await releaseSessionAdvisoryLocksAndConnection(connection.client, []);
  assert.deepEqual(connection.queries, []);
  assert.deepEqual(connection.releases, [undefined]);
});

test("an unlock failure destroys the connection instead of returning a held lock to the pool", async () => {
  const connection = lockClient([{ rows: [{ released: false }] }]);
  await assert.rejects(releaseSessionAdvisoryLocksAndConnection(connection.client, ["held"]), AdvisoryLockReleaseError);
  assert.equal(connection.releases.length, 1);
  assert.ok(connection.releases[0] instanceof AdvisoryLockReleaseError);
});

test("all advisory-lock consumers share the fail-fast coordination boundary", () => {
  const consumers = [
    drainEnterpriseIdentityAuditOutbox,
    synchronizeScimUser,
    drainPrepaidTopupAuditOutbox,
    processStripeWebhook,
    projectAssuranceLifecycleEvents,
    ingestAutomatedEvalReceipt,
    ensureFeedbackBonusPool,
    produceScheduledIntegrityEpoch,
    reserveSurpriseBountyCapacity,
  ];
  assert.ok(consumers.every(consumer => typeof consumer === "function"));

  const packageRoot = new URL("../../", import.meta.url);
  const expectedConsumerFiles = [
    "lib/auth/enterpriseIdentityAudit.ts",
    "lib/auth/enterpriseIdentityPolicy.ts",
    "lib/billing/prepaidTopups.ts",
    "lib/billing/webhooks.ts",
    "lib/tokenless/assuranceEventStreaming.ts",
    "lib/tokenless/automatedEvalReceipts.ts",
    "lib/tokenless/feedbackBonusPoolProjection.ts",
    "lib/tokenless/integrityEpochProducer.ts",
    "lib/tokenless/surpriseBountyService.ts",
  ];
  for (const relativePath of expectedConsumerFiles) {
    assert.match(readFileSync(new URL(relativePath, packageRoot), "utf8"), /from "~~\/lib\/db\/advisoryLocks"/u);
  }

  const productionFiles = sourceFiles(packageRoot);
  const blockingCalls = productionFiles.flatMap(path => {
    const source = readFileSync(path, "utf8");
    return /\bpg_advisory_(?:xact_)?lock\s*\(/u.test(source) ? [path] : [];
  });
  assert.deepEqual(blockingCalls, []);

  const directTryLockCallers = productionFiles
    .filter(path => /\bpg_try_advisory_(?:xact_)?lock\s*\(/u.test(readFileSync(path, "utf8")))
    .map(path => path.split("/packages/nextjs/")[1])
    .sort();
  assert.deepEqual(directTryLockCallers, ["lib/db/advisoryLocks.ts", "scripts/migrate-hosted-database.mjs"]);
});

function sourceFiles(rootUrl: URL): string[] {
  const root = rootUrl.pathname;
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if ([".next", "dist", "node_modules", "out"].includes(entry.name)) return [];
      return sourceFiles(new URL(`${entry.name}/`, rootUrl));
    }
    if (![".js", ".mjs", ".ts", ".tsx"].includes(extname(entry.name))) return [];
    if (/\.(?:interaction|property|test)\.[cm]?[jt]sx?$/u.test(entry.name)) return [];
    return [path];
  });
}
