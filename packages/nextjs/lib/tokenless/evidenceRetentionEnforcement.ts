import { createHash } from "node:crypto";
import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";

type Row = Record<string, unknown>;
type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rowCount: number | null; rows: Row[] }> };

const DEFAULT_RUN_LIMIT = 20;
const DEFAULT_ITEM_LIMIT = 100;
const MAX_ATTEMPTS = 8;
const LEASE_MS = 10 * 60_000;
const STALE_LEASE_ERROR = "stale retention-enforcement claim recovered";

class RetentionClaimLostError extends Error {}

type RetentionAuditWriter = typeof appendAuditEvent;
let auditWriterOverride: RetentionAuditWriter | null = null;

export type EvidenceRetentionEnforcementSummary = {
  seeded: number;
  due: number;
  completed: number;
  superseded: number;
  retry: number;
  dead: number;
  objectsQueued: number;
  accessLogsPruned: number;
  objectsHeld: number;
  accessLogsHeld: number;
  backlog: number;
  integrityRecordsPreserved: {
    auditEvents: number;
    evidencePackets: number;
    attestations: number;
    wormReceipts: number;
  };
  retryRunIds: string[];
};

function string(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key] ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function bounded(value: number | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Retention worker limit is invalid.");
  return Math.min(value, maximum);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function addCalendarMonths(value: Date, months: number) {
  const result = new Date(value);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0, result.getUTCHours(), result.getUTCMinutes()),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

function retryAt(now: Date, attempt: number) {
  const delay = Math.min(30_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 7), 3_600_000);
  return new Date(now.getTime() + delay);
}

function scheduledWorkItemId(objectId: string) {
  return `swi_${digest(`delete_artifact:${objectId}`).slice(0, 40)}`;
}

function unheldClause(alias: string, workspaceParameter = 1) {
  return `NOT EXISTS (
      SELECT 1 FROM tokenless_legal_holds workspace_hold
      WHERE workspace_hold.workspace_id = $${workspaceParameter}
        AND workspace_hold.status = 'active' AND workspace_hold.project_id IS NULL
    ) AND ${alias}.project_id NOT IN (
      SELECT project_hold.project_id FROM tokenless_legal_holds project_hold
      WHERE project_hold.workspace_id = $${workspaceParameter}
        AND project_hold.status = 'active' AND project_hold.project_id IS NOT NULL
    )`;
}

function heldClause(alias: string, workspaceParameter = 1) {
  return `(
    EXISTS (
      SELECT 1 FROM tokenless_legal_holds workspace_hold
      WHERE workspace_hold.workspace_id = $${workspaceParameter}
        AND workspace_hold.status = 'active' AND workspace_hold.project_id IS NULL
    ) OR ${alias}.project_id IN (
      SELECT project_hold.project_id FROM tokenless_legal_holds project_hold
      WHERE project_hold.workspace_id = $${workspaceParameter}
        AND project_hold.status = 'active' AND project_hold.project_id IS NOT NULL
    )
  )`;
}

async function workspaceHasDueRecords(input: {
  workspaceId: string;
  evidenceCutoff: Date;
  auditCutoff: Date;
  now: Date;
}) {
  const [objects, logs] = await Promise.all([
    dbPool.query(
      `SELECT o.object_id FROM tokenless_assurance_artifact_objects o
       WHERE o.workspace_id = $1 AND o.status = 'active' AND o.created_at <= $2 AND o.delete_after <= $3
         AND ${unheldClause("o")}
       LIMIT 1`,
      [input.workspaceId, input.evidenceCutoff, input.now],
    ),
    dbPool.query(
      `SELECT access.log_id FROM tokenless_assurance_access_logs access
       WHERE access.workspace_id = $1 AND access.occurred_at <= $2
         AND ${unheldClause("access")}
       LIMIT 1`,
      [input.workspaceId, input.auditCutoff],
    ),
  ]);
  return objects.rows.length > 0 || logs.rows.length > 0;
}

