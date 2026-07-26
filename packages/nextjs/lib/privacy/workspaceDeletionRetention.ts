import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import { recordPrivacyWorkerFailure, resolvePrivacyWorkerFailure } from "~~/lib/privacy/privacyWorkerFailures";

const HOLD_RECHECK_MS = 30 * 86_400_000;
const POST_HOLD_AUDIT_RETENTION_MS = 365 * 86_400_000;
const EXPIRABLE_CATEGORIES = new Set(["billing_records", "referenced_private_quote_commitments", "settlement_audit"]);

type Row = Record<string, unknown>;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function boundedLimit(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Retention expiry limit is invalid.");
  return Math.min(value, 100);
}

async function anonymizeBilling(client: PoolClient, input: { jobId: string; workspaceId: string; now: Date }) {
  const billingSubject = `deleted-billing:${digest(`${input.jobId}:billing`).slice(0, 48)}`;
  await client.query(
    `UPDATE tokenless_payment_intents
     SET payer_address=$1,payload_json=$2,updated_at=$3 WHERE workspace_id=$4`,
    [billingSubject, "{}", input.now, input.workspaceId],
  );
  await client.query(`UPDATE tokenless_prepaid_ledger_entries SET external_reference=NULL WHERE workspace_id=$1`, [
    input.workspaceId,
  ]);
  await client.query(
    `UPDATE tokenless_workspace_billing_customers
     SET provider_customer_id=$1,updated_at=$2 WHERE workspace_id=$3`,
    [billingSubject, input.now, input.workspaceId],
  );
  await client.query(
    `UPDATE tokenless_workspace_subscriptions
     SET provider_subscription_id=NULL,provider_price_id=NULL,provider_event_id=NULL,
         updated_at=$1 WHERE workspace_id=$2`,
    [input.now, input.workspaceId],
  );
  await client.query(
    `UPDATE tokenless_workspace_fund_resolution_requests
     SET requested_by='system:retention_expiry',
         resolved_by=CASE WHEN resolved_by IS NULL THEN NULL ELSE 'system:retention_expiry' END,
         resolution_reference=CASE WHEN resolution_reference IS NULL THEN NULL ELSE $1 END,
         updated_at=$2
     WHERE workspace_id=$3`,
    [`retention-expired:${digest(`${input.jobId}:fund-resolution`)}`, input.now, input.workspaceId],
  );
}

