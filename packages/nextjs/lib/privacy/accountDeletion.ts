import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { consumeLockedAccountDeletionProof, lockAccountDeletionProof } from "~~/lib/auth/recentAccountActionProof";
import { dbPool } from "~~/lib/db";
import {
  type PaidAssignmentSeatIdentityErasureEvidence,
  erasePaidAssignmentSeatIdentities,
} from "~~/lib/privacy/paidAssignmentSeatIdentityErasure";
import { erasePrincipalForecastIntegrityInTransaction } from "~~/lib/tokenless/crowdForecastPersistence";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const DELETION_DUE_MS = 30 * 86_400_000;
const SECURITY_GUARD_RETENTION_MS = 35 * 86_400_000;
const LEGAL_RECORD_RETENTION_MS = 3_650 * 86_400_000;

type Row = Record<string, unknown>;
type DeletionBlocker = { code: string; message: string };
type DeletionCategoryEvidence = Record<string, unknown>;
type DirectAccessErasureEvidence = {
  enterpriseMembersUnlinked: number;
  reviewerAccessRowsAnonymized: number;
  reviewerAcceptancesDeleted: number;
  tombstonePrincipalId: string;
};

type RaterErasureEvidence = {
  profileFound: boolean;
  deletedRows: {
    legalEligibility: number;
    paidEligibilityScopes: number;
    reviewerQualifications: number;
    sanctionsScreenings: number;
    worldIdRequests: number;
    worldIdContextLimits: number;
    payoutEligibility: number;
    assuranceAssertions: number;
    providerSubjectBindings: number;
  };
  remainingRows: {
    legalEligibility: number;
    paidEligibilityScopes: number;
    reviewerQualifications: number;
    sanctionsScreenings: number;
    worldIdRequests: number;
    worldIdContextLimits: number;
    payoutEligibility: number;
    assuranceAssertions: number;
    providerSubjectBindings: number;
    principalProfileLinks: number;
  };
  retainedRaterRows: {
    assuranceAssignments: number;
    expertiseVerificationRequests: number;
    goldOutcomes: number;
    paidReviewEligibilitySnapshots: number;
    paidReviewVoucherIssuances: number;
    voucherAssuranceSnapshots: number;
  };
  retainedPaidVouchers: number;
  tombstoneWritten: boolean;
  tombstoneReceiptHash: string | null;
};

type PrivateQuoteErasureEvidence = {
  deletedUnreferenced: number;
  erasedReferencedContent: number;
  ownerTombstone: string;
  remainingDirectOwnerLinks: number;
  retainedReferencedCommitmentOnly: number;
};

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

function stableEvidenceJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => stableEvidenceJson(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableEvidenceJson(item)}`)
    .join(",")}}`;
}

function id(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function deletionReceiptDigest(input: { jobId: string; requestId: string; now: Date }) {
  return digest(`account:${input.jobId}:${input.requestId}:${input.now.toISOString()}`);
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
        WHERE status = 'accepted' AND (
          reviewer_account_address = $1 OR rater_id IN (
            SELECT rater_id FROM tokenless_rater_profiles WHERE principal_id = $1
          )
        )) AS accepted_assignments,
       (SELECT COUNT(*) FROM tokenless_private_unpaid_review_assignments assignments
        JOIN tokenless_paid_assignment_seats seats ON seats.assignment_id=assignments.assignment_id
        WHERE assignments.status='accepted' AND seats.reviewer_principal_id=$1)
         AS accepted_paid_assignments,
       (SELECT COUNT(*) FROM tokenless_wallet_bindings
        WHERE principal_id = $1 AND wallet_source = 'thirdweb' AND revoked_at IS NULL) AS managed_wallets,
       (SELECT COUNT(*) FROM tokenless_assurance_assignments
        WHERE status = 'completed' AND (
          reviewer_account_address = $1 OR rater_id IN (
            SELECT rater_id FROM tokenless_rater_profiles WHERE principal_id = $1
          )
        )) AS completed_assignments,
       (SELECT COUNT(*) FROM tokenless_private_unpaid_review_assignments assignments
        JOIN tokenless_paid_assignment_seats seats ON seats.assignment_id=assignments.assignment_id
        WHERE assignments.status='completed' AND seats.reviewer_principal_id=$1)
         AS completed_paid_assignments,
       (SELECT COUNT(*) FROM tokenless_paid_vouchers v
        JOIN tokenless_rater_profiles r ON r.rater_id = v.rater_id
        WHERE r.principal_id = $1) AS paid_vouchers,
       (SELECT COUNT(*) FROM tokenless_agent_quotes quote
        WHERE quote.owner_principal_id = $1
          AND quote.quote_id IN (
            SELECT quote_id FROM tokenless_agent_asks
            UNION
            SELECT quote_id FROM tokenless_paid_assignment_operations WHERE quote_id IS NOT NULL
          )) AS retained_private_quotes,
       (SELECT COUNT(*) FROM tokenless_paid_assignment_seats
        WHERE reviewer_principal_id = $1) AS paid_assignment_seats`,
    [principalId],
  );
  const row = result.rows[0] as Row | undefined;
  const ownedWorkspaces = rowNumber(row, "owned_workspaces");
  const sharedWorkspaces = rowNumber(row, "shared_workspaces");
  const acceptedAssignments = rowNumber(row, "accepted_assignments") + rowNumber(row, "accepted_paid_assignments");
  const managedWallets = rowNumber(row, "managed_wallets");
  const retainedRecords: string[] = [];
  if (
    rowNumber(row, "completed_assignments") > 0 ||
    rowNumber(row, "completed_paid_assignments") > 0 ||
    rowNumber(row, "paid_vouchers") > 0
  ) {
    retainedRecords.push("Completed paid-work and settlement evidence for the applicable legal retention period");
  }
  if (rowNumber(row, "retained_private_quotes") > 0) {
    retainedRecords.push("Referenced private quote commitments with plaintext removed and the owner link anonymized");
  }
  if (rowNumber(row, "paid_assignment_seats") > 0) {
    retainedRecords.push("Paid-assignment settlement commitments with direct reviewer identity removed");
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
     WHERE status = 'reserved' AND (
       reviewer_account_address = $2 OR rater_id IN (
         SELECT rater_id FROM tokenless_rater_profiles WHERE principal_id = $2
       )
     )
     RETURNING subpanel_id, project_id, cohort_id, reviewer_account_address`,
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
      [row.project_id, row.cohort_id, row.reviewer_account_address],
    );
  }
  return released.rowCount ?? 0;
}

