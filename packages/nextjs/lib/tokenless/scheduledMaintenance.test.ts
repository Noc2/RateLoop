import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  authorizeTokenlessCron,
  runTokenlessScheduledMaintenance,
  seedTokenlessScheduledWork,
} from "~~/lib/tokenless/scheduledMaintenance";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const NOW = new Date("2026-07-14T15:00:00.000Z");

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

async function seedConfirmedExecution(operationKey: string) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_asks
          (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json,
           status, sandbox, created_at, updated_at)
          VALUES (?, ?, 'request-hash', 'quote-test', '{}', '{}', 'open', false, ?, ?)`,
    args: [operationKey, `idem:${operationKey}`, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_chain_executions
          (execution_id, operation_key, payment_mode, payment_reference, deployment_key, chain_id,
           deployment_block, panel_address, issuer_address, x402_submitter_address, usdc_address,
           funder_address, content_id, terms_hash, round_terms_json, total_funded_atomic, state,
           round_id, created_at, updated_at, confirmed_at)
          VALUES (?, ?, 'prepaid', ?, 'tokenless-v3:test', 84532, 1,
                  '0x1111111111111111111111111111111111111111',
                  '0x2222222222222222222222222222222222222222',
                  '0x3333333333333333333333333333333333333333',
                  '0x4444444444444444444444444444444444444444',
                  '0x5555555555555555555555555555555555555555',
                  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                  '{}', 1, 'confirmed', 42, ?, ?, ?)`,
    args: [`exec:${operationKey}`, operationKey, `payment:${operationKey}`, NOW, NOW, NOW],
  });
}

function processors(
  publish: (operationKey: string) => Promise<void>,
  notifications = { dead: 0, delivered: 0, enqueued: 0, materialized: 0, retry: 0, suppressed: 0 },
) {
  return {
    async deleteArtifact() {
      return true;
    },
    async publishFinalizedRound(input: { operationKey: string }) {
      await publish(input.operationKey);
    },
    async deliverWebhooks() {
      return [];
    },
    async processNotifications() {
      return notifications;
    },
    async processSurpriseBounties() {
      return { paid: 0, pendingClaim: 0, retry: 0, reconciliationRequired: 0 };
    },
  };
}

test("scheduled maintenance publishes each due round once and deduplicates a cron bucket", async () => {
  await seedConfirmedExecution("operation_due_1");
  const published: string[] = [];
  const first = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: processors(async operationKey => {
      published.push(operationKey);
    }),
  });
  if (first.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(first.status, "healthy");
  assert.deepEqual(first.summary.work, { completed: 1, dead: 0, deferred: 0, retry: 0 });
  assert.deepEqual(published, ["operation_due_1"]);

  const duplicate = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: processors(async operationKey => {
      published.push(operationKey);
    }),
  });
  assert.equal(duplicate.status, "duplicate");
  assert.deepEqual(published, ["operation_due_1"]);
});

test("a confirmed but not-finalized round is deferred without consuming its retry budget", async () => {
  await seedConfirmedExecution("operation_not_final");
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: processors(async () => {
      throw new TokenlessServiceError(
        "Indexed round is not completely finalized.",
        409,
        "indexed_evidence_pending",
        true,
      );
    }),
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "healthy");
  assert.deepEqual(result.summary.work, { completed: 0, dead: 0, deferred: 1, retry: 0 });
  const item = await dbClient.execute(
    "SELECT state, attempt_count, last_error FROM tokenless_scheduled_work_items WHERE subject_key = 'operation_not_final'",
  );
  assert.equal(item.rows[0]?.state, "retry");
  assert.equal(Number(item.rows[0]?.attempt_count), 0);
  assert.match(String(item.rows[0]?.last_error), /not completely finalized/);
});

test("persistent worker failures become visible dead-letter health evidence", async () => {
  await seedConfirmedExecution("operation_broken");
  await seedTokenlessScheduledWork(NOW);
  await dbClient.execute({
    sql: "UPDATE tokenless_scheduled_work_items SET attempt_count = 19 WHERE subject_key = ?",
    args: ["operation_broken"],
  });
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: processors(async () => {
      throw new Error("permanent publication failure");
    }),
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.summary.work, { completed: 0, dead: 1, deferred: 0, retry: 0 });
  const item = await dbClient.execute(
    "SELECT state, attempt_count, dead_at FROM tokenless_scheduled_work_items WHERE subject_key = 'operation_broken'",
  );
  assert.equal(item.rows[0]?.state, "dead");
  assert.equal(Number(item.rows[0]?.attempt_count), 20);
  assert.ok(item.rows[0]?.dead_at);
});

test("scheduled maintenance reports notification retries as degraded health evidence", async () => {
  const notificationSummary = { dead: 0, delivered: 1, enqueued: 2, materialized: 2, retry: 1, suppressed: 0 };
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: processors(async () => {}, notificationSummary),
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.summary.notifications, notificationSummary);
});

test("cron authorization fails closed when missing or incorrect", () => {
  assert.throws(
    () => authorizeTokenlessCron("Bearer secret", ""),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "cron_unavailable",
  );
  assert.throws(
    () => authorizeTokenlessCron("Bearer wrong", "correct"),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_cron_credential",
  );
  assert.doesNotThrow(() => authorizeTokenlessCron("Bearer correct", "correct"));
});
