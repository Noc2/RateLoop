import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import {
  __evidenceRetentionEnforcementTestUtils,
  __setEvidenceRetentionAuditWriterForTests,
  processDueEvidenceRetentionEnforcement,
} from "~~/lib/tokenless/evidenceRetentionEnforcement";

const NOW = new Date("2027-08-31T15:30:00.000Z");
const OLD = new Date("2026-07-30T12:00:00.000Z");
const WORKSPACE = "ws_retention_enforcement";
const PROJECT = "project_retention_unheld";
const HELD_PROJECT = "project_retention_held";

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setEvidenceRetentionAuditWriterForTests(null);
});

afterEach(() => {
  __setEvidenceRetentionAuditWriterForTests(null);
  __setDatabaseResourcesForTests(null);
});

async function seedWorkspace() {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspaces (workspace_id, name, status, created_at, updated_at)
          VALUES (?, 'Retention enforcement', 'active', ?, ?)`,
    args: [WORKSPACE, OLD, OLD],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_evidence_retention_policies
          (workspace_id, version, evidence_retention_months, audit_retention_months, basis_json,
           effective_at, created_by, created_at)
          VALUES (?, 1, 12, 12, ?, ?, 'system:test', ?)`,
    args: [
      WORKSPACE,
      JSON.stringify({ floor: "six_calendar_months", reasons: ["workspace_assurance_evidence_policy"] }),
      OLD,
      OLD,
    ],
  });
  for (const projectId of [PROJECT, HELD_PROJECT]) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_projects
            (project_id, workspace_id, name, data_classification, status, retention_days,
             created_by, created_at, updated_at)
            VALUES (?, ?, ?, 'confidential', 'active', 30, 'system:test', ?, ?)`,
      args: [projectId, WORKSPACE, projectId, OLD, OLD],
    });
  }
}

async function seedArtifact(projectId: string, suffix: string) {
  const artifactId = `artifact_${suffix}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_artifacts
          (artifact_id, project_id, role, label, digest, content_type, size_bytes, storage_ref,
           redaction_status, renderer_policy, created_at, updated_at)
          VALUES (?, ?, 'candidate', ?, ?, 'text/plain', 10, ?, 'approved', 'plain_text', ?, ?)`,
    args: [artifactId, projectId, suffix, `sha256:${suffix.padEnd(64, "0")}`, `memory://${suffix}`, OLD, OLD],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_artifact_objects
          (object_id, artifact_id, workspace_id, project_id, storage_provider, storage_ref,
           key_domain, key_version, content_nonce, content_auth_tag, wrapped_data_key, wrap_nonce,
           wrap_auth_tag, status, delete_after, created_at)
          VALUES (?, ?, ?, ?, 'memory', ?, 'workspace', 'v1', 'nonce', 'tag', 'key', 'wrap', 'wrap-tag',
                  'active', ?, ?)`,
    args: [`object_${suffix}`, artifactId, WORKSPACE, projectId, `memory://${suffix}`, OLD, OLD],
  });
}