async function anonymizeExpiredNetworkEvidence(
  client: PoolClient,
  input: { jobId: string; workspaceId: string; now: Date },
) {
  const assignments = await client.query(
    `SELECT assignment.assignment_id,assignment.project_id,assignment.cohort_id,
            assignment.status,assignment.assurance_snapshot_hash,
            assignment.integrity_provenance_hash
     FROM tokenless_assurance_assignments assignment
     WHERE assignment.workspace_id=$1 AND assignment.source='rateloop_network'
     ORDER BY assignment.assignment_id FOR UPDATE`,
    [input.workspaceId],
  );
  if (
    (assignments.rows as Row[]).some(value => {
      const status = text(value, "status");
      return status === "reserved" || status === "accepted";
    })
  ) {
    throw new Error("Network assignments still carry an active reviewer claim at retention expiry.");
  }
  const unsettledClaims = await client.query(
    `SELECT COUNT(*) AS count
     FROM tokenless_paid_vouchers voucher
     JOIN tokenless_assurance_assignments assignment
       ON assignment.assignment_id=voucher.network_assignment_id
     LEFT JOIN tokenless_network_assignment_settlements settlement
       ON settlement.voucher_id=voucher.voucher_id
     WHERE assignment.workspace_id=$1
       AND (
         (settlement.binding_id IS NULL AND voucher.expires_at>$2)
         OR (settlement.binding_id IS NOT NULL AND settlement.state<>'terminal')
       )`,
    [input.workspaceId, input.now],
  );
  if (Number((unsettledClaims.rows[0] as Row | undefined)?.count ?? 0) !== 0) {
    throw new Error("Network voucher claims remain payable or unsettled at retention expiry.");
  }

  let assignmentsAnonymized = 0;
  let historyAnonymized = 0;
  let voucherRaterLinksRebound = 0;
  let voucherSnapshotsAnonymized = 0;
  for (const value of assignments.rows as Row[]) {
    const assignmentId = text(value, "assignment_id")!;
    const assignmentSubjectDigest = digest(
      `rateloop-workspace-deletion-v1:${input.jobId}:network_assignment_subject:${assignmentId}`,
    );
    const assignmentTombstone = `rlp_erased_assignment_${digest(
      `rateloop-workspace-deletion-v1:${input.jobId}:assurance_assignment:${assignmentId}`,
    ).slice(0, 24)}`;
    const tombstoneRaterId = `rater_erased_ws_${assignmentSubjectDigest.slice(0, 32)}`;
    const tombstonePayout = `0x${assignmentSubjectDigest.slice(0, 40)}`;
    await client.query(
      `INSERT INTO tokenless_rater_profiles
       (rater_id,principal_id,account_address,nullifier_seed_ciphertext,
        nullifier_key_version,nullifier_key_domain,deletion_receipt_hash,deleted_at,
        created_at,updated_at)
       VALUES ($1,NULL,$2,$3,'deleted-receipt-v1','vote_mapping',$4,$5,$5,$5)
       ON CONFLICT (rater_id) DO NOTHING`,
      [
        tombstoneRaterId,
        tombstonePayout,
        `deleted:${assignmentSubjectDigest}`,
        `sha256:${assignmentSubjectDigest}`,
        input.now,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_assurance_cohort_reviewers
       (project_id,cohort_id,reviewer_account_address,qualification_provenance_json,
        qualification_expires_at,maximum_active_assignments,active_reservations,status,
        network_managed,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,'{"subject":"deleted"}',$4,1,0,'removed',
               true,'system:retention_expiry',$4,$4)
       ON CONFLICT (project_id,cohort_id,reviewer_account_address) DO NOTHING`,
      [value.project_id, value.cohort_id, assignmentTombstone, input.now],
    );
    const assuranceSnapshot = JSON.stringify({
      schemaVersion: "rateloop.erased-assurance-snapshot.v1",
      snapshotCommitment: text(value, "assurance_snapshot_hash"),
    });
    const integrityProvenance =
      text(value, "integrity_provenance_hash") === null
        ? null
        : JSON.stringify({
            schemaVersion: "rateloop.erased-integrity-provenance.v1",
            provenanceCommitment: text(value, "integrity_provenance_hash"),
          });
    const assignment = await client.query(
      `UPDATE tokenless_assurance_assignments
       SET reviewer_account_address=$1,rater_id=$2,
           payout_account_snapshot=CASE WHEN paid_assignment=true THEN $3 ELSE NULL END,
           qualification_provenance_json='[]',assurance_snapshot_json=$4,
           blinding_json='{"subject":"deleted"}',integrity_reviewer_lookup=NULL,
           integrity_cluster_pseudonym=NULL,integrity_risk_band=NULL,
           provider_subject_hashes_json=CASE
             WHEN provider_subject_hashes_json IS NULL THEN NULL ELSE '[]' END,
           integrity_provenance_json=$5,updated_at=$6
       WHERE assignment_id=$7 AND source='rateloop_network'`,
      [
        assignmentTombstone,
        tombstoneRaterId,
        tombstonePayout,
        assuranceSnapshot,
        integrityProvenance,
        input.now,
        assignmentId,
      ],
    );
    assignmentsAnonymized += assignment.rowCount ?? 0;
    const history = await client.query(
      `UPDATE tokenless_integrity_assignment_history
       SET reviewer_lookup=$1,cluster_pseudonym=$2,provider_subject_hashes_json='[]'
       WHERE assignment_id=$3`,
      [
        `deleted-reviewer:${assignmentSubjectDigest.slice(0, 48)}`,
        `deleted-cluster:${digest(
          `rateloop-workspace-deletion-v1:${input.jobId}:network_assignment_cluster:${assignmentId}`,
        ).slice(0, 48)}`,
        assignmentId,
      ],
    );
    historyAnonymized += history.rowCount ?? 0;
    const vouchers = await client.query(
      `SELECT voucher_id,rater_id,payout_account_snapshot
       FROM tokenless_paid_vouchers WHERE network_assignment_id=$1
       ORDER BY voucher_id FOR UPDATE`,
      [assignmentId],
    );
    for (const voucherValue of vouchers.rows as Row[]) {
      const voucherId = text(voucherValue, "voucher_id")!;
      if (
        text(voucherValue, "rater_id") !== tombstoneRaterId ||
        text(voucherValue, "payout_account_snapshot") !== tombstonePayout
      ) {
        const voucher = await client.query(
          `UPDATE tokenless_paid_vouchers
           SET rater_id=$1,payout_account_snapshot=$2 WHERE voucher_id=$3`,
          [tombstoneRaterId, tombstonePayout, voucherId],
        );
        voucherRaterLinksRebound += voucher.rowCount ?? 0;
      }
      const snapshots = await client.query(
        `SELECT voucher_id,rater_id,snapshot_json,snapshot_hash
         FROM tokenless_voucher_assurance_snapshots WHERE voucher_id=$1 FOR UPDATE`,
        [voucherId],
      );
      for (const snapshotValue of snapshots.rows as Row[]) {
        const snapshotJson = JSON.stringify({
          schemaVersion: "rateloop.erased-voucher-assurance-snapshot.v1",
          snapshotCommitment: text(snapshotValue, "snapshot_hash"),
        });
        if (
          text(snapshotValue, "rater_id") !== tombstoneRaterId ||
          text(snapshotValue, "snapshot_json") !== snapshotJson
        ) {
          const snapshot = await client.query(
            `UPDATE tokenless_voucher_assurance_snapshots
             SET rater_id=$1,snapshot_json=$2 WHERE voucher_id=$3`,
            [tombstoneRaterId, snapshotJson, voucherId],
          );
          voucherSnapshotsAnonymized += snapshot.rowCount ?? 0;
        }
      }
    }
  }
  const publicBindings = await client.query(
    "DELETE FROM tokenless_public_network_review_bindings WHERE workspace_id=$1",
    [input.workspaceId],
  );
  const retainedCommitments = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM tokenless_network_assignment_settlements settlement
        JOIN tokenless_assurance_assignments assignment
          ON assignment.assignment_id=settlement.assignment_id
        WHERE assignment.workspace_id=$1) AS settlements,
       (SELECT COUNT(*) FROM tokenless_network_assignment_settlement_receipts receipt
        JOIN tokenless_network_assignment_settlements settlement
          ON settlement.binding_id=receipt.binding_id
        JOIN tokenless_assurance_assignments assignment
          ON assignment.assignment_id=settlement.assignment_id
        WHERE assignment.workspace_id=$1) AS receipts`,
    [input.workspaceId],
  );
  const postconditions = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM tokenless_assurance_assignments assignment
        LEFT JOIN tokenless_rater_profiles profile ON profile.rater_id=assignment.rater_id
        WHERE assignment.workspace_id=$1 AND assignment.source='rateloop_network'
          AND (assignment.reviewer_account_address NOT LIKE 'rlp_erased_assignment_%'
            OR profile.principal_id IS NOT NULL OR profile.deleted_at IS NULL
            OR (assignment.paid_assignment=true
              AND assignment.payout_account_snapshot<>profile.account_address)
            OR assignment.qualification_provenance_json<>'[]'
            OR assignment.assurance_snapshot_json
              NOT LIKE '%rateloop.erased-assurance-snapshot.v1%'
            OR assignment.blinding_json<>'{"subject":"deleted"}'
            OR assignment.integrity_reviewer_lookup IS NOT NULL
            OR assignment.integrity_cluster_pseudonym IS NOT NULL
            OR assignment.integrity_risk_band IS NOT NULL
            OR COALESCE(assignment.provider_subject_hashes_json,'[]')<>'[]'
            OR (assignment.integrity_provenance_hash IS NOT NULL
              AND COALESCE(assignment.integrity_provenance_json,'')
                NOT LIKE '%rateloop.erased-integrity-provenance.v1%')))
        AS assignment_personal_copies,
       (SELECT COUNT(*) FROM tokenless_integrity_assignment_history history
        JOIN tokenless_assurance_assignments assignment
          ON assignment.assignment_id=history.assignment_id
        WHERE assignment.workspace_id=$1 AND assignment.source='rateloop_network'
          AND (history.reviewer_lookup NOT LIKE 'deleted-reviewer:%'
            OR history.cluster_pseudonym NOT LIKE 'deleted-cluster:%'
            OR history.provider_subject_hashes_json<>'[]'))
        AS history_personal_copies,
       (SELECT COUNT(*) FROM tokenless_paid_vouchers voucher
        JOIN tokenless_assurance_assignments assignment
          ON assignment.assignment_id=voucher.network_assignment_id
        JOIN tokenless_rater_profiles profile ON profile.rater_id=assignment.rater_id
        WHERE assignment.workspace_id=$1
          AND (voucher.rater_id<>assignment.rater_id
            OR voucher.payout_account_snapshot<>profile.account_address))
        AS voucher_assignment_mismatches,
       (SELECT COUNT(*) FROM tokenless_paid_vouchers voucher
        JOIN tokenless_assurance_assignments assignment
          ON assignment.assignment_id=voucher.network_assignment_id
        JOIN tokenless_rater_profiles profile ON profile.rater_id=voucher.rater_id
        WHERE assignment.workspace_id=$1 AND profile.principal_id IS NOT NULL)
        AS voucher_live_rater_links,
       (SELECT COUNT(*) FROM tokenless_voucher_assurance_snapshots snapshot
        JOIN tokenless_paid_vouchers voucher ON voucher.voucher_id=snapshot.voucher_id
        JOIN tokenless_assurance_assignments assignment
          ON assignment.assignment_id=voucher.network_assignment_id
        JOIN tokenless_rater_profiles profile ON profile.rater_id=snapshot.rater_id
        WHERE assignment.workspace_id=$1
          AND (snapshot.rater_id<>assignment.rater_id
            OR profile.principal_id IS NOT NULL
            OR snapshot.snapshot_json
              NOT LIKE '%rateloop.erased-voucher-assurance-snapshot.v1%'))
        AS voucher_snapshot_personal_copies,
       (SELECT COUNT(*) FROM tokenless_public_network_review_bindings
        WHERE workspace_id=$1) AS public_network_bindings`,
    [input.workspaceId],
  );
  const incomplete = Object.entries((postconditions.rows[0] as Row | undefined) ?? {}).find(
    ([, value]) => Number(value) !== 0,
  );
  if (incomplete) throw new Error(`Network retention expiry postcondition failed: ${incomplete[0]}.`);
  const commitmentRow = retainedCommitments.rows[0] as Row | undefined;
  return {
    assignmentsAnonymized,
    historyAnonymized,
    publicBindingsDeleted: publicBindings.rowCount ?? 0,
    settlementCommitmentsRetained: Number(commitmentRow?.settlements ?? 0),
    settlementReceiptCommitmentsRetained: Number(commitmentRow?.receipts ?? 0),
    voucherRaterLinksRebound,
    voucherSnapshotsAnonymized,
  };
}

async function anonymizeSettlementAudit(
  client: PoolClient,
  input: { jobId: string; requestId: string | null; workspaceId: string; now: Date },
) {
  const networkEvidence = await anonymizeExpiredNetworkEvidence(client, input);
  await client.query(
    `DELETE FROM tokenless_artifact_deletion_jobs
     WHERE workspace_id=$1 AND state='completed'`,
    [input.workspaceId],
  );
  const artifactAuditReferences = await client.query(
    `SELECT COUNT(*) AS count FROM tokenless_artifact_deletion_jobs
     WHERE workspace_id=$1 AND audit_event_id IS NOT NULL`,
    [input.workspaceId],
  );
  if (Number((artifactAuditReferences.rows[0] as Row | undefined)?.count ?? 0) !== 0) {
    throw new Error("Artifact deletion audit references remain after retention expiry.");
  }
  await client.query("DELETE FROM tokenless_audit_events WHERE workspace_id=$1", [input.workspaceId]);
  await client.query("DELETE FROM tokenless_audit_heads WHERE workspace_id=$1", [input.workspaceId]);
  await client.query(
    `UPDATE tokenless_agent_integration_events
     SET actor_reference='system:retention_expiry',details_json='{}' WHERE workspace_id=$1`,
    [input.workspaceId],
  );
  await client.query(
    `UPDATE tokenless_agent_connection_intent_events
     SET actor_type='service',actor_reference='system:retention_expiry',details_json='{}'
     WHERE workspace_id=$1`,
    [input.workspaceId],
  );
  await client.query(
    `UPDATE tokenless_private_group_events
     SET principal_address=NULL,actor_reference='system:retention_expiry',details_json='{}'
     WHERE workspace_id=$1`,
    [input.workspaceId],
  );
  await client.query(
    `UPDATE tokenless_enterprise_identity_audit_outbox
     SET actor_reference='system:retention_expiry',target_id='deleted-subject',metadata_json='{}'
     WHERE workspace_id=$1`,
    [input.workspaceId],
  );
  await client.query(
    `UPDATE tokenless_deletion_jobs
     SET requested_by='system:retention_expiry' WHERE job_id=$1`,
    [input.jobId],
  );
  if (input.requestId) {
    await client.query(`UPDATE tokenless_subject_requests SET principal_id=$1 WHERE request_id=$2`, [
      `deleted-workspace-subject:${digest(`${input.jobId}:subject`).slice(0, 40)}`,
      input.requestId,
    ]);
    await client.query(
      `UPDATE tokenless_subject_request_events
       SET actor_reference='system:retention_expiry' WHERE request_id=$1`,
      [input.requestId],
    );
  }
  return networkEvidence;
}

export async function expireWorkspaceDeletionRetentionCategories(now = new Date(), requestedLimit = 25) {
  const limit = boundedLimit(requestedLimit);
  const releasedHoldRows = await dbPool.query(
    `SELECT category.job_id
     FROM tokenless_deletion_job_categories category
     JOIN tokenless_deletion_jobs job ON job.job_id=category.job_id
     LEFT JOIN tokenless_privacy_worker_failures failure
       ON failure.worker_kind='workspace_retention'
      AND failure.work_item_key=category.job_id || ':legal_hold_schedule'
     WHERE job.scope_kind='workspace' AND category.category='legal_hold_records'
       AND category.status='retained' AND category.retention_deadline IS NULL
       AND job.scope_id NOT IN (
         SELECT hold.workspace_id FROM tokenless_legal_holds hold WHERE hold.status='active'
       )
       AND (failure.failure_id IS NULL OR (failure.status='retrying' AND failure.next_retry_at<=$1))
     ORDER BY category.job_id
     LIMIT $2`,
    [now, limit],
  );
  let releasedHoldSchedules = 0;
  for (const value of releasedHoldRows.rows as Row[]) {
    const jobId = text(value, "job_id")!;
    const workItemKey = `${jobId}:legal_hold_schedule`;
    try {
      const released = await dbPool.query(
        `UPDATE tokenless_deletion_job_categories
         SET basis_code='settlement_and_audit',retention_deadline=$1
         WHERE job_id=$2 AND category='legal_hold_records'
           AND status='retained' AND retention_deadline IS NULL`,
        [new Date(now.getTime() + POST_HOLD_AUDIT_RETENTION_MS), jobId],
      );
      await resolvePrivacyWorkerFailure({ now, workerKind: "workspace_retention", workItemKey });
      releasedHoldSchedules += released.rowCount ?? 0;
    } catch (error) {
      await recordPrivacyWorkerFailure({
        error,
        now,
        workerKind: "workspace_retention",
        workItemKey,
      });
    }
  }
  const due = await dbPool.query(
    `SELECT category.job_id,category.category,job.scope_id,job.subject_request_id
     FROM tokenless_deletion_job_categories category
     JOIN tokenless_deletion_jobs job ON job.job_id=category.job_id
     LEFT JOIN tokenless_privacy_worker_failures failure
       ON failure.worker_kind='workspace_retention'
      AND failure.work_item_key=category.job_id || ':' || category.category
     WHERE job.scope_kind='workspace' AND job.status='completed'
       AND category.disposition='retain' AND category.status='retained'
       AND category.retention_deadline IS NOT NULL AND category.retention_deadline<=$1
       AND (failure.failure_id IS NULL OR (failure.status='retrying' AND failure.next_retry_at<=$1))
     ORDER BY category.retention_deadline,category.job_id,category.category LIMIT $2`,
    [now, limit],
  );
  const summary = {
    completed: 0,
    deferredByHold: 0,
    releasedHoldSchedules,
  };
  for (const value of due.rows as Row[]) {
    const jobId = text(value, "job_id")!;
    const category = text(value, "category")!;
    const workspaceId = text(value, "scope_id")!;
    const requestId = text(value, "subject_request_id");
    const workItemKey = `${jobId}:${category}`;
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      if (!EXPIRABLE_CATEGORIES.has(category) && category !== "legal_hold_records") {
        throw new Error(`Workspace retention category ${category} has no expiry handler.`);
      }
      const locked = await client.query(
        `SELECT category.status
         FROM tokenless_deletion_job_categories category
         JOIN tokenless_deletion_jobs job ON job.job_id=category.job_id
         WHERE category.job_id=$1 AND category.category=$2
           AND job.scope_kind='workspace' AND job.scope_id=$3
           AND category.status='retained' AND category.retention_deadline<=$4
         FOR UPDATE`,
        [jobId, category, workspaceId, now],
      );
      if (locked.rowCount !== 1) {
        await client.query("ROLLBACK");
        continue;
      }
      const workspace = await client.query(
        "SELECT workspace_id FROM tokenless_workspaces WHERE workspace_id=$1 FOR UPDATE",
        [workspaceId],
      );
      if (workspace.rowCount !== 1) {
        throw new Error("Retention expiry workspace no longer exists.");
      }
      const hold = await client.query(
        `SELECT hold_id FROM tokenless_legal_holds
         WHERE workspace_id=$1 AND status='active' LIMIT 1 FOR SHARE`,
        [workspaceId],
      );
      if ((hold.rowCount ?? 0) > 0) {
        await client.query(
          `UPDATE tokenless_deletion_job_categories
           SET retention_deadline=$1 WHERE job_id=$2 AND category=$3`,
          [new Date(now.getTime() + HOLD_RECHECK_MS), jobId, category],
        );
        await client.query("COMMIT");
        summary.deferredByHold += 1;
        continue;
      }
      let retentionEvidence: Record<string, unknown> | null = null;
      if (category === "billing_records") {
        await anonymizeBilling(client, { jobId, workspaceId, now });
      } else if (category === "settlement_audit" || category === "legal_hold_records") {
        retentionEvidence = await anonymizeSettlementAudit(client, { jobId, requestId, workspaceId, now });
      } else {
        const ownerLinks = await client.query(
          `SELECT COUNT(*) AS count FROM tokenless_agent_quotes WHERE owner_workspace_id=$1`,
          [workspaceId],
        );
        if (Number((ownerLinks.rows[0] as Row | undefined)?.count ?? 0) !== 0) {
          throw new Error("Referenced private quote ownership was not anonymized before retention expiry.");
        }
      }
      const updated = await client.query(
        `UPDATE tokenless_deletion_job_categories
         SET disposition='anonymize',status='completed',basis_code=NULL,retention_deadline=NULL,
             evidence_digest=$1,completed_at=$2
         WHERE job_id=$3 AND category=$4 AND status='retained'`,
        [
          digest(
            `${jobId}:${category}:retention-expired:${now.toISOString()}:` +
              JSON.stringify(retentionEvidence ?? { category }),
          ),
          now,
          jobId,
          category,
        ],
      );
      if (updated.rowCount !== 1) throw new Error("Retention expiry category transition failed.");
      await client.query(
        `UPDATE tokenless_privacy_worker_failures
         SET status='resolved',next_retry_at=NULL,operator_alert_state='resolved',
             resolved_at=$1,updated_at=$1
         WHERE worker_kind='workspace_retention' AND work_item_key=$2 AND status <> 'resolved'`,
        [now, workItemKey],
      );
      await client.query("COMMIT");
      summary.completed += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      await recordPrivacyWorkerFailure({
        error,
        now,
        workerKind: "workspace_retention",
        workItemKey,
      });
    } finally {
      client.release();
    }
  }
  return summary;
}
