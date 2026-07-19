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
type DeletionCategoryEvidence = Record<string, unknown>;

type RaterErasureEvidence = {
  profileFound: boolean;
  deletedRows: {
    worldIdRequests: number;
    worldIdContextLimits: number;
    payoutEligibility: number;
    assuranceAssertions: number;
    providerSubjectBindings: number;
  };
  remainingRows: {
    worldIdRequests: number;
    worldIdContextLimits: number;
    payoutEligibility: number;
    assuranceAssertions: number;
    providerSubjectBindings: number;
    principalProfileLinks: number;
  };
  retainedPaidVouchers: number;
  tombstoneWritten: boolean;
  tombstoneReceiptHash: string | null;
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
       (SELECT COUNT(*) FROM tokenless_wallet_bindings
        WHERE principal_id = $1 AND wallet_source = 'thirdweb' AND revoked_at IS NULL) AS managed_wallets,
       (SELECT COUNT(*) FROM tokenless_assurance_assignments
        WHERE status = 'completed' AND (
          reviewer_account_address = $1 OR rater_id IN (
            SELECT rater_id FROM tokenless_rater_profiles WHERE principal_id = $1
          )
        )) AS completed_assignments,
       (SELECT COUNT(*) FROM tokenless_paid_vouchers v
        JOIN tokenless_rater_profiles r ON r.rater_id = v.rater_id
        WHERE r.principal_id = $1) AS paid_vouchers`,
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
      ]),
      JSON.stringify([
        { category: "deleted_auth_subject_guard", basis: "account_resurrection_prevention" },
        { category: "settlement_legal_security", basis: "legal_settlement_security" },
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
      payoutEligibility: 0,
      providerSubjectBindings: 0,
      worldIdContextLimits: 0,
      worldIdRequests: 0,
    },
    remainingRows: {
      assuranceAssertions: 0,
      payoutEligibility: 0,
      principalProfileLinks: 0,
      providerSubjectBindings: 0,
      worldIdContextLimits: 0,
      worldIdRequests: 0,
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
       (SELECT COUNT(*) FROM tokenless_assurance_assertions WHERE rater_id = $1)
         AS assurance_assertions,
       (SELECT COUNT(*) FROM tokenless_provider_subject_bindings WHERE rater_id = $1)
         AS provider_subject_bindings,
       (SELECT COUNT(*) FROM tokenless_rater_profiles WHERE principal_id = $2)
         AS principal_profile_links,
       (SELECT COUNT(*) FROM tokenless_paid_vouchers WHERE rater_id = $1)
         AS retained_paid_vouchers`,
    [raterId, principalId],
  );
  const row = remaining.rows[0] as Row | undefined;
  return {
    profileFound: true,
    deletedRows: {
      assuranceAssertions: assuranceAssertions.rowCount ?? 0,
      payoutEligibility: payoutEligibility.rowCount ?? 0,
      providerSubjectBindings: providerSubjectBindings.rowCount ?? 0,
      worldIdContextLimits: worldIdContextLimits.rowCount ?? 0,
      worldIdRequests: worldIdRequests.rowCount ?? 0,
    },
    remainingRows: {
      assuranceAssertions: rowNumber(row, "assurance_assertions"),
      payoutEligibility: rowNumber(row, "payout_eligibility"),
      principalProfileLinks: rowNumber(row, "principal_profile_links"),
      providerSubjectBindings: rowNumber(row, "provider_subject_bindings"),
      worldIdContextLimits: rowNumber(row, "world_id_context_limits"),
      worldIdRequests: rowNumber(row, "world_id_requests"),
    },
    retainedPaidVouchers: rowNumber(row, "retained_paid_vouchers"),
    tombstoneReceiptHash: `sha256:${receiptDigest}`,
    tombstoneWritten: tombstone.rowCount === 1,
  };
}

async function collectDeletionCategoryEvidence(
  client: PoolClient,
  input: {
    betterAuthUserId: string;
    email: string;
    principalId: string;
    raterErasure: RaterErasureEvidence;
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
       (SELECT COUNT(*) FROM tokenless_wallet_bindings WHERE principal_id = $1) AS wallet_bindings,
       (SELECT COUNT(*) FROM tokenless_payout_wallet_ownership WHERE principal_id = $1) AS payout_wallet_ownership`,
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
    },
    eligibility_handoffs: {
      eligibilityHandoffs: rowNumber(row, "eligibility_handoffs"),
      managedWalletJtis: rowNumber(row, "managed_wallet_jtis"),
      payoutWalletOwnership: rowNumber(row, "payout_wallet_ownership"),
      walletBindings: rowNumber(row, "wallet_bindings"),
      walletChallenges: rowNumber(row, "wallet_challenges"),
    },
    world_id_and_rater_linkage: {
      deletedRows: input.raterErasure.deletedRows,
      profileFound: input.raterErasure.profileFound,
      remainingRows: input.raterErasure.remainingRows,
      tombstoneWritten: input.raterErasure.tombstoneWritten,
    },
    deleted_auth_subject_guard: {
      deletedPrincipalTombstones: rowNumber(row, "deleted_principals"),
      revokedIdentityBindings: rowNumber(row, "revoked_identity_bindings"),
    },
    settlement_legal_security: {
      retainedPaidVouchers: input.raterErasure.retainedPaidVouchers,
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
    walletBindings: rowNumber(row, "wallet_bindings"),
    walletChallenges: rowNumber(row, "wallet_challenges"),
    workspaceClients: rowNumber(row, "workspace_clients"),
    workspaceGovernance: rowNumber(row, "workspace_governance"),
    workspaceMemberships: rowNumber(row, "workspace_memberships"),
    ...input.raterErasure.remainingRows,
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
  const receiptDigest = deletionReceiptDigest({ jobId, requestId, now });
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
    await client.query(`DELETE FROM tokenless_eligibility_provider_handoffs WHERE principal_id = $1`, [
      input.principalId,
    ]);
    const raterErasure = await eraseRaterIdentity(client, input.principalId, receiptDigest, now);
    await client.query(`DELETE FROM tokenless_wallet_binding_challenges WHERE principal_id = $1`, [input.principalId]);
    await client.query(`DELETE FROM tokenless_thirdweb_wallet_jtis WHERE principal_id = $1`, [input.principalId]);
    await client.query(`DELETE FROM tokenless_payout_wallet_ownership WHERE principal_id = $1`, [input.principalId]);
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

    const categoryEvidence = await collectDeletionCategoryEvidence(client, {
      betterAuthUserId: input.betterAuthUserId,
      email,
      principalId: input.principalId,
      raterErasure,
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