async function seedAccessLog(projectId: string, suffix: string) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_access_logs
          (log_id, workspace_id, project_id, actor_kind, actor_reference, action, purpose, occurred_at)
          VALUES (?, ?, ?, 'principal', 'rlp_test_subject', 'read', 'assigned_review', ?)`,
    args: [`access_${suffix}`, WORKSPACE, projectId, OLD],
  });
}

test("enforcement uses the effective workspace policy, honors legal holds, and preserves integrity records", async () => {
  await seedWorkspace();
  await seedArtifact(PROJECT, "a".repeat(8));
  await seedArtifact(HELD_PROJECT, "b".repeat(8));
  await seedAccessLog(PROJECT, "free");
  await seedAccessLog(HELD_PROJECT, "held");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_legal_holds
          (hold_id, workspace_id, project_id, scope, reason, status, created_by, created_at, review_at)
          VALUES ('hold_retention_test', ?, ?, 'project', 'active dispute', 'active', 'system:test', ?, ?)`,
    args: [WORKSPACE, HELD_PROJECT, OLD, new Date("2028-01-01T00:00:00.000Z")],
  });
  await appendAuditEvent({
    workspaceId: WORKSPACE,
    actorKind: "system",
    actorReference: "system:test",
    assuranceMethod: "test",
    action: "test.old_event",
    targetKind: "test",
    targetId: "old-event",
    purpose: "test",
    reason: "retention_fixture",
    result: "success",
    occurredAt: OLD,
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_attestation_jobs
          (job_id, workspace_id, artifact_kind, artifact_schema_version, artifact_digest, boundary_at,
           statement_json, state, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES (?, ?, 'decision_packet', 'rateloop.assurance-decision-packet.v3', ?, ?, '{}',
                  'pending', 0, ?, ?, ?)`,
    args: [`aat_${"1".repeat(40)}`, WORKSPACE, `sha256:${"2".repeat(64)}`, OLD, OLD, OLD, OLD],
  });

  const summary = await processDueEvidenceRetentionEnforcement({ now: NOW, limit: 10, itemLimit: 10 });

  assert.equal(summary.seeded, 1);
  if (summary.retry > 0) {
    const failed = await dbClient.execute("SELECT last_error FROM tokenless_evidence_retention_enforcement_runs");
    assert.fail(String(failed.rows[0]?.last_error));
  }
  assert.equal(summary.completed, 1);
  assert.equal(summary.retry, 0);
  assert.equal(summary.objectsQueued, 1);
  assert.equal(summary.accessLogsPruned, 1);
  assert.equal(summary.objectsHeld, 1);
  assert.equal(summary.accessLogsHeld, 1);
  assert.deepEqual(summary.integrityRecordsPreserved, {
    auditEvents: 1,
    evidencePackets: 0,
    attestations: 1,
    wormReceipts: 0,
  });
  const work = await dbClient.execute(
    "SELECT subject_key, state FROM tokenless_scheduled_work_items WHERE kind = 'delete_artifact'",
  );
  assert.deepEqual(work.rows, [{ state: "pending", subject_key: `object_${"a".repeat(8)}` }]);
  const logs = await dbClient.execute({
    sql: "SELECT log_id FROM tokenless_assurance_access_logs WHERE workspace_id = ? ORDER BY log_id",
    args: [WORKSPACE],
  });
  assert.deepEqual(logs.rows, [{ log_id: "access_held" }]);
  const audit = await dbClient.execute({
    sql: `SELECT action, metadata_json FROM tokenless_audit_events
          WHERE workspace_id = ? AND action = 'evidence.retention.enforced'`,
    args: [WORKSPACE],
  });
  assert.equal(audit.rows.length, 1);
  assert.equal(JSON.parse(String(audit.rows[0]?.metadata_json)).policyVersion, 1);
});

test("a fully held due corpus still produces hold-exception evidence without pruning", async () => {
  await seedWorkspace();
  await seedArtifact(HELD_PROJECT, "e".repeat(8));
  await seedAccessLog(HELD_PROJECT, "only-held");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_legal_holds
          (hold_id, workspace_id, project_id, scope, reason, status, created_by, created_at, review_at)
          VALUES ('hold_only_retention_test', ?, ?, 'project', 'active dispute', 'active', 'system:test', ?, ?)`,
    args: [WORKSPACE, HELD_PROJECT, OLD, new Date("2028-01-01T00:00:00.000Z")],
  });

  const summary = await processDueEvidenceRetentionEnforcement({ now: NOW, limit: 10, itemLimit: 10 });

  assert.equal(summary.seeded, 1);
  assert.equal(summary.completed, 1);
  assert.equal(summary.objectsQueued, 0);
  assert.equal(summary.accessLogsPruned, 0);
  assert.equal(summary.objectsHeld, 1);
  assert.equal(summary.accessLogsHeld, 1);
  assert.equal(
    Number((await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_scheduled_work_items")).rows[0]?.count),
    0,
  );
  assert.equal(
    Number((await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_access_logs")).rows[0]?.count),
    1,
  );
  const audit = await dbClient.execute({
    sql: `SELECT metadata_json FROM tokenless_audit_events
          WHERE workspace_id = ? AND action = 'evidence.retention.enforced'`,
    args: [WORKSPACE],
  });
  assert.equal(audit.rows.length, 1);
  assert.equal(JSON.parse(String(audit.rows[0]?.metadata_json)).objectsHeld, 1);
  assert.equal(JSON.parse(String(audit.rows[0]?.metadata_json)).accessLogsHeld, 1);
});

test("an audit-write failure retries from the durable pruned checkpoint without deleting twice", async () => {
  await seedWorkspace();
  await seedAccessLog(PROJECT, "retry");
  __setEvidenceRetentionAuditWriterForTests(async () => {
    throw new Error("audit sink unavailable");
  });

  const first = await processDueEvidenceRetentionEnforcement({ now: NOW, limit: 10, itemLimit: 10 });
  assert.equal(first.retry, 1);
  assert.equal(first.accessLogsPruned, 1);
  const checkpoint = await dbClient.execute(
    "SELECT state, attempt_count, pruned_at, access_logs_pruned FROM tokenless_evidence_retention_enforcement_runs",
  );
  assert.equal(checkpoint.rows[0]?.state, "retry");
  assert.equal(Number(checkpoint.rows[0]?.attempt_count), 1);
  assert.ok(checkpoint.rows[0]?.pruned_at);
  assert.equal(Number(checkpoint.rows[0]?.access_logs_pruned), 1);

  __setEvidenceRetentionAuditWriterForTests(null);
  const second = await processDueEvidenceRetentionEnforcement({
    now: new Date(NOW.getTime() + 31_000),
    limit: 10,
    itemLimit: 10,
  });
  assert.equal(second.completed, 1);
  assert.equal(second.accessLogsPruned, 1);
  assert.equal(
    Number((await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_access_logs")).rows[0]?.count),
    0,
  );
  const completed = await dbClient.execute(
    "SELECT state, attempt_count, access_logs_pruned FROM tokenless_evidence_retention_enforcement_runs",
  );
  assert.deepEqual(completed.rows[0], { access_logs_pruned: 1, attempt_count: 2, state: "completed" });
});

test("an exhausted stale lease moves to the dead-letter state instead of remaining unclaimable", async () => {
  await seedWorkspace();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_evidence_retention_enforcement_runs
          (run_id, idempotency_key, workspace_id, policy_version, evidence_retention_months,
           audit_retention_months, evidence_cutoff_at, audit_cutoff_at, state, attempt_count,
           next_attempt_at, lease_expires_at, created_at, updated_at)
          VALUES (?, ?, ?, 1, 12, 12, ?, ?, 'processing', 8, ?, ?, ?, ?)`,
    args: [
      `eer_${"3".repeat(40)}`,
      `retention:${"4".repeat(64)}`,
      WORKSPACE,
      OLD,
      OLD,
      OLD,
      new Date(NOW.getTime() - 1),
      OLD,
      OLD,
    ],
  });

  const summary = await processDueEvidenceRetentionEnforcement({ now: NOW, limit: 10, itemLimit: 10 });
  assert.equal(summary.due, 0);
  assert.equal(summary.dead, 1);
  const run = await dbClient.execute(
    "SELECT state, attempt_count, lease_expires_at, dead_at FROM tokenless_evidence_retention_enforcement_runs",
  );
  assert.equal(run.rows[0]?.state, "dead");
  assert.equal(Number(run.rows[0]?.attempt_count), 8);
  assert.equal(run.rows[0]?.lease_expires_at, null);
  assert.ok(run.rows[0]?.dead_at);
});

test("a pruned dead letter retries only its audit and clears degraded health after recovery", async () => {
  await seedWorkspace();
  const runId = `eer_${"9".repeat(40)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_evidence_retention_enforcement_runs
          (run_id, idempotency_key, workspace_id, policy_version, evidence_retention_months,
           audit_retention_months, evidence_cutoff_at, audit_cutoff_at, state, attempt_count,
           next_attempt_at, access_logs_pruned, pruned_at, dead_at, created_at, updated_at)
          VALUES (?, ?, ?, 1, 12, 12, ?, ?, 'dead', 8, ?, 3, ?, ?, ?, ?)`,
    args: [runId, `retention:${"a".repeat(64)}`, WORKSPACE, OLD, OLD, OLD, NOW, NOW, OLD, NOW],
  });

  const summary = await processDueEvidenceRetentionEnforcement({ now: NOW, limit: 10, itemLimit: 10 });

  assert.equal(summary.completed, 1);
  assert.equal(summary.dead, 0);
  assert.equal(summary.accessLogsPruned, 3);
  const run = await dbClient.execute({
    sql: "SELECT state, attempt_count, access_logs_pruned, dead_at, completed_at FROM tokenless_evidence_retention_enforcement_runs WHERE run_id = ?",
    args: [runId],
  });
  assert.deepEqual(run.rows[0], {
    access_logs_pruned: 3,
    attempt_count: 8,
    completed_at: NOW,
    dead_at: null,
    state: "completed",
  });
  const audit = await dbClient.execute({
    sql: `SELECT event_id FROM tokenless_audit_events
          WHERE workspace_id = ? AND action = 'evidence.retention.enforced' AND target_id = ?`,
    args: [WORKSPACE, runId],
  });
  assert.equal(audit.rows.length, 1);
});

test("an unresolved pruned dead letter remains visible to every health pass", async () => {
  await seedWorkspace();
  const runId = `eer_${"b".repeat(40)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_evidence_retention_enforcement_runs
          (run_id, idempotency_key, workspace_id, policy_version, evidence_retention_months,
           audit_retention_months, evidence_cutoff_at, audit_cutoff_at, state, attempt_count,
           next_attempt_at, pruned_at, dead_at, created_at, updated_at)
          VALUES (?, ?, ?, 1, 12, 12, ?, ?, 'dead', 8, ?, ?, ?, ?, ?)`,
    args: [runId, `retention:${"c".repeat(64)}`, WORKSPACE, OLD, OLD, OLD, NOW, NOW, OLD, NOW],
  });
  __setEvidenceRetentionAuditWriterForTests(async () => {
    throw new Error("audit sink remains unavailable");
  });

  const first = await processDueEvidenceRetentionEnforcement({ now: NOW, limit: 10, itemLimit: 10 });
  const second = await processDueEvidenceRetentionEnforcement({
    now: new Date(NOW.getTime() + 300_000),
    limit: 10,
    itemLimit: 10,
  });

  assert.equal(first.dead, 1);
  assert.equal(second.dead, 1);
  assert.equal(first.completed, 0);
  assert.equal(second.completed, 0);
  const run = await dbClient.execute({
    sql: "SELECT state, attempt_count, pruned_at, dead_at FROM tokenless_evidence_retention_enforcement_runs WHERE run_id = ?",
    args: [runId],
  });
  assert.equal(run.rows[0]?.state, "dead");
  assert.equal(Number(run.rows[0]?.attempt_count), 8);
  assert.ok(run.rows[0]?.pruned_at);
  assert.ok(run.rows[0]?.dead_at);
});

test("a stale claim cannot audit, complete, or fail a successor claim", async () => {
  await seedWorkspace();
  const runId = `eer_${"d".repeat(40)}`;
  const oldLease = new Date(NOW.getTime() + 60_000);
  const successorLease = new Date(NOW.getTime() + 600_000);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_evidence_retention_enforcement_runs
          (run_id, idempotency_key, workspace_id, policy_version, evidence_retention_months,
           audit_retention_months, evidence_cutoff_at, audit_cutoff_at, state, attempt_count,
           next_attempt_at, lease_expires_at, pruned_at, created_at, updated_at)
          VALUES (?, ?, ?, 1, 12, 12, ?, ?, 'processing', 2, ?, ?, ?, ?, ?)`,
    args: [runId, `retention:${"e".repeat(64)}`, WORKSPACE, OLD, OLD, OLD, successorLease, NOW, OLD, NOW],
  });

  await assert.rejects(
    () =>
      __evidenceRetentionEnforcementTestUtils.finalizeClaim({
        attemptCount: 1,
        leaseExpiresAt: oldLease,
        now: NOW,
        runId,
      }),
    /claim was replaced before audit/,
  );
  assert.equal(
    await __evidenceRetentionEnforcementTestUtils.failClaim({
      attemptCount: 1,
      leaseExpiresAt: oldLease,
      now: NOW,
      runId,
    }),
    "lost",
  );
  const run = await dbClient.execute({
    sql: "SELECT state, attempt_count, lease_expires_at, last_error FROM tokenless_evidence_retention_enforcement_runs WHERE run_id = ?",
    args: [runId],
  });
  assert.deepEqual(run.rows[0], {
    attempt_count: 2,
    last_error: null,
    lease_expires_at: successorLease,
    state: "processing",
  });
  const audit = await dbClient.execute({
    sql: `SELECT event_id FROM tokenless_audit_events
          WHERE workspace_id = ? AND action = 'evidence.retention.enforced' AND target_id = ?`,
    args: [WORKSPACE, runId],
  });
  assert.equal(audit.rows.length, 0);
});

test("a queued run never prunes after its policy version is superseded", async () => {
  await seedWorkspace();
  await seedAccessLog(PROJECT, "superseded");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_evidence_retention_enforcement_runs
          (run_id, idempotency_key, workspace_id, policy_version, evidence_retention_months,
           audit_retention_months, evidence_cutoff_at, audit_cutoff_at, state, attempt_count,
           next_attempt_at, created_at, updated_at)
          VALUES (?, ?, ?, 1, 12, 12, ?, ?, 'pending', 0, ?, ?, ?)`,
    args: [`eer_${"5".repeat(40)}`, `retention:${"6".repeat(64)}`, WORKSPACE, OLD, OLD, OLD, OLD, OLD],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_evidence_retention_policies SET superseded_at = ?
          WHERE workspace_id = ? AND version = 1`,
    args: [NOW, WORKSPACE],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_evidence_retention_policies
          (workspace_id, version, evidence_retention_months, audit_retention_months, basis_json,
           effective_at, created_by, created_at)
          VALUES (?, 2, 24, 24, ?, ?, 'system:test', ?)`,
    args: [
      WORKSPACE,
      JSON.stringify({ floor: "six_calendar_months", reasons: ["workspace_assurance_evidence_policy"] }),
      NOW,
      NOW,
    ],
  });

  const summary = await processDueEvidenceRetentionEnforcement({ now: NOW, limit: 10, itemLimit: 10 });
  assert.equal(summary.completed, 1);
  assert.equal(summary.superseded, 1);
  assert.equal(summary.accessLogsPruned, 0);
  assert.equal(
    Number((await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_access_logs")).rows[0]?.count),
    1,
  );
  const run = await dbClient.execute(
    "SELECT state, pruned_at, completed_at, last_error FROM tokenless_evidence_retention_enforcement_runs",
  );
  assert.equal(run.rows[0]?.state, "completed");
  assert.ok(run.rows[0]?.pruned_at);
  assert.ok(run.rows[0]?.completed_at);
  assert.match(String(run.rows[0]?.last_error), /superseded/);
});

test("completed artifact work is recovered while dead artifact work remains visible as backlog", async () => {
  await seedWorkspace();
  await seedArtifact(PROJECT, "c".repeat(8));
  await seedArtifact(PROJECT, "d".repeat(8));
  const completedObject = `object_${"c".repeat(8)}`;
  const deadObject = `object_${"d".repeat(8)}`;
  for (const [objectId, state] of [
    [completedObject, "completed"],
    [deadObject, "dead"],
  ] as const) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_scheduled_work_items
            (item_id, kind, subject_key, state, attempt_count, next_attempt_at, completed_at, dead_at,
             created_at, updated_at)
            VALUES (?, 'delete_artifact', ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        __evidenceRetentionEnforcementTestUtils.scheduledWorkItemId(objectId),
        objectId,
        state,
        state === "dead" ? 20 : 1,
        OLD,
        state === "completed" ? OLD : null,
        state === "dead" ? OLD : null,
        OLD,
        OLD,
      ],
    });
  }

  const summary = await processDueEvidenceRetentionEnforcement({ now: NOW, limit: 10, itemLimit: 10 });
  assert.equal(summary.completed, 1);
  assert.equal(summary.objectsQueued, 1);
  assert.equal(summary.backlog, 1);
  const work = await dbClient.execute(
    "SELECT subject_key, state, attempt_count, completed_at, dead_at FROM tokenless_scheduled_work_items ORDER BY subject_key",
  );
  assert.equal(work.rows[0]?.subject_key, completedObject);
  assert.equal(work.rows[0]?.state, "pending");
  assert.equal(Number(work.rows[0]?.attempt_count), 0);
  assert.equal(work.rows[0]?.completed_at, null);
  assert.equal(work.rows[0]?.dead_at, null);
  assert.equal(work.rows[1]?.subject_key, deadObject);
  assert.equal(work.rows[1]?.state, "dead");
});

test("retention run audit recording remains exactly-once when workers race", async () => {
  await seedWorkspace();
  const runId = `eer_${"7".repeat(40)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_evidence_retention_enforcement_runs
          (run_id, idempotency_key, workspace_id, policy_version, evidence_retention_months,
           audit_retention_months, evidence_cutoff_at, audit_cutoff_at, state, attempt_count,
           next_attempt_at, pruned_at, completed_at, created_at, updated_at)
          VALUES (?, ?, ?, 1, 12, 12, ?, ?, 'completed', 1, ?, ?, ?, ?, ?)`,
    args: [runId, `retention:${"8".repeat(64)}`, WORKSPACE, OLD, OLD, NOW, NOW, NOW, OLD, NOW],
  });

  await Promise.all([
    __evidenceRetentionEnforcementTestUtils.recordRunAudit(runId, NOW),
    __evidenceRetentionEnforcementTestUtils.recordRunAudit(runId, NOW),
  ]);
  const audit = await dbClient.execute({
    sql: `SELECT event_id FROM tokenless_audit_events
          WHERE workspace_id = ? AND action = 'evidence.retention.enforced' AND target_id = ?`,
    args: [WORKSPACE, runId],
  });
  assert.equal(audit.rows.length, 1);
});

test("concurrent artifact enqueue conflicts keep both transactions usable and one work item", async () => {
  const objectId = "object_concurrent_retention_enqueue";
  const outcomes = await Promise.all([
    __evidenceRetentionEnforcementTestUtils.queueArtifactDeletion(objectId, NOW),
    __evidenceRetentionEnforcementTestUtils.queueArtifactDeletion(objectId, NOW),
  ]);
  assert.equal(
    outcomes.reduce((total, outcome) => total + outcome.backlog, 0),
    0,
  );
  const work = await dbClient.execute({
    sql: `SELECT state, attempt_count FROM tokenless_scheduled_work_items
          WHERE kind = 'delete_artifact' AND subject_key = ?`,
    args: [objectId],
  });
  assert.deepEqual(work.rows, [{ attempt_count: 0, state: "pending" }]);
});
