import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const DELETION_DUE_MS = 30 * 86_400_000;
const SECURITY_GUARD_RETENTION_MS = 35 * 86_400_000;
const LEGAL_RECORD_RETENTION_MS = 3_650 * 86_400_000;

type Row = Record<string, unknown>;
type DeletionBlocker = { code: string; message: string };

export type AccountDeletionPreview = {
  blockers: DeletionBlocker[];
  impact: {
    ownedWorkspaces: number;
    sharedWorkspaces: number;
    acceptedAssignments: number;
    managedWallets: number;
    retainedRecords: string[];
  };
  warnings: string[];
};

function rowNumber(row: Row | undefined, key: string) {
  const value = Number(row?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function id(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

async function loadPreview(client: PoolClient, principalId: string, lock = false): Promise<AccountDeletionPreview> {
  const principal = await client.query(
    `SELECT principal_id FROM tokenless_principals
     WHERE principal_id = $1 AND status = 'active'${lock ? " FOR UPDATE" : ""}`,
    [principalId],
  );
  if (principal.rowCount !== 1) {
    throw new TokenlessServiceError("Account not found.", 404, "account_not_found");
  }

  const result = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM tokenless_workspace_members m
        JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
        WHERE m.account_address = $1 AND m.role = 'owner' AND w.status = 'active') AS owned_workspaces,
       (SELECT COUNT(*) FROM tokenless_workspace_members m
        JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
        WHERE m.account_address = $1 AND m.role <> 'owner' AND w.status = 'active') AS shared_workspaces,
       (SELECT COUNT(*) FROM tokenless_assurance_assignments
        WHERE reviewer_account_address = $1 AND status = 'accepted') AS accepted_assignments,
       (SELECT COUNT(*) FROM tokenless_wallet_bindings
        WHERE principal_id = $1 AND wallet_source = 'thirdweb' AND revoked_at IS NULL) AS managed_wallets,
       (SELECT COUNT(*) FROM tokenless_assurance_assignments
        WHERE reviewer_account_address = $1 AND status = 'completed') AS completed_assignments,
       (SELECT COUNT(*) FROM tokenless_paid_vouchers v
        JOIN tokenless_rater_profiles r ON r.rater_id = v.rater_id
        WHERE r.account_address = $1) AS paid_vouchers`,
    [principalId],
  );
  const row = result.rows[0] as Row | undefined;
  const ownedWorkspaces = rowNumber(row, "owned_workspaces");
  const sharedWorkspaces = rowNumber(row, "shared_workspaces");
  const acceptedAssignments = rowNumber(row, "accepted_assignments");
  const managedWallets = rowNumber(row, "managed_wallets");
  const retainedRecords: string[] = [];
  if (rowNumber(row, "completed_assignments") > 0 || rowNumber(row, "paid_vouchers") > 0) {
    retainedRecords.push("Completed paid-work and settlement evidence for the applicable legal retention period");
  }
  retainedRecords.push("Security and deletion receipts without your email address or reusable credentials");
  const blockers: DeletionBlocker[] = [];
  if (ownedWorkspaces > 0) {
    blockers.push({
      code: "owned_workspaces_require_resolution",
      message: "Delete or transfer every workspace you own first.",
    });
  }
  if (acceptedAssignments > 0) {
    blockers.push({
      code: "accepted_assignments_require_completion",
      message: "Complete accepted review work before deleting the account so earned payment is not interrupted.",
    });
  }
  if (managedWallets > 0) {
    blockers.push({
      code: "managed_wallet_recovery_required",
      message: "Recover or disconnect each managed wallet before deleting the account.",
    });
  }
  return {
    blockers,
    impact: { ownedWorkspaces, sharedWorkspaces, acceptedAssignments, managedWallets, retainedRecords },
    warnings: [
      "Signing in again creates a new account and does not restore this account, its access, or its history.",
      "Public blockchain records cannot be erased, but RateLoop removes the off-chain sign-in link.",
    ],
  };
}

export async function getAccountDeletionPreview(principalId: string) {
  const client = await dbPool.connect();
  try {
    return await loadPreview(client, principalId);
  } finally {
    client.release();
  }
}

async function releaseReservedAssignments(client: PoolClient, principalId: string, now: Date) {
  const released = await client.query(
    `UPDATE tokenless_assurance_assignments
     SET status = 'released', lease_state = 'expired', updated_at = $1
     WHERE reviewer_account_address = $2 AND status = 'reserved'
     RETURNING subpanel_id, project_id, cohort_id`,
    [now, principalId],
  );
  for (const value of released.rows) {
    const row = value as Row;
    await client.query(
      `UPDATE tokenless_assurance_run_subpanels SET active_reservations = active_reservations - 1
       WHERE subpanel_id = $1 AND active_reservations > 0`,
      [row.subpanel_id],
    );
    await client.query(
      `UPDATE tokenless_assurance_cohorts SET active_reservations = active_reservations - 1
       WHERE project_id = $1 AND cohort_id = $2 AND active_reservations > 0`,
      [row.project_id, row.cohort_id],
    );
    await client.query(
      `UPDATE tokenless_assurance_cohort_reviewers SET active_reservations = active_reservations - 1
       WHERE project_id = $1 AND cohort_id = $2 AND reviewer_account_address = $3
         AND active_reservations > 0`,
      [row.project_id, row.cohort_id, principalId],
    );
  }
  return released.rowCount ?? 0;
}

async function insertSubjectRequest(
  client: PoolClient,
  input: {
    principalId: string;
    requestId: string;
    now: Date;
  },
) {
  const dueAt = new Date(input.now.getTime() + DELETION_DUE_MS);
  await client.query(
    `INSERT INTO tokenless_subject_requests
     (request_id, principal_id, workspace_id, request_type, status, scope_json, identity_assurance,
      received_at, due_at, completed_at)
     VALUES ($1, $2, NULL, 'deletion', 'completed', '{"account":true}', 'recent_better_auth_session', $3, $4, $3)`,
    [input.requestId, input.principalId, input.now, dueAt],
  );
  const transitions = [
    [null, "received", "request_received"],
    ["received", "identity_verified", "recent_primary_auth_verified"],
    ["identity_verified", "in_progress", "account_erasure_started"],
    ["in_progress", "completed", "category_evidence_recorded"],
  ] as const;
  for (const [fromStatus, toStatus, reason] of transitions) {
    await client.query(
      `INSERT INTO tokenless_subject_request_events
       (event_id, request_id, from_status, to_status, actor_reference, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id("dsre"), input.requestId, fromStatus, toStatus, input.principalId, reason, input.now],
    );
  }
  return dueAt;
}

