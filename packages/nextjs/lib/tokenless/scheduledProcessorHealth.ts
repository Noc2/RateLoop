import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";

export type ScheduledProcessorConfigurationState = "broken" | "disabled" | "enabled";
export const SCHEDULED_PROCESSOR_FAILURE_STATUS_THRESHOLD = 3;

export type ScheduledProcessorHealthObservation = {
  configurationState: ScheduledProcessorConfigurationState;
  disabledReason?: string;
  errorCode?: string;
  errorDigest?: `sha256:${string}`;
  processor: string;
};

function validateObservation(observation: ScheduledProcessorHealthObservation) {
  if (!/^[A-Za-z][A-Za-z0-9]{0,79}$/u.test(observation.processor)) {
    throw new Error("Scheduled processor name is invalid.");
  }
  if (observation.configurationState === "broken") {
    if (
      !observation.errorCode ||
      !/^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(observation.errorCode) ||
      !observation.errorDigest ||
      !/^sha256:[0-9a-f]{64}$/u.test(observation.errorDigest)
    ) {
      throw new Error("Broken scheduled processor health requires bounded error evidence.");
    }
    if (observation.disabledReason !== undefined) {
      throw new Error("A broken scheduled processor cannot declare a disabled reason.");
    }
    return;
  }
  if (observation.errorCode !== undefined || observation.errorDigest !== undefined) {
    throw new Error("A non-broken scheduled processor cannot declare error evidence.");
  }
  if (observation.configurationState === "disabled") {
    if (!observation.disabledReason?.trim() || observation.disabledReason.length > 240) {
      throw new Error("A disabled scheduled processor requires a bounded reason.");
    }
    return;
  }
  if (observation.disabledReason !== undefined) {
    throw new Error("An enabled scheduled processor cannot declare a disabled reason.");
  }
}

async function persistObservation(
  client: Pick<PoolClient, "query">,
  observation: ScheduledProcessorHealthObservation,
  now: Date,
) {
  validateObservation(observation);
  const broken = observation.configurationState === "broken";
  const enabled = observation.configurationState === "enabled";
  await client.query(
    `INSERT INTO tokenless_scheduled_processor_health
       (processor_name,configuration_state,consecutive_failures,first_failed_at,last_failed_at,
        last_succeeded_at,last_error_code,last_error_digest,disabled_reason,operator_alert_state,updated_at)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (processor_name) DO UPDATE SET
       configuration_state=EXCLUDED.configuration_state,
       consecutive_failures=CASE
         WHEN EXCLUDED.configuration_state='broken'
           THEN CASE
             WHEN tokenless_scheduled_processor_health.configuration_state='broken'
               THEN tokenless_scheduled_processor_health.consecutive_failures + 1
             ELSE 1
           END
         ELSE 0
       END,
       first_failed_at=CASE
         WHEN EXCLUDED.configuration_state='broken'
           THEN CASE
             WHEN tokenless_scheduled_processor_health.configuration_state='broken'
               THEN tokenless_scheduled_processor_health.first_failed_at
             ELSE EXCLUDED.first_failed_at
           END
         ELSE NULL
       END,
       last_failed_at=CASE
         WHEN EXCLUDED.configuration_state='broken'
           THEN EXCLUDED.last_failed_at
         ELSE tokenless_scheduled_processor_health.last_failed_at
       END,
       last_succeeded_at=CASE
         WHEN EXCLUDED.configuration_state='enabled'
           THEN EXCLUDED.last_succeeded_at
         ELSE tokenless_scheduled_processor_health.last_succeeded_at
       END,
       last_error_code=EXCLUDED.last_error_code,
       last_error_digest=EXCLUDED.last_error_digest,
       disabled_reason=EXCLUDED.disabled_reason,
       operator_alert_state=EXCLUDED.operator_alert_state,
       updated_at=EXCLUDED.updated_at`,
    [
      observation.processor,
      observation.configurationState,
      broken ? 1 : 0,
      broken ? now : null,
      enabled ? now : null,
      observation.errorCode ?? null,
      observation.errorDigest ?? null,
      observation.disabledReason?.trim() ?? null,
      broken ? "pending" : "resolved",
      now,
    ],
  );
}

/**
 * Persist one current-state row per scheduled processor. Throughput is intentionally absent:
 * running successfully with no due work is healthy, while deliberate disablement and failures
 * remain distinct operator states.
 */
export async function persistScheduledProcessorHealth(
  observations: Iterable<ScheduledProcessorHealthObservation>,
  now = new Date(),
) {
  if (!Number.isFinite(now.getTime())) throw new Error("Scheduled processor health time is invalid.");
  const unique = new Map<string, ScheduledProcessorHealthObservation>();
  for (const observation of observations) {
    if (unique.has(observation.processor)) {
      throw new Error(`Scheduled processor ${observation.processor} reported health more than once.`);
    }
    unique.set(observation.processor, observation);
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    for (const observation of unique.values()) {
      await persistObservation(client, observation, now);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The cron status gate is based only on repeated execution failure. A processor that is
 * deliberately disabled never qualifies, and successful recovery resets the consecutive count.
 * Return only a boolean so HTTP responses cannot expose processor names or error evidence.
 */
export async function hasRepeatedScheduledProcessorFailure() {
  const result = await dbPool.query(
    `SELECT 1 FROM tokenless_scheduled_processor_health
     WHERE configuration_state='broken'
       AND operator_alert_state='pending'
       AND consecutive_failures >= $1
     LIMIT 1`,
    [SCHEDULED_PROCESSOR_FAILURE_STATUS_THRESHOLD],
  );
  return (result.rowCount ?? result.rows.length) > 0;
}

export const __scheduledProcessorHealthTestUtils = { validateObservation };
