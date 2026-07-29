import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  __scheduledProcessorHealthTestUtils,
  persistScheduledProcessorHealth,
} from "~~/lib/tokenless/scheduledProcessorHealth";

const FIRST = new Date("2026-07-29T12:00:00.000Z");
const SECOND = new Date("2026-07-29T12:05:00.000Z");
const DIGEST = `sha256:${"a".repeat(64)}` as const;

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

async function row(processor: string) {
  const result = await dbClient.execute({
    sql: `SELECT configuration_state,consecutive_failures,first_failed_at,last_failed_at,
                 last_succeeded_at,last_error_code,last_error_digest,disabled_reason,operator_alert_state
          FROM tokenless_scheduled_processor_health WHERE processor_name=?`,
    args: [processor],
  });
  return result.rows[0] as Record<string, unknown> | undefined;
}

test("zero-work success is enabled while a deliberate switch-off is disabled", async () => {
  await persistScheduledProcessorHealth(
    [
      { configurationState: "enabled", processor: "reconcileDeletionJobs" },
      {
        configurationState: "disabled",
        disabledReason: "TOKENLESS_PREPAID_TOPUP_ENABLED is not true",
        processor: "reconcilePrepaidTopups",
      },
    ],
    FIRST,
  );

  assert.deepEqual(
    {
      alert: (await row("reconcileDeletionJobs"))?.operator_alert_state,
      state: (await row("reconcileDeletionJobs"))?.configuration_state,
    },
    { alert: "resolved", state: "enabled" },
  );
  assert.deepEqual(
    {
      alert: (await row("reconcilePrepaidTopups"))?.operator_alert_state,
      reason: (await row("reconcilePrepaidTopups"))?.disabled_reason,
      state: (await row("reconcilePrepaidTopups"))?.configuration_state,
    },
    {
      alert: "resolved",
      reason: "TOKENLESS_PREPAID_TOPUP_ENABLED is not true",
      state: "disabled",
    },
  );
});

test("failures accumulate an operator alert and a later success resolves it", async () => {
  const broken = {
    configurationState: "broken" as const,
    errorCode: "upstream_timeout",
    errorDigest: DIGEST,
    processor: "deliverWebhooks",
  };
  await persistScheduledProcessorHealth([broken], FIRST);
  await persistScheduledProcessorHealth([broken], SECOND);
  const failed = await row("deliverWebhooks");
  assert.equal(failed?.configuration_state, "broken");
  assert.equal(Number(failed?.consecutive_failures), 2);
  assert.equal(failed?.operator_alert_state, "pending");
  assert.equal(failed?.last_error_digest, DIGEST);

  await persistScheduledProcessorHealth(
    [{ configurationState: "enabled", processor: "deliverWebhooks" }],
    new Date(SECOND.getTime() + 60_000),
  );
  const resolved = await row("deliverWebhooks");
  assert.equal(resolved?.configuration_state, "enabled");
  assert.equal(Number(resolved?.consecutive_failures), 0);
  assert.equal(resolved?.operator_alert_state, "resolved");
  assert.equal(resolved?.last_error_digest, null);
});

test("health declarations reject ambiguous or unsafe states", () => {
  assert.throws(
    () =>
      __scheduledProcessorHealthTestUtils.validateObservation({
        configurationState: "disabled",
        processor: "produceIntegrityEpoch",
      }),
    /requires a bounded reason/u,
  );
  assert.throws(
    () =>
      __scheduledProcessorHealthTestUtils.validateObservation({
        configurationState: "broken",
        processor: "deliverWebhooks",
      }),
    /requires bounded error evidence/u,
  );
});
