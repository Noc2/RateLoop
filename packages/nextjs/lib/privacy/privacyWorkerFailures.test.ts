import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  recordPrivacyWorkerFailure,
  resolvePrivacyWorkerFailure,
  revivePrivacyWorkerFailures,
} from "~~/lib/privacy/privacyWorkerFailures";

const NOW = new Date("2026-07-28T12:00:00.000Z");

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

async function failure(workItemKey: string) {
  const result = await dbClient.execute({
    sql: `SELECT status, attempt_count FROM tokenless_privacy_worker_failures
          WHERE worker_kind = 'subject_request' AND work_item_key = ?`,
    args: [workItemKey],
  });
  return result.rows[0];
}

async function failRepeatedly(workItemKey: string, times: number, from: Date) {
  for (let attempt = 0; attempt < times; attempt += 1) {
    await recordPrivacyWorkerFailure({
      error: new Error("statement timeout"),
      now: new Date(from.getTime() + attempt),
      workerKind: "subject_request",
      workItemKey,
    });
  }
}

test("a subject request that exhausted its retries returns to the queue after the revival delay", async () => {
  await failRepeatedly("dsr_exhausted", 5, NOW);
  // Both privacy queues admit only 'retrying' rows, so a dead row is a request that never completes.
  assert.deepEqual(await failure("dsr_exhausted"), { attempt_count: 5, status: "dead" });

  // Reviving immediately would just cycle the same failing work.
  assert.deepEqual(await revivePrivacyWorkerFailures(new Date(NOW.getTime() + 60 * 60_000)), { revived: 0 });
  assert.equal((await failure("dsr_exhausted"))?.status, "dead");

  assert.deepEqual(await revivePrivacyWorkerFailures(new Date(NOW.getTime() + 7 * 60 * 60_000)), { revived: 1 });
  // The stored column has a BETWEEN 1 AND 5 constraint, so the budget restarts at its floor.
  assert.deepEqual(await failure("dsr_exhausted"), { attempt_count: 1, status: "retrying" });

  // The alert stays raised: a retry is not evidence that the cause is gone.
  const alert = await dbClient.execute({
    sql: `SELECT operator_alert_state FROM tokenless_privacy_worker_failures WHERE work_item_key = ?`,
    args: ["dsr_exhausted"],
  });
  assert.equal(alert.rows[0]?.operator_alert_state, "pending");
});

test("a resolved work item starts its next failure from a full retry budget", async () => {
  await failRepeatedly("dsr_recovered", 4, NOW);
  assert.deepEqual(await failure("dsr_recovered"), { attempt_count: 4, status: "retrying" });

  await resolvePrivacyWorkerFailure({
    now: new Date(NOW.getTime() + 60_000),
    workerKind: "subject_request",
    workItemKey: "dsr_recovered",
  });
  // The resolved row keeps its history; the budget is restored where the next failure reads it.
  assert.deepEqual(await failure("dsr_recovered"), { attempt_count: 4, status: "resolved" });

  // Without the reset the retained high-water mark made the very next transient failure terminal.
  await recordPrivacyWorkerFailure({
    error: new Error("statement timeout"),
    now: new Date(NOW.getTime() + 120_000),
    workerKind: "subject_request",
    workItemKey: "dsr_recovered",
  });
  assert.deepEqual(await failure("dsr_recovered"), { attempt_count: 1, status: "retrying" });
});