async function insertDeletionEvidence(
  client: PoolClient,
  input: {
    jobId: string;
    principalId: string;
    requestId: string;
    now: Date;
    dueAt: Date;
    releasedReservations: number;
  },
) {
  const categories = [
    ["account_authentication", "erase", "completed", null, null],
    ["contact_and_preferences", "erase", "completed", null, null],
    ["shared_workspace_access", "erase", "completed", null, null],
    ["eligibility_handoffs", "erase", "completed", null, null],
    [
      "deleted_auth_subject_guard",
      "retain",
      "retained",
      "account_resurrection_prevention",
      new Date(input.now.getTime() + SECURITY_GUARD_RETENTION_MS),
    ],
    [
      "settlement_legal_security",
      "retain",
      "retained",
      "legal_settlement_security",
      new Date(input.now.getTime() + LEGAL_RECORD_RETENTION_MS),
    ],
    ["public_chain", "public_chain", "retained", "externally_immutable", null],
  ] as const;
  const receiptDigest = digest(`account:${input.jobId}:${input.requestId}:${input.now.toISOString()}`);
  await client.query(
    `INSERT INTO tokenless_deletion_jobs
     (job_id, scope_kind, scope_id, subject_request_id, requested_by, status, due_at, requested_at,
      started_at, completed_at, receipt_digest)
     VALUES ($1, 'account', $2, $3, $2, 'completed', $4, $5, $5, $5, $6)`,
    [input.jobId, input.principalId, input.requestId, input.dueAt, input.now, receiptDigest],
  );
  for (const [category, disposition, status, basisCode, retentionDeadline] of categories) {
    await client.query(
      `INSERT INTO tokenless_deletion_job_categories
       (job_id, category, disposition, status, basis_code, retention_deadline, evidence_digest,
        created_at, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8)`,
      [
        input.jobId,
        category,
        disposition,
        status,
        basisCode,
        retentionDeadline,
        digest(`${input.jobId}:${category}:${status}`),
        input.now,
      ],
    );
  }
  await client.query(
    `INSERT INTO tokenless_subject_request_completions
     (completion_id, request_id, deleted_categories_json, anonymized_categories_json,
      retained_categories_json, pending_backup_expiry_json, public_chain_exceptions_json,
      evidence_json, completed_by, completed_at)
     VALUES ($1, $2, $3, '[]', $4, $5, $6, $7, 'system:account_deletion', $8)`,
    [
      id("dsrc"),
      input.requestId,
      JSON.stringify([
        "account_authentication",
        "contact_and_preferences",
        "shared_workspace_access",
        "eligibility_handoffs",
      ]),
      JSON.stringify([
        { category: "deleted_auth_subject_guard", basis: "account_resurrection_prevention" },
        { category: "settlement_legal_security", basis: "legal_settlement_security" },
      ]),
      JSON.stringify([
        {
          category: "deleted_auth_subject_guard",
          expiresAt: new Date(input.now.getTime() + SECURITY_GUARD_RETENTION_MS).toISOString(),
        },
      ]),
      JSON.stringify(["public_chain"]),
      JSON.stringify({ jobId: input.jobId, releasedReservations: input.releasedReservations, receiptDigest }),
      input.now,
    ],
  );
  return receiptDigest;
}