async function eraseDirectWorkspaceAccess(
  client: PoolClient,
  input: { betterAuthUserId: string; now: Date; principalId: string; receiptDigest: string },
): Promise<DirectAccessErasureEvidence> {
  const tombstonePrincipalId = `rlp_erased_${digest(`workspace-access:${input.receiptDigest}`).slice(0, 24)}`;
  const systemBetterAuthUserId = "rateloop_deleted_enterprise_config_owner";
  await client.query(
    `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at,disabled_at)
     VALUES ($1,'deleted',$2,$2,$2) ON CONFLICT (principal_id) DO NOTHING`,
    [tombstonePrincipalId, input.now],
  );
  const enterpriseOwner = await client.query(
    `SELECT COUNT(*) AS count FROM tokenless_better_auth_sso_providers WHERE user_id=$1
     UNION ALL
     SELECT COUNT(*) AS count FROM tokenless_better_auth_scim_providers WHERE user_id=$1`,
    [input.betterAuthUserId],
  );
  if (enterpriseOwner.rows.some(value => rowNumber(value as Row, "count") > 0)) {
    await client.query(
      `INSERT INTO tokenless_better_auth_users
       (id,name,email,email_verified,created_at,updated_at)
       VALUES ($1,'Deleted enterprise configuration owner',
               'deleted-enterprise-config-owner@invalid.rateloop',false,$2,$2)
       ON CONFLICT (id) DO NOTHING`,
      [systemBetterAuthUserId, input.now],
    );
    await client.query(`UPDATE tokenless_better_auth_sso_providers SET user_id=$1 WHERE user_id=$2`, [
      systemBetterAuthUserId,
      input.betterAuthUserId,
    ]);
    await client.query(`UPDATE tokenless_better_auth_scim_providers SET user_id=$1 WHERE user_id=$2`, [
      systemBetterAuthUserId,
      input.betterAuthUserId,
    ]);
  }
  await client.query(
    `UPDATE tokenless_enterprise_identity_providers SET created_by=$1,updated_at=$2 WHERE created_by=$3`,
    [tombstonePrincipalId, input.now, input.principalId],
  );
  await client.query(
    `UPDATE tokenless_enterprise_scim_connections SET created_by=$1,updated_at=$2 WHERE created_by=$3`,
    [tombstonePrincipalId, input.now, input.principalId],
  );
  const enterpriseMembers = await client.query(
    `UPDATE tokenless_enterprise_managed_members
     SET better_auth_user_id=$1,principal_id=$2,status='deactivated',
         deactivated_at=COALESCE(deactivated_at,$3),last_synced_at=$3
     WHERE better_auth_user_id=$4 OR principal_id=$5`,
    [
      `deleted-member:${digest(`enterprise-member:${input.receiptDigest}`)}`,
      tombstonePrincipalId,
      input.now,
      input.betterAuthUserId,
      input.principalId,
    ],
  );
  await client.query(
    `UPDATE tokenless_enterprise_identity_audit_outbox
     SET actor_reference=CASE WHEN actor_reference IN ($1,$2) THEN 'system:deleted-principal' ELSE actor_reference END,
         target_id=CASE WHEN target_id IN ($1,$2) THEN 'deleted-subject' ELSE target_id END
     WHERE actor_reference IN ($1,$2) OR target_id IN ($1,$2)`,
    [input.principalId, input.betterAuthUserId],
  );

  await client.query(
    `INSERT INTO tokenless_workspace_reviewers
     (workspace_id,principal_address,status,activated_at,ended_at,end_reason,created_by,updated_at)
     SELECT workspace_id,$1,'removed',activated_at,$2::timestamptz,
            'account_deleted','system:account_deletion',$2::timestamptz
     FROM tokenless_workspace_reviewers WHERE principal_address=$3
     ON CONFLICT (workspace_id,principal_address) DO NOTHING`,
    [tombstonePrincipalId, input.now, input.principalId],
  );
  const grants = await client.query(
    `UPDATE tokenless_workspace_reviewer_access_grants
     SET principal_address=$1,revoked_at=COALESCE(revoked_at,$2),
         revoked_by=COALESCE(revoked_by,'system:account_deletion'),
         created_by=CASE WHEN created_by=$3 THEN 'system:deleted-principal' ELSE created_by END
     WHERE principal_address=$3`,
    [tombstonePrincipalId, input.now, input.principalId],
  );
  const redemptions = await client.query(
    `UPDATE tokenless_workspace_reviewer_invitation_redemptions
     SET principal_address=$1 WHERE principal_address=$2`,
    [tombstonePrincipalId, input.principalId],
  );
  const acceptances = await client.query(
    `DELETE FROM tokenless_workspace_reviewer_terms_acceptances WHERE principal_address=$1`,
    [input.principalId],
  );
  await client.query(
    `UPDATE tokenless_workspace_reviewer_events
     SET principal_address=NULL,
         actor_reference=CASE WHEN actor_reference=$1 THEN 'system:deleted-principal' ELSE actor_reference END,
         details_json=CASE WHEN principal_address=$1 THEN '{"subject":"deleted"}' ELSE details_json END
     WHERE principal_address=$1 OR actor_reference=$1`,
    [input.principalId],
  );
  await client.query(
    `UPDATE tokenless_workspace_reviewer_invitations
     SET intended_account_address=NULL,
         paid_adulthood_attested_by=CASE WHEN paid_adulthood_attested_by=$1
           THEN 'system:deleted-principal' ELSE paid_adulthood_attested_by END,
         created_by=CASE WHEN created_by=$1 THEN 'system:deleted-principal' ELSE created_by END,
         revoked_by=CASE WHEN revoked_by=$1 THEN 'system:deleted-principal' ELSE revoked_by END
     WHERE intended_account_address=$1 OR paid_adulthood_attested_by=$1
        OR created_by=$1 OR revoked_by=$1`,
    [input.principalId],
  );
  await client.query(`DELETE FROM tokenless_workspace_reviewers WHERE principal_address=$1`, [input.principalId]);
  await client.query(
    `UPDATE tokenless_private_group_events
     SET principal_address=NULL,
         actor_reference=CASE WHEN actor_reference=$1 THEN 'system:deleted-principal' ELSE actor_reference END,
         details_json=CASE WHEN principal_address=$1 THEN '{"subject":"deleted"}' ELSE details_json END
     WHERE principal_address=$1 OR actor_reference=$1`,
    [input.principalId],
  );
  const remaining = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM tokenless_workspace_reviewers WHERE principal_address=$1) AS reviewers,
       (SELECT COUNT(*) FROM tokenless_workspace_reviewer_access_grants WHERE principal_address=$1) AS grants,
       (SELECT COUNT(*) FROM tokenless_workspace_reviewer_invitation_redemptions
        WHERE principal_address=$1) AS redemptions,
       (SELECT COUNT(*) FROM tokenless_workspace_reviewer_terms_acceptances
        WHERE principal_address=$1) AS acceptances,
       (SELECT COUNT(*) FROM tokenless_workspace_reviewer_events WHERE principal_address=$1) AS reviewer_events,
       (SELECT COUNT(*) FROM tokenless_enterprise_managed_members
        WHERE principal_id=$1 OR better_auth_user_id=$2) AS enterprise_members`,
    [input.principalId, input.betterAuthUserId],
  );
  const remainingRow = remaining.rows[0] as Row;
  const incomplete = Object.entries(remainingRow).find(([, value]) => Number(value) !== 0);
  if (incomplete) throw new Error(`Account deletion postcondition failed: ${incomplete[0]}.`);
  return {
    enterpriseMembersUnlinked: enterpriseMembers.rowCount ?? 0,
    reviewerAccessRowsAnonymized: (grants.rowCount ?? 0) + (redemptions.rowCount ?? 0),
    reviewerAcceptancesDeleted: acceptances.rowCount ?? 0,
    tombstonePrincipalId,
  };
}

async function insertSubjectRequest(
  client: PoolClient,
  input: {
    principalId: string;
    requestId: string;
    requestedAt: Date;
    completedAt: Date;
  },
) {
  const dueAt = new Date(input.requestedAt.getTime() + DELETION_DUE_MS);
  await client.query(
    `INSERT INTO tokenless_subject_requests
     (request_id, principal_id, workspace_id, request_type, status, scope_json, identity_assurance,
      received_at, due_at, completed_at)
     VALUES ($1, $2, NULL, 'deletion', 'completed', '{"account":true}', 'recent_better_auth_session', $3, $4, $5)`,
    [input.requestId, input.principalId, input.requestedAt, dueAt, input.completedAt],
  );
  // Account erasure is one atomic transaction. Recording intermediate states that never
  // existed durably would manufacture a lifecycle, so the receipt has one honest event.
  await client.query(
    `INSERT INTO tokenless_subject_request_events
     (event_id, request_id, from_status, to_status, actor_reference, reason, created_at)
     VALUES ($1, $2, NULL, 'completed', 'system:account_deletion',
             'atomic_account_erasure_completed', $3)`,
    [id("dsre"), input.requestId, input.completedAt],
  );
  return dueAt;
}

async function insertDeletionEvidence(
  client: PoolClient,
  input: {
    jobId: string;
    principalId: string;
    requestId: string;
    requestedAt: Date;
    completedAt: Date;
    dueAt: Date;
    releasedReservations: number;
    categoryEvidence: Record<string, DeletionCategoryEvidence>;
  },
) {
  const categories = [
    ["account_authentication", "erase", "completed", null, null],
    ["contact_and_preferences", "erase", "completed", null, null],
    ["shared_workspace_access", "erase", "completed", null, null],
    ["eligibility_handoffs", "erase", "completed", null, null],
    ["world_id_and_rater_linkage", "erase", "completed", null, null],
    ["private_quote_plaintext_payloads", "erase", "completed", null, null],
    [
      "referenced_private_quote_commitments",
      "retain",
      "retained",
      "legal_settlement_security",
      new Date(input.requestedAt.getTime() + LEGAL_RECORD_RETENTION_MS),
    ],
    [
      "deleted_auth_subject_guard",
      "retain",
      "retained",
      "account_resurrection_prevention",
      new Date(input.requestedAt.getTime() + SECURITY_GUARD_RETENTION_MS),
    ],
    [
      "settlement_legal_security",
      "retain",
      "retained",
      "legal_settlement_security",
      new Date(input.requestedAt.getTime() + LEGAL_RECORD_RETENTION_MS),
    ],
    ["public_chain", "public_chain", "retained", "externally_immutable", null],
  ] as const;
  const receiptDigest = deletionReceiptDigest({
    jobId: input.jobId,
    requestId: input.requestId,
    now: input.requestedAt,
  });
  await client.query(
    `INSERT INTO tokenless_deletion_jobs
     (job_id, scope_kind, scope_id, subject_request_id, requested_by, status, due_at, requested_at,
      started_at, completed_at, receipt_digest)
     VALUES ($1, 'account', $2, $3, $2, 'completed', $4, $5, $5, $6, $7)`,
    [input.jobId, input.principalId, input.requestId, input.dueAt, input.requestedAt, input.completedAt, receiptDigest],
  );
  const categoryDigests: Record<string, string> = {};
  for (const [category, disposition, status, basisCode, retentionDeadline] of categories) {
    const evidence = input.categoryEvidence[category];
    if (!evidence) throw new Error(`Account deletion evidence is missing category ${category}.`);
    const evidenceDigest = digest(stableEvidenceJson({ category, disposition, evidence, jobId: input.jobId, status }));
    categoryDigests[category] = evidenceDigest;
    await client.query(
      `INSERT INTO tokenless_deletion_job_categories
       (job_id, category, disposition, status, basis_code, retention_deadline, evidence_digest,
        created_at, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`,
      [
        input.jobId,
        category,
        disposition,
        status,
        basisCode,
        retentionDeadline,
        evidenceDigest,
        input.requestedAt,
        input.completedAt,
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
        "world_id_and_rater_linkage",
        "private_quote_plaintext_payloads",
      ]),
      JSON.stringify([
        { category: "deleted_auth_subject_guard", basis: "account_resurrection_prevention" },
        { category: "settlement_legal_security", basis: "legal_settlement_security" },
        { category: "referenced_private_quote_commitments", basis: "legal_settlement_security" },
      ]),
      JSON.stringify([
        {
          category: "deleted_auth_subject_guard",
          expiresAt: new Date(input.requestedAt.getTime() + SECURITY_GUARD_RETENTION_MS).toISOString(),
        },
      ]),
      JSON.stringify(["public_chain"]),
      JSON.stringify({
        categoryDigests,
        categoryEvidence: input.categoryEvidence,
        jobId: input.jobId,
        receiptDigest,
        releasedReservations: input.releasedReservations,
      }),
      input.completedAt,
    ],
  );
  return receiptDigest;
}

async function eraseRaterIdentity(
  client: PoolClient,
  principalId: string,
  receiptDigest: string,
  now: Date,
): Promise<RaterErasureEvidence> {
  const emptyEvidence: RaterErasureEvidence = {
    profileFound: false,
    deletedRows: {
      assuranceAssertions: 0,
      legalEligibility: 0,
      paidEligibilityScopes: 0,
      payoutEligibility: 0,
      providerSubjectBindings: 0,
      reviewerQualifications: 0,
      sanctionsScreenings: 0,
      worldIdContextLimits: 0,
      worldIdRequests: 0,
    },
    remainingRows: {
      assuranceAssertions: 0,
      legalEligibility: 0,
      paidEligibilityScopes: 0,
      payoutEligibility: 0,
      principalProfileLinks: 0,
      providerSubjectBindings: 0,
      reviewerQualifications: 0,
      sanctionsScreenings: 0,
      worldIdContextLimits: 0,
      worldIdRequests: 0,
    },
    retainedRaterRows: {
      assuranceAssignments: 0,
      expertiseVerificationRequests: 0,
      goldOutcomes: 0,
      paidReviewEligibilitySnapshots: 0,
      paidReviewVoucherIssuances: 0,
      voucherAssuranceSnapshots: 0,
    },
    retainedPaidVouchers: 0,
    tombstoneReceiptHash: null,
    tombstoneWritten: false,
  };
  const rater = await client.query(
    `SELECT rater_id FROM tokenless_rater_profiles WHERE principal_id = $1 LIMIT 1 FOR UPDATE`,
    [principalId],
  );
  const raterId = String((rater.rows[0] as { rater_id?: unknown } | undefined)?.rater_id ?? "");
  if (!raterId) return emptyEvidence;

  const worldIdRequests = await client.query(
    `DELETE FROM tokenless_world_id_requests WHERE rater_id = $1 OR principal_id = $2`,
    [raterId, principalId],
  );
  const worldIdContextLimits = await client.query(`DELETE FROM tokenless_world_id_context_limits WHERE rater_id = $1`, [
    raterId,
  ]);
  const payoutEligibility = await client.query(`DELETE FROM tokenless_payout_eligibility WHERE rater_id = $1`, [
    raterId,
  ]);
  const paidEligibilityScopes = await client.query(
    `DELETE FROM tokenless_paid_eligibility_scopes WHERE rater_id = $1`,
    [raterId],
  );
  const sanctionsScreenings = await client.query(`DELETE FROM tokenless_sanctions_screenings WHERE rater_id = $1`, [
    raterId,
  ]);
  const legalEligibility = await client.query(`DELETE FROM tokenless_legal_eligibility WHERE rater_id = $1`, [raterId]);
  await client.query(
    `DELETE FROM tokenless_private_group_invitation_expertise_attestations
     WHERE materialized_qualification_id IN (
       SELECT qualification_id FROM tokenless_reviewer_qualifications
       WHERE rater_id = $1 OR reviewer_account_address = $2
     )`,
    [raterId, principalId],
  );
  const reviewerQualifications = await client.query(
    `DELETE FROM tokenless_reviewer_qualifications
     WHERE rater_id = $1 OR reviewer_account_address = $2`,
    [raterId, principalId],
  );
  const assuranceAssertions = await client.query(`DELETE FROM tokenless_assurance_assertions WHERE rater_id = $1`, [
    raterId,
  ]);
  const providerSubjectBindings = await client.query(
    `DELETE FROM tokenless_provider_subject_bindings WHERE rater_id = $1`,
    [raterId],
  );

  const erasedAccount = `0x${digest(`deleted-rater-payout:${receiptDigest}`).slice(0, 40)}`;
  const tombstone = await client.query(
    `UPDATE tokenless_rater_profiles
     SET principal_id = NULL, account_address = $1,
         nullifier_seed_ciphertext = $2, nullifier_key_version = 'deleted-receipt-v1',
         nullifier_key_domain = 'vote_mapping', deletion_receipt_hash = $3,
         deleted_at = $4, updated_at = $4
     WHERE rater_id = $5 AND principal_id = $6`,
    [erasedAccount, `deleted:${receiptDigest}`, `sha256:${receiptDigest}`, now, raterId, principalId],
  );
  const remaining = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM tokenless_world_id_requests WHERE rater_id = $1 OR principal_id = $2)
         AS world_id_requests,
       (SELECT COUNT(*) FROM tokenless_world_id_context_limits WHERE rater_id = $1)
         AS world_id_context_limits,
       (SELECT COUNT(*) FROM tokenless_payout_eligibility WHERE rater_id = $1)
         AS payout_eligibility,
       (SELECT COUNT(*) FROM tokenless_legal_eligibility WHERE rater_id = $1)
         AS legal_eligibility,
       (SELECT COUNT(*) FROM tokenless_paid_eligibility_scopes WHERE rater_id = $1)
         AS paid_eligibility_scopes,
       (SELECT COUNT(*) FROM tokenless_sanctions_screenings WHERE rater_id = $1)
         AS sanctions_screenings,
       (SELECT COUNT(*) FROM tokenless_reviewer_qualifications
        WHERE rater_id = $1 OR reviewer_account_address = $2) AS reviewer_qualifications,
       (SELECT COUNT(*) FROM tokenless_assurance_assertions WHERE rater_id = $1)
         AS assurance_assertions,
       (SELECT COUNT(*) FROM tokenless_provider_subject_bindings WHERE rater_id = $1)
         AS provider_subject_bindings,
       (SELECT COUNT(*) FROM tokenless_rater_profiles WHERE principal_id = $2)
         AS principal_profile_links,
       (SELECT COUNT(*) FROM tokenless_paid_vouchers WHERE rater_id = $1)
         AS retained_paid_vouchers,
       (SELECT COUNT(*) FROM tokenless_assurance_assignments WHERE rater_id = $1)
         AS retained_assurance_assignments,
       (SELECT COUNT(*) FROM tokenless_expertise_verification_requests WHERE rater_id = $1)
         AS retained_expertise_verification_requests,
       (SELECT COUNT(*) FROM tokenless_assurance_gold_outcomes WHERE rater_id = $1)
         AS retained_gold_outcomes,
       (SELECT COUNT(*) FROM tokenless_paid_review_eligibility_snapshots WHERE rater_id = $1)
         AS retained_paid_review_eligibility_snapshots,
       (SELECT COUNT(*) FROM tokenless_paid_review_voucher_issuances WHERE rater_id = $1)
         AS retained_paid_review_voucher_issuances,
       (SELECT COUNT(*) FROM tokenless_voucher_assurance_snapshots WHERE rater_id = $1)
         AS retained_voucher_assurance_snapshots`,
    [raterId, principalId],
  );
  const row = remaining.rows[0] as Row | undefined;
  return {
    profileFound: true,
    deletedRows: {
      assuranceAssertions: assuranceAssertions.rowCount ?? 0,
      legalEligibility: legalEligibility.rowCount ?? 0,
      paidEligibilityScopes: paidEligibilityScopes.rowCount ?? 0,
      payoutEligibility: payoutEligibility.rowCount ?? 0,
      providerSubjectBindings: providerSubjectBindings.rowCount ?? 0,
      reviewerQualifications: reviewerQualifications.rowCount ?? 0,
      sanctionsScreenings: sanctionsScreenings.rowCount ?? 0,
      worldIdContextLimits: worldIdContextLimits.rowCount ?? 0,
      worldIdRequests: worldIdRequests.rowCount ?? 0,
    },
    remainingRows: {
      assuranceAssertions: rowNumber(row, "assurance_assertions"),
      legalEligibility: rowNumber(row, "legal_eligibility"),
      paidEligibilityScopes: rowNumber(row, "paid_eligibility_scopes"),
      payoutEligibility: rowNumber(row, "payout_eligibility"),
      principalProfileLinks: rowNumber(row, "principal_profile_links"),
      providerSubjectBindings: rowNumber(row, "provider_subject_bindings"),
      reviewerQualifications: rowNumber(row, "reviewer_qualifications"),
      sanctionsScreenings: rowNumber(row, "sanctions_screenings"),
      worldIdContextLimits: rowNumber(row, "world_id_context_limits"),
      worldIdRequests: rowNumber(row, "world_id_requests"),
    },
    retainedRaterRows: {
      assuranceAssignments: rowNumber(row, "retained_assurance_assignments"),
      expertiseVerificationRequests: rowNumber(row, "retained_expertise_verification_requests"),
      goldOutcomes: rowNumber(row, "retained_gold_outcomes"),
      paidReviewEligibilitySnapshots: rowNumber(row, "retained_paid_review_eligibility_snapshots"),
      paidReviewVoucherIssuances: rowNumber(row, "retained_paid_review_voucher_issuances"),
      voucherAssuranceSnapshots: rowNumber(row, "retained_voucher_assurance_snapshots"),
    },
    retainedPaidVouchers: rowNumber(row, "retained_paid_vouchers"),
    tombstoneReceiptHash: `sha256:${receiptDigest}`,
    tombstoneWritten: tombstone.rowCount === 1,
  };
}