async function seedRetentionRuns(now: Date) {
  const policies = await dbClient.execute(
    `SELECT policy.workspace_id, policy.version, policy.evidence_retention_months, policy.audit_retention_months
     FROM tokenless_workspace_evidence_retention_policies policy
     JOIN tokenless_workspaces workspace ON workspace.workspace_id = policy.workspace_id AND workspace.status = 'active'
     WHERE policy.superseded_at IS NULL ORDER BY policy.workspace_id ASC`,
  );
  const hourlyBucket = now.toISOString().slice(0, 13);
  let seeded = 0;
  for (const value of policies.rows) {
    const row = value as Row;
    const workspaceId = string(row, "workspace_id")!;
    const policyVersion = integer(row, "version");
    const evidenceMonths = integer(row, "evidence_retention_months");
    const auditMonths = integer(row, "audit_retention_months");
    const evidenceCutoff = addCalendarMonths(now, -evidenceMonths);
    const auditCutoff = addCalendarMonths(now, -auditMonths);
    if (!(await workspaceHasDueRecords({ workspaceId, evidenceCutoff, auditCutoff, now }))) continue;
    const idempotencyKey = `retention:${digest(`${workspaceId}:${policyVersion}:${hourlyBucket}`)}`;
    const runId = `eer_${digest(idempotencyKey).slice(0, 40)}`;
    const inserted = await dbClient.execute({
      sql: `INSERT INTO tokenless_evidence_retention_enforcement_runs
            (run_id, idempotency_key, workspace_id, policy_version, evidence_retention_months,
             audit_retention_months, evidence_cutoff_at, audit_cutoff_at, state, attempt_count,
             next_attempt_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
            ON CONFLICT DO NOTHING`,
      args: [
        runId,
        idempotencyKey,
        workspaceId,
        policyVersion,
        evidenceMonths,
        auditMonths,
        evidenceCutoff,
        auditCutoff,
        now,
        now,
        now,
      ],
    });
    seeded += inserted.rowCount ?? 0;
  }
  return seeded;
}