export async function deleteAccount(input: {
  betterAuthUserId: string;
  confirmation: string;
  principalId: string;
  now?: Date;
}) {
  if (input.confirmation !== "DELETE") {
    throw new TokenlessServiceError("Type DELETE to confirm account deletion.", 400, "account_deletion_unconfirmed");
  }
  const now = input.now ?? new Date();
  const requestId = id("dsr");
  const jobId = id("del");
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const preview = await loadPreview(client, input.principalId, true);
    if (preview.blockers.length > 0) {
      throw new TokenlessServiceError(preview.blockers[0].message, 409, preview.blockers[0].code);
    }
    const binding = await client.query(
      `SELECT b.binding_id, u.email
       FROM tokenless_identity_bindings b
       JOIN tokenless_better_auth_users u ON u.id = b.provider_subject
       WHERE b.principal_id = $1 AND b.provider = 'better_auth' AND b.provider_subject = $2
         AND b.status = 'active' FOR UPDATE`,
      [input.principalId, input.betterAuthUserId],
    );
    if (binding.rowCount !== 1) {
      throw new TokenlessServiceError(
        "Sign in again before deleting this account.",
        401,
        "recent_authentication_required",
      );
    }
    const email = String(binding.rows[0]?.email ?? "")
      .trim()
      .toLowerCase();
    const releasedReservations = await releaseReservedAssignments(client, input.principalId, now);

    await client.query(
      `UPDATE tokenless_principals
       SET status = 'deleted', updated_at = $1, disabled_at = COALESCE(disabled_at, $1)
       WHERE principal_id = $2 AND status = 'active'`,
      [now, input.principalId],
    );
    await client.query(
      `UPDATE tokenless_identity_bindings
       SET status = 'revoked', revoked_at = $1, last_used_at = $1
       WHERE principal_id = $2 AND status = 'active'`,
      [now, input.principalId],
    );
    await client.query(
      `UPDATE tokenless_auth_sessions SET revoked_at = $1
       WHERE principal_id = $2 AND revoked_at IS NULL`,
      [now, input.principalId],
    );
    await client.query(
      `UPDATE tokenless_agent_oauth_access_tokens SET revoked_at = $1, revocation_reason = 'account_deleted'
       WHERE subject_principal_id = $2 AND revoked_at IS NULL`,
      [now, input.principalId],
    );
    await client.query(
      `UPDATE tokenless_agent_oauth_refresh_tokens SET revoked_at = $1, revocation_reason = 'account_deleted'
       WHERE subject_principal_id = $2 AND revoked_at IS NULL`,
      [now, input.principalId],
    );
    await client.query(
      `UPDATE tokenless_agent_oauth_authorization_codes SET revoked_at = $1
       WHERE subject_principal_id = $2 AND revoked_at IS NULL`,
      [now, input.principalId],
    );
    await client.query(
      `UPDATE tokenless_agent_oauth_token_families
       SET status = 'revoked', revoked_at = $1, revoked_by = 'system:account_deletion',
           revocation_reason = 'account_deleted'
       WHERE subject_principal_id = $2 AND status = 'active'`,
      [now, input.principalId],
    );
    await client.query(
      `UPDATE tokenless_agent_integrations SET status = 'revoked', revoked_at = $1, updated_at = $1
       WHERE oauth_subject_principal_id = $2 AND status = 'active'`,
      [now, input.principalId],
    );
    await client.query(
      `UPDATE tokenless_agent_oauth_clients
       SET registered_by_principal_id = NULL, updated_at = $1
       WHERE registered_by_principal_id = $2`,
      [now, input.principalId],
    );
    await client.query(
      `UPDATE tokenless_agent_oauth_device_authorizations
       SET status = 'denied', approved_by_principal_id = NULL, approved_at = NULL,
           denied_at = $1, updated_at = $1
       WHERE approved_by_principal_id = $2 AND status = 'approved'`,
      [now, input.principalId],
    );
    await client.query(
      `UPDATE tokenless_agent_connection_intents
       SET status = 'cancelled', cancelled_at = $1, last_transition_at = $1,
           last_transition_reason = 'account_deleted'
       WHERE claimed_subject_principal_id = $2
         AND status NOT IN ('rejected','expired','cancelled')`,
      [now, input.principalId],
    );
    await client.query(
      `UPDATE tokenless_project_access_assignments
       SET status = 'revoked', revoked_at = $1, revoked_by = 'system:account_deletion'
       WHERE subject_kind IN ('account','principal') AND subject_reference = $2 AND status = 'active'`,
      [now, input.principalId],
    );
    await client.query(
      `UPDATE tokenless_ask_ownership SET owner_account_address = NULL, updated_at = $1
       WHERE owner_account_address = $2`,
      [now, input.principalId],
    );
    await client.query(
      `UPDATE tokenless_assurance_artifact_leases SET revoked_at = COALESCE(revoked_at, $1)
       WHERE account_address = $2`,
      [now, input.principalId],
    );
    await client.query(
      `UPDATE tokenless_workspace_member_invites
       SET intended_account_address = NULL,
           redeemed_by_account_address = CASE WHEN redeemed_by_account_address = $1 THEN NULL ELSE redeemed_by_account_address END
       WHERE intended_account_address = $1 OR redeemed_by_account_address = $1`,
      [input.principalId],
    );
    await client.query(
      `UPDATE tokenless_assurance_reviewer_invitations
       SET intended_account_address = NULL,
           redeemed_by_account_address = CASE WHEN redeemed_by_account_address = $1 THEN NULL ELSE redeemed_by_account_address END
       WHERE intended_account_address = $1 OR redeemed_by_account_address = $1`,
      [input.principalId],
    );
    await client.query(
      `UPDATE tokenless_private_group_invitations SET intended_account_address = NULL
       WHERE intended_account_address = $1`,
      [input.principalId],
    );
    await client.query(`DELETE FROM tokenless_workspace_member_clients WHERE account_address = $1`, [
      input.principalId,
    ]);
    await client.query(`DELETE FROM tokenless_workspace_member_governance WHERE account_address = $1`, [
      input.principalId,
    ]);
    await client.query(`DELETE FROM tokenless_workspace_members WHERE account_address = $1`, [input.principalId]);
    await client.query(`DELETE FROM tokenless_eligibility_provider_handoffs WHERE account_address = $1`, [
      input.principalId,
    ]);
    await client.query(
      `DELETE FROM tokenless_world_id_requests
       WHERE account_address = $1 AND status IN ('pending','superseded')`,
      [input.principalId],
    );
    await client.query(`DELETE FROM tokenless_wallet_binding_challenges WHERE principal_id = $1`, [input.principalId]);
    await client.query(`DELETE FROM tokenless_thirdweb_wallet_jtis WHERE principal_id = $1`, [input.principalId]);
    await client.query(`DELETE FROM tokenless_wallet_bindings WHERE principal_id = $1`, [input.principalId]);
    await client.query(`DELETE FROM tokenless_browser_identities WHERE principal_address = $1`, [input.principalId]);
    if (email) {
      await client.query(
        `DELETE FROM tokenless_better_auth_verifications
         WHERE identifier = ANY($1::text[])`,
        [["email-verification", "sign-in", "forget-password", "change-email"].map(type => `${type}-otp-${email}`)],
      );
    }
    await client.query(`DELETE FROM tokenless_better_auth_users WHERE id = $1`, [input.betterAuthUserId]);

    const dueAt = await insertSubjectRequest(client, { principalId: input.principalId, requestId, now });
    const receiptDigest = await insertDeletionEvidence(client, {
      jobId,
      principalId: input.principalId,
      requestId,
      now,
      dueAt,
      releasedReservations,
    });
    await client.query("COMMIT");
    return { deleted: true as const, jobId, requestId, receiptDigest };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