async function erasePrivateQuoteOwnership(
  client: PoolClient,
  principalId: string,
  receiptDigest: string,
): Promise<PrivateQuoteErasureEvidence> {
  const ownerTombstone = `deleted-quote:${digest(`account-quote-owner:${receiptDigest}`)}`;
  const deleted = await client.query(
    `DELETE FROM tokenless_agent_quotes
     WHERE owner_principal_id = $1
       AND quote_id NOT IN (
         SELECT quote_id FROM tokenless_agent_asks
         UNION
         SELECT quote_id FROM tokenless_paid_assignment_operations WHERE quote_id IS NOT NULL
       )`,
    [principalId],
  );
  const erasedReferencedContent = await client.query(
    `UPDATE tokenless_content_records
     SET content_json=jsonb_build_object(
           'schemaVersion','rateloop.erased-private-content.v1',
           'contentCommitment',content_hash
         )::text,
         updated_at=CURRENT_TIMESTAMP
     WHERE content_id IN (
       SELECT qr.content_id
       FROM tokenless_agent_quotes q
       JOIN tokenless_agent_asks a ON a.quote_id=q.quote_id
       JOIN tokenless_ask_ownership ao ON ao.operation_key=a.operation_key
       JOIN tokenless_question_records qr ON qr.question_id=ao.question_id
       WHERE q.owner_principal_id=$1
     )`,
    [principalId],
  );
  const retained = await client.query(
    `UPDATE tokenless_agent_quotes
     SET owner_principal_id = $2, owner_workspace_id = NULL, owner_api_key_id = NULL,
         request_json=jsonb_build_object(
           'schemaVersion','rateloop.erased-private-quote.v1',
           'visibility','private',
           'requestCommitment',request_hash
         )::text
     WHERE owner_principal_id = $1
       AND quote_id IN (
         SELECT quote_id FROM tokenless_agent_asks
         UNION
         SELECT quote_id FROM tokenless_paid_assignment_operations WHERE quote_id IS NOT NULL
       )`,
    [principalId, ownerTombstone],
  );
  const remaining = await client.query(
    `SELECT COUNT(*) AS count FROM tokenless_agent_quotes WHERE owner_principal_id = $1`,
    [principalId],
  );
  return {
    deletedUnreferenced: deleted.rowCount ?? 0,
    erasedReferencedContent: erasedReferencedContent.rowCount ?? 0,
    ownerTombstone,
    remainingDirectOwnerLinks: rowNumber(remaining.rows[0] as Row | undefined, "count"),
    retainedReferencedCommitmentOnly: retained.rowCount ?? 0,
  };
}