async function claimDueRuns(now: Date, limit: number) {
  const exhausted = await dbClient.execute({
    sql: `UPDATE tokenless_evidence_retention_enforcement_runs
          SET state = 'dead', lease_expires_at = NULL, last_error = ?, dead_at = ?, updated_at = ?
          WHERE state = 'processing' AND lease_expires_at <= ? AND attempt_count >= ?`,
    args: [STALE_LEASE_ERROR, now, now, now, MAX_ATTEMPTS],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_evidence_retention_enforcement_runs
          SET state = 'retry', lease_expires_at = NULL, next_attempt_at = ?, last_error = ?, updated_at = ?
          WHERE state = 'processing' AND lease_expires_at <= ? AND attempt_count < ?`,
    args: [now, STALE_LEASE_ERROR, now, now, MAX_ATTEMPTS],
  });
  const due = await dbClient.execute({
    sql: `SELECT run_id FROM tokenless_evidence_retention_enforcement_runs
          WHERE state IN ('pending', 'retry') AND next_attempt_at <= ?
          ORDER BY next_attempt_at ASC, created_at ASC LIMIT ?`,
    args: [now, limit],
  });
  const claimed: Row[] = [];
  for (const value of due.rows) {
    const runId = string(value as Row, "run_id")!;
    const updated = await dbClient.execute({
      sql: `UPDATE tokenless_evidence_retention_enforcement_runs
            SET state = 'processing', attempt_count = attempt_count + 1, lease_expires_at = ?, updated_at = ?
            WHERE run_id = ? AND state IN ('pending', 'retry') AND attempt_count < ?`,
      args: [new Date(now.getTime() + LEASE_MS), now, runId, MAX_ATTEMPTS],
    });
    if (updated.rowCount !== 1) continue;
    const selected = await dbClient.execute({
      sql: `SELECT * FROM tokenless_evidence_retention_enforcement_runs
            WHERE run_id = ? AND state = 'processing' LIMIT 1`,
      args: [runId],
    });
    if (selected.rows[0]) claimed.push(selected.rows[0] as Row);
  }
  return { claimed, exhausted: exhausted.rowCount ?? 0 };
}

async function count(client: Queryable, sql: string, values: unknown[]) {
  const result = await client.query(sql, values);
  return integer(result.rows[0], "count");
}

async function queueArtifactDeletion(client: Queryable, objectId: string, now: Date) {
  const classify = async (state: string | null) => {
    if (state === "completed") {
      const recovered = await client.query(
        `UPDATE tokenless_scheduled_work_items
         SET state = 'pending', attempt_count = 0, next_attempt_at = $1, last_error = NULL,
             completed_at = NULL, dead_at = NULL, updated_at = $1
         WHERE kind = 'delete_artifact' AND subject_key = $2 AND state = 'completed'`,
        [now, objectId],
      );
      return { backlog: recovered.rowCount === 1 ? 0 : 1, queued: recovered.rowCount === 1 ? 1 : 0 };
    }
    if (state === "pending" || state === "processing" || state === "retry") return { backlog: 0, queued: 0 };
    return { backlog: 1, queued: 0 };
  };
  const existing = await client.query(
    `SELECT state FROM tokenless_scheduled_work_items
     WHERE kind = 'delete_artifact' AND subject_key = $1 LIMIT 1 FOR UPDATE`,
    [objectId],
  );
  const state = string(existing.rows[0], "state");
  if (state) return classify(state);
  const inserted = await client.query(
    `INSERT INTO tokenless_scheduled_work_items
     (item_id, kind, subject_key, state, attempt_count, next_attempt_at, created_at, updated_at)
     VALUES ($1, 'delete_artifact', $2, 'pending', 0, $3, $3, $3)
     ON CONFLICT (kind, subject_key) DO NOTHING RETURNING item_id`,
    [scheduledWorkItemId(objectId), objectId, now],
  );
  if (inserted.rows.length === 1) return { backlog: 0, queued: 1 };
  const raced = await client.query(
    `SELECT state FROM tokenless_scheduled_work_items
     WHERE kind = 'delete_artifact' AND subject_key = $1 LIMIT 1 FOR UPDATE`,
    [objectId],
  );
  return classify(string(raced.rows[0], "state"));
}

async function pruneRun(row: Row, now: Date, itemLimit: number) {
  const runId = string(row, "run_id")!;
  const workspaceId = string(row, "workspace_id")!;
  const evidenceCutoff = new Date(string(row, "evidence_cutoff_at")!);
  const auditCutoff = new Date(string(row, "audit_cutoff_at")!);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const claim = await client.query(
      `SELECT state, lease_expires_at FROM tokenless_evidence_retention_enforcement_runs
       WHERE run_id = $1 FOR UPDATE`,
      [runId],
    );
    if (
      string(claim.rows[0], "state") !== "processing" ||
      new Date(string(claim.rows[0], "lease_expires_at") ?? 0).getTime() !==
        new Date(string(row, "lease_expires_at") ?? 0).getTime()
    ) {
      throw new RetentionClaimLostError("Retention-enforcement claim was replaced.");
    }
    const workspace = await client.query(
      "SELECT workspace_id, status FROM tokenless_workspaces WHERE workspace_id = $1 FOR UPDATE",
      [workspaceId],
    );
    if (workspace.rowCount !== 1) throw new Error("Retention workspace is unavailable.");
    const effectivePolicy = await client.query(
      `SELECT version FROM tokenless_workspace_evidence_retention_policies
       WHERE workspace_id = $1 AND superseded_at IS NULL LIMIT 1`,
      [workspaceId],
    );
    if (
      string(workspace.rows[0], "status") !== "active" ||
      integer(effectivePolicy.rows[0], "version") !== integer(row, "policy_version")
    ) {
      await client.query(
        `UPDATE tokenless_evidence_retention_enforcement_runs
         SET state = 'completed', lease_expires_at = NULL, last_error = 'effective retention policy superseded',
             pruned_at = $1, completed_at = $1, updated_at = $1
         WHERE run_id = $2 AND state = 'processing'`,
        [now, runId],
      );
      await client.query("COMMIT");
      return { superseded: true } as const;
    }
    const objectPredicate = `o.workspace_id = $1 AND o.status = 'active' AND o.created_at <= $2
      AND o.delete_after <= $3 AND ${unheldClause("o")}`;
    const logPredicate = `access.workspace_id = $1 AND access.occurred_at <= $2
      AND ${unheldClause("access")}`;
    const [objectTotal, accessLogTotal, objectsHeld, accessLogsHeld] = await Promise.all([
      count(client, `SELECT COUNT(*) AS count FROM tokenless_assurance_artifact_objects o WHERE ${objectPredicate}`, [
        workspaceId,
        evidenceCutoff,
        now,
      ]),
      count(client, `SELECT COUNT(*) AS count FROM tokenless_assurance_access_logs access WHERE ${logPredicate}`, [
        workspaceId,
        auditCutoff,
      ]),
      count(
        client,
        `SELECT COUNT(*) AS count FROM tokenless_assurance_artifact_objects o
         WHERE o.workspace_id = $1 AND o.status = 'active' AND o.created_at <= $2 AND o.delete_after <= $3
           AND ${heldClause("o")}`,
        [workspaceId, evidenceCutoff, now],
      ),
      count(
        client,
        `SELECT COUNT(*) AS count FROM tokenless_assurance_access_logs access
         WHERE access.workspace_id = $1 AND access.occurred_at <= $2 AND ${heldClause("access")}`,
        [workspaceId, auditCutoff],
      ),
    ]);
    const objectRows = await client.query(
      `SELECT o.object_id FROM tokenless_assurance_artifact_objects o
       WHERE ${objectPredicate} ORDER BY o.created_at ASC, o.object_id ASC LIMIT $4`,
      [workspaceId, evidenceCutoff, now, itemLimit],
    );
    let objectsQueued = 0;
    let blockedDeleteItems = 0;
    for (const value of objectRows.rows) {
      const objectId = string(value, "object_id")!;
      const queued = await queueArtifactDeletion(client, objectId, now);
      objectsQueued += queued.queued;
      blockedDeleteItems += queued.backlog;
    }
    const accessRows = await client.query(
      `SELECT access.log_id FROM tokenless_assurance_access_logs access
       WHERE ${logPredicate} ORDER BY access.occurred_at ASC, access.log_id ASC LIMIT $3`,
      [workspaceId, auditCutoff, itemLimit],
    );
    let accessLogsPruned = 0;
    for (const value of accessRows.rows) {
      const removed = await client.query(
        `DELETE FROM tokenless_assurance_access_logs
         WHERE tokenless_assurance_access_logs.workspace_id = $1
           AND tokenless_assurance_access_logs.log_id = $2
           AND ${unheldClause("tokenless_assurance_access_logs")}
         RETURNING log_id`,
        [workspaceId, string(value, "log_id")],
      );
      accessLogsPruned += removed.rowCount ?? 0;
    }
    const [auditEvents, evidencePackets, attestations, wormReceipts] = await Promise.all([
      count(
        client,
        "SELECT COUNT(*) AS count FROM tokenless_audit_events WHERE workspace_id = $1 AND occurred_at <= $2",
        [workspaceId, auditCutoff],
      ),
      count(
        client,
        `SELECT COUNT(*) AS count FROM tokenless_assurance_evidence_packets packet
         JOIN tokenless_assurance_runs run ON run.run_id = packet.run_id
         JOIN tokenless_assurance_projects project ON project.project_id = run.project_id
         WHERE project.workspace_id = $1 AND packet.generated_at <= $2`,
        [workspaceId, evidenceCutoff],
      ),
      count(
        client,
        `SELECT COUNT(*) AS count FROM tokenless_assurance_attestation_jobs
         WHERE workspace_id = $1 AND boundary_at <= $2`,
        [workspaceId, evidenceCutoff],
      ),
      count(
        client,
        `SELECT COUNT(*) AS count FROM tokenless_assurance_worm_export_receipts
         WHERE workspace_id = $1 AND delivered_at <= $2`,
        [workspaceId, evidenceCutoff],
      ),
    ]);
    const backlog =
      Math.max(objectTotal - objectRows.rows.length, 0) +
      Math.max(accessLogTotal - accessLogsPruned, 0) +
      blockedDeleteItems;
    await client.query(
      `UPDATE tokenless_evidence_retention_enforcement_runs
       SET objects_queued = $1, access_logs_pruned = $2, objects_held = $3, access_logs_held = $4,
           backlog_count = $5, audit_events_preserved = $6, evidence_packets_preserved = $7,
           attestations_preserved = $8, worm_receipts_preserved = $9, pruned_at = $10, updated_at = $10
       WHERE run_id = $11 AND state = 'processing'`,
      [
        objectsQueued,
        accessLogsPruned,
        objectsHeld,
        accessLogsHeld,
        backlog,
        auditEvents,
        evidencePackets,
        attestations,
        wormReceipts,
        now,
        runId,
      ],
    );
    await client.query("COMMIT");
    return { superseded: false } as const;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordRunAudit(row: Row, now: Date) {
  const runId = string(row, "run_id")!;
  const workspaceId = string(row, "workspace_id")!;
  const alreadyRecorded = async () => {
    const existing = await dbClient.execute({
      sql: `SELECT event_id FROM tokenless_audit_events
            WHERE workspace_id = ? AND action = 'evidence.retention.enforced'
              AND target_kind = 'evidence_retention_run' AND target_id = ? LIMIT 1`,
      args: [workspaceId, runId],
    });
    return existing.rows.length > 0;
  };
  if (await alreadyRecorded()) return;
  const writer = auditWriterOverride ?? appendAuditEvent;
  try {
    await writer({
      workspaceId,
      actorKind: "system",
      actorReference: "system:evidence_retention_worker",
      assuranceMethod: "scheduled_worker",
      action: "evidence.retention.enforced",
      targetKind: "evidence_retention_run",
      targetId: runId,
      purpose: "workspace_evidence_retention",
      reason: "effective_workspace_policy_applied",
      result: "success",
      occurredAt: now,
      metadata: {
        policyVersion: integer(row, "policy_version"),
        evidenceCutoffAt: new Date(string(row, "evidence_cutoff_at")!).toISOString(),
        auditCutoffAt: new Date(string(row, "audit_cutoff_at")!).toISOString(),
        objectsQueued: integer(row, "objects_queued"),
        accessLogsPruned: integer(row, "access_logs_pruned"),
        objectsHeld: integer(row, "objects_held"),
        accessLogsHeld: integer(row, "access_logs_held"),
        backlog: integer(row, "backlog_count"),
        integrityRecordsPreserved: {
          auditEvents: integer(row, "audit_events_preserved"),
          evidencePackets: integer(row, "evidence_packets_preserved"),
          attestations: integer(row, "attestations_preserved"),
          wormReceipts: integer(row, "worm_receipts_preserved"),
        },
      },
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505" && (await alreadyRecorded())) return;
    throw error;
  }
}

async function refreshedRun(runId: string) {
  const result = await dbClient.execute({
    sql: "SELECT * FROM tokenless_evidence_retention_enforcement_runs WHERE run_id = ? LIMIT 1",
    args: [runId],
  });
  return result.rows[0] as Row;
}

async function completeRun(row: Row, now: Date, itemLimit: number) {
  const runId = string(row, "run_id")!;
  if (!row.pruned_at) {
    const result = await pruneRun(row, now, itemLimit);
    if (result.superseded) return { row: await refreshedRun(runId), superseded: true } as const;
  }
  const pruned = await refreshedRun(runId);
  await recordRunAudit(pruned, now);
  await dbClient.execute({
    sql: `UPDATE tokenless_evidence_retention_enforcement_runs
          SET state = 'completed', lease_expires_at = NULL, last_error = NULL, completed_at = ?, updated_at = ?
          WHERE run_id = ? AND state = 'processing'`,
    args: [now, now, runId],
  });
  return { row: pruned, superseded: false } as const;
}

async function failRun(row: Row, error: unknown, now: Date) {
  const runId = string(row, "run_id")!;
  const attempt = integer(row, "attempt_count");
  const dead = attempt >= MAX_ATTEMPTS;
  const message = error instanceof Error ? error.message.slice(0, 500) : "Retention enforcement failed";
  await dbClient.execute({
    sql: `UPDATE tokenless_evidence_retention_enforcement_runs
          SET state = ?, lease_expires_at = NULL, next_attempt_at = ?, last_error = ?, dead_at = ?, updated_at = ?
          WHERE run_id = ? AND state = 'processing'`,
    args: [dead ? "dead" : "retry", retryAt(now, attempt), message, dead ? now : null, now, runId],
  });
  return dead;
}

function emptySummary(): EvidenceRetentionEnforcementSummary {
  return {
    seeded: 0,
    due: 0,
    completed: 0,
    superseded: 0,
    retry: 0,
    dead: 0,
    objectsQueued: 0,
    accessLogsPruned: 0,
    objectsHeld: 0,
    accessLogsHeld: 0,
    backlog: 0,
    integrityRecordsPreserved: { auditEvents: 0, evidencePackets: 0, attestations: 0, wormReceipts: 0 },
    retryRunIds: [],
  };
}

function addRun(summary: EvidenceRetentionEnforcementSummary, row: Row) {
  summary.objectsQueued += integer(row, "objects_queued");
  summary.accessLogsPruned += integer(row, "access_logs_pruned");
  summary.objectsHeld += integer(row, "objects_held");
  summary.accessLogsHeld += integer(row, "access_logs_held");
  summary.backlog += integer(row, "backlog_count");
  summary.integrityRecordsPreserved.auditEvents += integer(row, "audit_events_preserved");
  summary.integrityRecordsPreserved.evidencePackets += integer(row, "evidence_packets_preserved");
  summary.integrityRecordsPreserved.attestations += integer(row, "attestations_preserved");
  summary.integrityRecordsPreserved.wormReceipts += integer(row, "worm_receipts_preserved");
}

export async function processDueEvidenceRetentionEnforcement(
  input: {
    now?: Date;
    limit?: number;
    itemLimit?: number;
  } = {},
): Promise<EvidenceRetentionEnforcementSummary> {
  const now = input.now ?? new Date();
  const limit = bounded(input.limit, DEFAULT_RUN_LIMIT, 100);
  const itemLimit = bounded(input.itemLimit, DEFAULT_ITEM_LIMIT, 500);
  const summary = emptySummary();
  summary.seeded = await seedRetentionRuns(now);
  const due = await claimDueRuns(now, limit);
  summary.dead += due.exhausted;
  summary.due = due.claimed.length;
  for (const row of due.claimed) {
    try {
      const completed = await completeRun(row, now, itemLimit);
      summary.completed += 1;
      if (completed.superseded) summary.superseded += 1;
      addRun(summary, completed.row);
    } catch (error) {
      if (error instanceof RetentionClaimLostError) continue;
      const persisted = await refreshedRun(string(row, "run_id")!);
      addRun(summary, persisted);
      const dead = await failRun(persisted, error, now);
      summary[dead ? "dead" : "retry"] += 1;
      summary.retryRunIds.push(string(row, "run_id")!);
    }
  }
  return summary;
}

export function __setEvidenceRetentionAuditWriterForTests(writer: RetentionAuditWriter | null) {
  auditWriterOverride = writer;
}

export const __evidenceRetentionEnforcementTestUtils = {
  addCalendarMonths,
  async queueArtifactDeletion(objectId: string, now: Date) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const result = await queueArtifactDeletion(client, objectId, now);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
  async recordRunAudit(runId: string, now: Date) {
    await recordRunAudit(await refreshedRun(runId), now);
  },
  retryAt,
  scheduledWorkItemId,
};
