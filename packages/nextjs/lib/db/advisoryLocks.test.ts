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
  AdvisoryLockUnavailableError,
  acquireTransactionAdvisoryLock,
  withTransactionAdvisoryLocks,
} from "~~/lib/db/advisoryLocks";
import { DatabaseRollbackError } from "~~/lib/db/transactionCleanup";
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
  const transaction = lockClient([{ rows: [{ acquired: true }] }]);
  await acquireTransactionAdvisoryLock(transaction.client, "transaction-key");
  assert.equal(transaction.queries[0]?.sql, "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired");
});

test("transaction acquisition fails immediately when coordination is busy", async () => {
  const transaction = lockClient([{ rows: [{ acquired: false }] }]);
  await assert.rejects(
    acquireTransactionAdvisoryLock(transaction.client, "transaction-key"),
    (error: unknown) =>
      error instanceof AdvisoryLockUnavailableError &&
      error.code === "database_coordination_busy" &&
      error.retryable &&
      error.status === 503,
  );
  assert.equal(transaction.queries[0]?.sql, "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired");
});

test("transaction coordination sorts and deduplicates locks on the operation client", async () => {
  const connection = lockClient([
    { rows: [] },
    { rows: [{ acquired: true }] },
    { rows: [{ acquired: true }] },
    { rows: [{ value: "same-client" }] },
    { rows: [] },
  ]);
  const pool = { connect: async () => connection.client as PoolClient };
  const result = await withTransactionAdvisoryLocks(pool, ["z-key", "a-key", "z-key"], async client => {
    const query = await client.query("SELECT 'same-client' AS value");
    return query.rows[0]?.value;
  });

  assert.equal(result, "same-client");
  assert.deepEqual(
    connection.queries.map(query => [query.sql, query.values]),
    [
      ["BEGIN", []],
      ["SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", ["a-key"]],
      ["SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", ["z-key"]],
      ["SELECT 'same-client' AS value", []],
      ["COMMIT", []],
    ],
  );
  assert.deepEqual(connection.releases, [undefined]);
});

test("transaction coordination rolls back and returns the operation client after failure", async () => {
  const failure = new Error("operation failed");
  const connection = lockClient([{ rows: [] }, { rows: [{ acquired: true }] }, { rows: [] }]);
  const pool = { connect: async () => connection.client as PoolClient };

  await assert.rejects(
    withTransactionAdvisoryLocks(pool, ["key"], async () => {
      throw failure;
    }),
    failure,
  );
  assert.deepEqual(
    connection.queries.map(query => query.sql),
    ["BEGIN", "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", "ROLLBACK"],
  );
  assert.deepEqual(connection.releases, [undefined]);
});

test("transaction coordination destroys a connection when rollback fails", async () => {
  const connection = lockClient([{ rows: [] }, { rows: [{ acquired: true }] }]);
  const pool = { connect: async () => connection.client as PoolClient };

  await assert.rejects(
    withTransactionAdvisoryLocks(pool, ["key"], async () => {
      throw new Error("operation failed");
    }),
    (error: unknown) =>
      error instanceof DatabaseRollbackError &&
      error.cause instanceof Error &&
      /Unexpected advisory-lock query/u.test(error.cause.message),
  );
  assert.equal(connection.releases.length, 1);
  assert.ok(connection.releases[0] instanceof Error);
  assert.match((connection.releases[0] as Error).message, /Unexpected advisory-lock query/u);
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

  const sessionLockConsumers = productionFiles
    .filter(path => !path.endsWith("/lib/db/advisoryLocks.ts"))
    .filter(path => /\b(?:acquire|tryAcquire|release)SessionAdvisoryLock/u.test(readFileSync(path, "utf8")))
    .map(path => path.split("/packages/nextjs/")[1])
    .sort();
  assert.deepEqual(sessionLockConsumers, []);
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