async function collectDeletionCategoryEvidence(
  client: PoolClient,
  input: {
    betterAuthUserId: string;
    email: string;
    principalId: string;
    privateQuoteErasure: PrivateQuoteErasureEvidence;
    paidAssignmentSeatErasure: PaidAssignmentSeatIdentityErasureEvidence;
    raterErasure: RaterErasureEvidence;
    directAccessErasure: DirectAccessErasureEvidence;
    forecastIntegrityErasure: { deletedRows: number; remainingRows: number; subjectCount: number };
    releasedReservations: number;
  },
) {
  const postconditions = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM tokenless_principals WHERE principal_id = $1 AND status = 'deleted')
         AS deleted_principals,
       (SELECT COUNT(*) FROM tokenless_identity_bindings WHERE principal_id = $1 AND status = 'active')
         AS active_identity_bindings,
       (SELECT COUNT(*) FROM tokenless_identity_bindings WHERE principal_id = $1 AND status = 'revoked')
         AS revoked_identity_bindings,
       (SELECT COUNT(*) FROM tokenless_auth_sessions WHERE principal_id = $1 AND revoked_at IS NULL)
         AS active_auth_sessions,
       (SELECT COUNT(*) FROM tokenless_agent_oauth_access_tokens
          WHERE subject_principal_id = $1 AND revoked_at IS NULL) AS active_oauth_access_tokens,
       (SELECT COUNT(*) FROM tokenless_agent_oauth_refresh_tokens
          WHERE subject_principal_id = $1 AND revoked_at IS NULL) AS active_oauth_refresh_tokens,
       (SELECT COUNT(*) FROM tokenless_agent_oauth_authorization_codes
          WHERE subject_principal_id = $1 AND revoked_at IS NULL) AS active_oauth_authorization_codes,
       (SELECT COUNT(*) FROM tokenless_agent_oauth_token_families
          WHERE subject_principal_id = $1 AND status = 'active') AS active_oauth_token_families,
       (SELECT COUNT(*) FROM tokenless_agent_integrations
          WHERE oauth_subject_principal_id = $1 AND status = 'active') AS active_agent_integrations,
       (SELECT COUNT(*) FROM tokenless_better_auth_users WHERE id = $2) AS better_auth_users,
       (SELECT COUNT(*) FROM tokenless_browser_identities WHERE principal_address = $1) AS browser_identities,
       (SELECT COUNT(*) FROM tokenless_workspace_members WHERE account_address = $1) AS workspace_memberships,
       (SELECT COUNT(*) FROM tokenless_workspace_member_clients WHERE account_address = $1) AS workspace_clients,
       (SELECT COUNT(*) FROM tokenless_workspace_member_governance WHERE account_address = $1)
         AS workspace_governance,
       (SELECT COUNT(*) FROM tokenless_project_access_assignments
          WHERE subject_kind IN ('account','principal') AND subject_reference = $1 AND status = 'active')
         AS active_project_access,
       (SELECT COUNT(*) FROM tokenless_eligibility_provider_handoffs WHERE principal_id = $1)
         AS eligibility_handoffs,
       (SELECT COUNT(*) FROM tokenless_wallet_binding_challenges WHERE principal_id = $1)
         AS wallet_challenges,
       (SELECT COUNT(*) FROM tokenless_thirdweb_wallet_jtis WHERE principal_id = $1) AS managed_wallet_jtis,
       (SELECT COUNT(*) FROM tokenless_recent_account_action_proofs WHERE principal_id = $1)
         AS recent_account_action_proofs,
       (SELECT COUNT(*) FROM tokenless_passkey_action_proofs WHERE principal_id = $1)
         AS passkey_action_proofs,
       (SELECT COUNT(*) FROM tokenless_wallet_bindings WHERE principal_id = $1) AS wallet_bindings,
       (SELECT COUNT(*) FROM tokenless_payout_wallet_ownership WHERE principal_id = $1) AS payout_wallet_ownership,
       (SELECT COUNT(*) FROM tokenless_paid_assignment_seats WHERE reviewer_principal_id = $1)
         AS paid_assignment_seat_direct_identities`,
    [input.principalId, input.betterAuthUserId],
  );
  const row = postconditions.rows[0] as Row | undefined;
  let betterAuthVerifications = 0;
  if (input.email) {
    const verifications = await client.query(
      `SELECT COUNT(*) AS count FROM tokenless_better_auth_verifications
       WHERE identifier = ANY($1::text[])`,
      [["email-verification", "sign-in", "forget-password", "change-email"].map(type => `${type}-otp-${input.email}`)],
    );
    betterAuthVerifications = rowNumber(verifications.rows[0] as Row | undefined, "count");
  }
  const categoryEvidence: Record<string, DeletionCategoryEvidence> = {
    account_authentication: {
      activeAgentIntegrations: rowNumber(row, "active_agent_integrations"),
      activeAuthSessions: rowNumber(row, "active_auth_sessions"),
      activeIdentityBindings: rowNumber(row, "active_identity_bindings"),
      activeOauthAccessTokens: rowNumber(row, "active_oauth_access_tokens"),
      activeOauthAuthorizationCodes: rowNumber(row, "active_oauth_authorization_codes"),
      activeOauthRefreshTokens: rowNumber(row, "active_oauth_refresh_tokens"),
      activeOauthTokenFamilies: rowNumber(row, "active_oauth_token_families"),
      betterAuthUsers: rowNumber(row, "better_auth_users"),
      deletedPrincipalTombstones: rowNumber(row, "deleted_principals"),
    },
    contact_and_preferences: {
      betterAuthVerifications,
      browserIdentities: rowNumber(row, "browser_identities"),
    },
    shared_workspace_access: {
      activeProjectAccess: rowNumber(row, "active_project_access"),
      releasedReservations: input.releasedReservations,
      workspaceClients: rowNumber(row, "workspace_clients"),
      workspaceGovernance: rowNumber(row, "workspace_governance"),
      workspaceMemberships: rowNumber(row, "workspace_memberships"),
      directAccessErasure: input.directAccessErasure,
    },
    eligibility_handoffs: {
      eligibilityHandoffs: rowNumber(row, "eligibility_handoffs"),
      managedWalletJtis: rowNumber(row, "managed_wallet_jtis"),
      payoutWalletOwnership: rowNumber(row, "payout_wallet_ownership"),
      passkeyActionProofs: rowNumber(row, "passkey_action_proofs"),
      recentAccountActionProofs: rowNumber(row, "recent_account_action_proofs"),
      walletBindings: rowNumber(row, "wallet_bindings"),
      walletChallenges: rowNumber(row, "wallet_challenges"),
    },
    world_id_and_rater_linkage: {
      deletedRows: input.raterErasure.deletedRows,
      paidAssignmentSeatDirectIdentitiesErased: input.paidAssignmentSeatErasure.erasedSeats,
      profileFound: input.raterErasure.profileFound,
      remainingPaidAssignmentSeatDirectIdentities: input.paidAssignmentSeatErasure.remainingDirectIdentities,
      remainingRows: input.raterErasure.remainingRows,
      tombstoneWritten: input.raterErasure.tombstoneWritten,
      forecastIntegrityErasure: input.forecastIntegrityErasure,
    },
    private_quote_plaintext_payloads: {
      deletedUnreferenced: input.privateQuoteErasure.deletedUnreferenced,
      erasedReferencedContent: input.privateQuoteErasure.erasedReferencedContent,
    },
    referenced_private_quote_commitments: {
      retainedReferencedCommitmentOnly: input.privateQuoteErasure.retainedReferencedCommitmentOnly,
      ownerTombstone:
        input.privateQuoteErasure.retainedReferencedCommitmentOnly > 0
          ? input.privateQuoteErasure.ownerTombstone
          : null,
    },
    deleted_auth_subject_guard: {
      deletedPrincipalTombstones: rowNumber(row, "deleted_principals"),
      revokedIdentityBindings: rowNumber(row, "revoked_identity_bindings"),
    },
    settlement_legal_security: {
      privateQuoteOwnerTombstone:
        input.privateQuoteErasure.retainedReferencedCommitmentOnly > 0
          ? input.privateQuoteErasure.ownerTombstone
          : null,
      paidAssignmentSeatErasureReceiptHashes: input.paidAssignmentSeatErasure.receiptHashes,
      paidAssignmentSeatIdentityCommitmentsRetained: input.paidAssignmentSeatErasure.retainedIdentityCommitments,
      retainedPrivateQuoteCommitments: input.privateQuoteErasure.retainedReferencedCommitmentOnly,
      retainedPaidVouchers: input.raterErasure.retainedPaidVouchers,
      retainedRaterLinkedSettlementAndQualityRows: input.raterErasure.retainedRaterRows,
      raterTombstoneRetained: input.raterErasure.tombstoneWritten,
      tombstoneReceiptHash: input.raterErasure.tombstoneReceiptHash,
    },
    public_chain: {
      mutationAttempted: false,
      retentionReason: "externally_immutable",
    },
  };
  const requiredZeroPostconditions = {
    activeAgentIntegrations: rowNumber(row, "active_agent_integrations"),
    activeAuthSessions: rowNumber(row, "active_auth_sessions"),
    activeIdentityBindings: rowNumber(row, "active_identity_bindings"),
    activeOauthAccessTokens: rowNumber(row, "active_oauth_access_tokens"),
    activeOauthAuthorizationCodes: rowNumber(row, "active_oauth_authorization_codes"),
    activeOauthRefreshTokens: rowNumber(row, "active_oauth_refresh_tokens"),
    activeOauthTokenFamilies: rowNumber(row, "active_oauth_token_families"),
    activeProjectAccess: rowNumber(row, "active_project_access"),
    betterAuthUsers: rowNumber(row, "better_auth_users"),
    betterAuthVerifications,
    browserIdentities: rowNumber(row, "browser_identities"),
    eligibilityHandoffs: rowNumber(row, "eligibility_handoffs"),
    managedWalletJtis: rowNumber(row, "managed_wallet_jtis"),
    payoutWalletOwnership: rowNumber(row, "payout_wallet_ownership"),
    paidAssignmentSeatDirectIdentities: rowNumber(row, "paid_assignment_seat_direct_identities"),
    passkeyActionProofs: rowNumber(row, "passkey_action_proofs"),
    recentAccountActionProofs: rowNumber(row, "recent_account_action_proofs"),
    privateQuoteOwnerLinks: input.privateQuoteErasure.remainingDirectOwnerLinks,
    walletBindings: rowNumber(row, "wallet_bindings"),
    walletChallenges: rowNumber(row, "wallet_challenges"),
    workspaceClients: rowNumber(row, "workspace_clients"),
    workspaceGovernance: rowNumber(row, "workspace_governance"),
    workspaceMemberships: rowNumber(row, "workspace_memberships"),
    ...input.raterErasure.remainingRows,
    forecastIntegrityRows: input.forecastIntegrityErasure.remainingRows,
  };
  const incompletePostcondition = Object.entries(requiredZeroPostconditions).find(([, value]) => value !== 0);
  if (
    incompletePostcondition ||
    rowNumber(row, "deleted_principals") !== 1 ||
    (input.raterErasure.profileFound && !input.raterErasure.tombstoneWritten)
  ) {
    throw new Error(
      `Account deletion postcondition failed${incompletePostcondition ? `: ${incompletePostcondition[0]}` : ""}.`,
    );
  }
  return categoryEvidence;
}

export async function deleteAccount(input: {
  confirmation: string;
  principalId: string;
  recentAuthProof: unknown;
  now?: Date;
}) {
  if (input.confirmation !== "DELETE") {
    throw new TokenlessServiceError("Type DELETE to confirm account deletion.", 400, "account_deletion_unconfirmed");
  }
  const now = input.now ?? new Date();
  const requestId = id("dsr");
  const jobId = id("del");
  const receiptDigest = deletionReceiptDigest({ jobId, requestId, now });
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const preview = await loadPreview(client, input.principalId, true);
    if (preview.blockers.length > 0) {
      throw new TokenlessServiceError(preview.blockers[0].message, 409, preview.blockers[0].code);
    }
    const actionProof = await lockAccountDeletionProof(
      { now, principalId: input.principalId, proof: input.recentAuthProof },
      client,
    );
    const binding = await client.query(
      `SELECT b.binding_id, u.email
       FROM tokenless_identity_bindings b
       JOIN tokenless_better_auth_users u ON u.id = b.provider_subject
       WHERE b.principal_id = $1 AND b.provider = 'better_auth' AND b.provider_subject = $2
         AND b.status = 'active' FOR UPDATE`,
      [input.principalId, actionProof.betterAuthUserId],
    );
    if (binding.rowCount !== 1) {
      throw new TokenlessServiceError(
        "Sign in again before deleting this account.",
        401,
        "recent_authentication_required",
      );
    }
    await consumeLockedAccountDeletionProof({ ...actionProof, now, principalId: input.principalId }, client);
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
    const privateQuoteErasure = await erasePrivateQuoteOwnership(client, input.principalId, receiptDigest);
    const paidAssignmentSeatErasure = await erasePaidAssignmentSeatIdentities(client, {
      now,
      principalId: input.principalId,
      receiptDigest,
    });
    const directAccessErasure = await eraseDirectWorkspaceAccess(client, {
      betterAuthUserId: actionProof.betterAuthUserId,
      now,
      principalId: input.principalId,
      receiptDigest,
    });
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
    await client.query(`DELETE FROM tokenless_eligibility_provider_handoffs WHERE principal_id = $1`, [
      input.principalId,
    ]);
    const forecastIntegrityErasure = await erasePrincipalForecastIntegrityInTransaction(client, {
      principalId: input.principalId,
    });
    const raterErasure = await eraseRaterIdentity(client, input.principalId, receiptDigest, now);
    await client.query(`DELETE FROM tokenless_wallet_binding_challenges WHERE principal_id = $1`, [input.principalId]);
    await client.query(`DELETE FROM tokenless_thirdweb_wallet_jtis WHERE principal_id = $1`, [input.principalId]);
    await client.query(`DELETE FROM tokenless_payout_wallet_ownership WHERE principal_id = $1`, [input.principalId]);
    await client.query(`DELETE FROM tokenless_wallet_bindings WHERE principal_id = $1`, [input.principalId]);
    await client.query(`DELETE FROM tokenless_recent_account_action_proofs WHERE principal_id = $1`, [
      input.principalId,
    ]);
    await client.query(`DELETE FROM tokenless_passkey_action_proofs WHERE principal_id = $1`, [input.principalId]);
    await client.query(`DELETE FROM tokenless_browser_identities WHERE principal_address = $1`, [input.principalId]);
    if (email) {
      await client.query(
        `DELETE FROM tokenless_better_auth_verifications
         WHERE identifier = ANY($1::text[])`,
        [["email-verification", "sign-in", "forget-password", "change-email"].map(type => `${type}-otp-${email}`)],
      );
    }
    await client.query(`DELETE FROM tokenless_better_auth_users WHERE id = $1`, [actionProof.betterAuthUserId]);

    const categoryEvidence = await collectDeletionCategoryEvidence(client, {
      betterAuthUserId: actionProof.betterAuthUserId,
      email,
      principalId: input.principalId,
      paidAssignmentSeatErasure,
      privateQuoteErasure,
      raterErasure,
      directAccessErasure,
      forecastIntegrityErasure,
      releasedReservations,
    });
    const completedAt = new Date(Math.max(Date.now(), now.getTime()));
    const dueAt = await insertSubjectRequest(client, {
      completedAt,
      principalId: input.principalId,
      requestId,
      requestedAt: now,
    });
    const storedReceiptDigest = await insertDeletionEvidence(client, {
      categoryEvidence,
      completedAt,
      jobId,
      principalId: input.principalId,
      requestId,
      requestedAt: now,
      dueAt,
      releasedReservations,
    });
    if (storedReceiptDigest !== receiptDigest)
      throw new Error("Account deletion receipt digest changed during erasure.");
    await client.query("COMMIT");
    return { deleted: true as const, jobId, requestId, receiptDigest };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
