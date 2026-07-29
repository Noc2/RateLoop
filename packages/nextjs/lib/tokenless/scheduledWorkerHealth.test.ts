import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { getScheduledWorkerHealth } from "~~/lib/tokenless/scheduledWorkerHealth";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "rlp_scheduled_health_owner_0001";
const NOW = new Date("2026-07-26T12:00:00.000Z");

beforeEach(async () => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspaces (workspace_id,name,status,created_at,updated_at)
          VALUES ('workspace_health','Health workspace','active',?,?)`,
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
          VALUES ('workspace_health',?,'owner',?)`,
    args: [OWNER, NOW],
  });
});

afterEach(() => __setDatabaseResourcesForTests(null));

test("workspace owners can reach redacted degraded scheduled-worker health", async () => {
  const completedAt = new Date(NOW.getTime() - 60_000);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_scheduled_worker_runs
          (run_id,idempotency_key,trigger,status,summary_json,started_at,completed_at)
          VALUES ('swr_degraded','health:degraded','vercel_cron','degraded',?,?,?)`,
    args: [
      JSON.stringify({
        processorFailures: [{ processor: "privateEvidence", message: "private detail must not leave storage" }],
        notifications: { parked: 2, retry: 1, retryDeliveryIds: ["private-delivery-id"] },
        attestations: { unavailable: 1, dueJobIds: ["private-attestation-id"] },
        directPrivateReviewDeadlines: {
          retry: 4,
          retryOpportunityIds: ["private-opportunity-id"],
        },
        directPrivateReviewEvidence: { dead: 1, deadDeliveryIds: ["private-evidence-id"] },
      }),
      new Date(NOW.getTime() - 90_000),
      completedAt,
    ],
  });

  const health = await getScheduledWorkerHealth({
    accountAddress: OWNER,
    workspaceId: "workspace_health",
    now: NOW,
  });
  assert.equal(health.state, "degraded");
  assert.equal(health.lastCompletedAt, completedAt.toISOString());
  assert.deepEqual(
    health.signals.map(signal => [signal.key, signal.count]),
    [
      ["processorFailures", 1],
      ["notifications.parked", 2],
      ["notifications.retry", 1],
      ["attestations.unavailable", 1],
      ["directPrivateReviewDeadlines.retry", 4],
      ["directPrivateReviewEvidence.dead", 1],
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(health),
    /private detail|private-delivery-id|private-attestation-id|private-opportunity-id|private-evidence-id/u,
  );
});

test("stale or absent runs are visible and non-managers cannot inspect global health", async () => {
  let health = await getScheduledWorkerHealth({
    accountAddress: OWNER,
    workspaceId: "workspace_health",
    now: NOW,
  });
  assert.equal(health.state, "unavailable");

  await dbClient.execute({
    sql: `INSERT INTO tokenless_scheduled_worker_runs
          (run_id,idempotency_key,trigger,status,summary_json,started_at,completed_at)
          VALUES ('swr_stale','health:stale','vercel_cron','healthy','{}',?,?)`,
    args: [new Date(NOW.getTime() - 30 * 60_000), new Date(NOW.getTime() - 29 * 60_000)],
  });
  health = await getScheduledWorkerHealth({
    accountAddress: OWNER,
    workspaceId: "workspace_health",
    now: NOW,
  });
  assert.equal(health.state, "stale");

  await assert.rejects(
    () =>
      getScheduledWorkerHealth({
        accountAddress: "rlp_scheduled_health_outsider",
        workspaceId: "workspace_health",
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
});
