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
import { eraseIntegrityEpochReviewerMemberships } from "~~/lib/tokenless/integrityEpochProducer";
import { releaseSelectedNetworkAssignmentsForAccountDeletion } from "~~/lib/tokenless/networkAssignmentSettlement";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const DELETION_DUE_MS = 30 * 86_400_000;
const SECURITY_GUARD_RETENTION_MS = 35 * 86_400_000;
const LEGAL_RECORD_RETENTION_MS = 3_650 * 86_400_000;

type Row = Record<string, unknown>;
type DeletionBlocker = { code: string; message: string };
type DeletionCategoryEvidence = Record<string, unknown>;
type DirectAccessErasureEvidence = {
  enterpriseMembersUnlinked: number;
  assuranceAssignmentsAnonymized: number;
  directPrivateAssignmentsAnonymized: number;
  privateGroupPolicyAcceptancesDeleted: number;
  reviewerAccessRowsAnonymized: number;
  reviewerAcceptancesDeleted: number;
  tombstonePrincipalId: string;
};

type ReleasedReservationEvidence = {
  assurance: number;
  directPrivate: number;
  total: number;
};

type RaterErasureEvidence = {
  profileFound: boolean;
  deletedRows: {
    legalEligibility: number;
    paidEligibilityScopes: number;
    reviewerQualifications: number;
    sanctionsScreenings: number;
    paidEligibilityRiskChecks: number;
    worldIdRequests: number;
    worldIdContextLimits: number;
    payoutEligibility: number;
    assuranceAssertions: number;
    providerSubjectBindings: number;
    integrityEpochMemberships: number;
  };
  remainingRows: {
    legalEligibility: number;
    paidEligibilityScopes: number;
    reviewerQualifications: number;
    sanctionsScreenings: number;
    paidEligibilityRiskChecks: number;
    worldIdRequests: number;
    worldIdContextLimits: number;
    payoutEligibility: number;
    assuranceAssertions: number;
    providerSubjectBindings: number;
    principalProfileLinks: number;
    integrityEpochMemberships: number;
  };
  retainedRaterRows: {
    assuranceAssignments: number;
    expertiseVerificationRequests: number;
    goldOutcomes: number;
    paidReviewEligibilitySnapshots: number;
    paidReviewVoucherIssuances: number;
    voucherAssuranceSnapshots: number;
    networkSettlementCommitments: number;
    sanctionsMatches: number;
    dac7Records: number;
  };
  retainedPaidVouchers: number;
  networkCopiesErasure: {
    assignmentsAnonymized: number;
    assignmentHistoryAnonymized: number;
    materializedMembershipsDeleted: number;
    tombstoneMembershipsRetained: number;
    voucherSnapshotsAnonymized: number;
    remainingDirectCopies: number;
  };
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

type ServiceIdentityErasureEvidence = {
  agentAuditEventsPseudonymized: number;
  agentPolicyObjectsPseudonymized: number;
  workspaceGovernanceObjectsPseudonymized: number;
  agentIntegrationsPseudonymized: number;
  agentVersionsPseudonymized: number;
  agentsPseudonymized: number;
  connectionIntentsPseudonymized: number;
  mcpSessionsPseudonymized: number;
  oversightAttestationsPseudonymized: number;
  publicMediaPseudonymized: number;
  publicMediaQuotasErased: number;
  workspaceMovesPseudonymized: number;
};

type OauthAuthorizationErasureEvidence = {
  accessTokensPseudonymized: number;
  authorizationCodesPseudonymized: number;
  deviceAuthorizationsPseudonymized: number;
  refreshTokensPseudonymized: number;
  tokenFamiliesPseudonymized: number;
};

type HybridNetworkExclusionErasureEvidence = {
  deletedRows: number;
  remainingRows: number;
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

export const __hybridNetworkExclusionErasureSqlForTests = `DELETE FROM tokenless_hybrid_network_reviewer_exclusions
WHERE reviewer_principal_id=$1
RETURNING hybrid_operation_id`;

async function eraseHybridNetworkReviewerExclusions(
  client: PoolClient,
  principalId: string,
): Promise<HybridNetworkExclusionErasureEvidence> {
  const deleted = await client.query(__hybridNetworkExclusionErasureSqlForTests, [principalId]);
  const remaining = await client.query(
    `SELECT COUNT(*) AS count FROM tokenless_hybrid_network_reviewer_exclusions
     WHERE reviewer_principal_id=$1`,
    [principalId],
  );
  const remainingRows = rowNumber(remaining.rows[0] as Row | undefined, "count");
  if (remainingRows !== 0) throw new Error("Account deletion left a hybrid network reviewer exclusion.");
  return { deletedRows: deleted.rowCount ?? 0, remainingRows };
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
        WHERE assignments.status='accepted' AND (
          assignments.reviewer_account_address=$1 OR assignments.assignment_id IN (
            SELECT seats.assignment_id FROM tokenless_paid_assignment_seats seats
            WHERE seats.reviewer_principal_id=$1
          )
        )) AS accepted_private_assignments,
       (SELECT COUNT(*) FROM tokenless_wallet_bindings
        WHERE principal_id = $1 AND wallet_source = 'thirdweb' AND revoked_at IS NULL) AS managed_wallets,
       (SELECT COUNT(*) FROM tokenless_assurance_assignments
        WHERE status = 'completed' AND (
          reviewer_account_address = $1 OR rater_id IN (
            SELECT rater_id FROM tokenless_rater_profiles WHERE principal_id = $1
          )
        )) AS completed_assignments,
       (SELECT COUNT(*) FROM tokenless_private_unpaid_review_assignments assignments
        WHERE assignments.status='completed' AND (
          assignments.reviewer_account_address=$1 OR assignments.assignment_id IN (
            SELECT seats.assignment_id FROM tokenless_paid_assignment_seats seats
            WHERE seats.reviewer_principal_id=$1
          )
        )) AS completed_private_assignments,
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
        WHERE reviewer_principal_id = $1) AS paid_assignment_seats,
       (SELECT COUNT(*) FROM tokenless_network_assignment_settlements settlement
        JOIN tokenless_assurance_assignments assignment
          ON assignment.assignment_id=settlement.assignment_id
        JOIN tokenless_rater_profiles profile ON profile.rater_id=assignment.rater_id
        WHERE profile.principal_id=$1 AND settlement.state IN ('voucher_issued','committed')
          AND assignment.status <> 'accepted') AS active_network_settlements`,
    [principalId],
  );
  const row = result.rows[0] as Row | undefined;
  const ownedWorkspaces = rowNumber(row, "owned_workspaces");
  const sharedWorkspaces = rowNumber(row, "shared_workspaces");
  const acceptedAssignments =
    rowNumber(row, "accepted_assignments") +
    rowNumber(row, "accepted_private_assignments") +
    rowNumber(row, "active_network_settlements");
  const managedWallets = rowNumber(row, "managed_wallets");
  const retainedRecords: string[] = [];
  if (
    rowNumber(row, "completed_assignments") > 0 ||
    rowNumber(row, "completed_private_assignments") > 0 ||
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

async function releaseReservedAssignments(
  client: PoolClient,
  principalId: string,
  now: Date,
): Promise<ReleasedReservationEvidence> {
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
  const direct = await client.query(
    `UPDATE tokenless_private_unpaid_review_assignments
     SET status='expired',lease_state='expired',updated_at=$1
     WHERE status='reserved' AND reviewer_account_address=$2
     RETURNING project_id,cohort_id,reviewer_account_address`,
    [now, principalId],
  );
  for (const value of direct.rows) {
    const row = value as Row;
    const reviewer = await client.query(
      `UPDATE tokenless_assurance_cohort_reviewers
       SET active_reservations=active_reservations-1,updated_at=$1
       WHERE project_id=$2 AND cohort_id=$3 AND reviewer_account_address=$4
         AND active_reservations>0 RETURNING active_reservations`,
      [now, row.project_id, row.cohort_id, row.reviewer_account_address],
    );
    const cohort = await client.query(
      `UPDATE tokenless_assurance_cohorts
       SET active_reservations=active_reservations-1,updated_at=$1
       WHERE project_id=$2 AND cohort_id=$3 AND active_reservations>0
       RETURNING active_reservations`,
      [now, row.project_id, row.cohort_id],
    );
    if (reviewer.rowCount !== 1 || cohort.rowCount !== 1) {
      throw new Error("Account deletion found inconsistent direct-review reservation capacity.");
    }
  }
  const remaining = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM tokenless_private_unpaid_review_assignments
        WHERE reviewer_account_address=$1 AND status='reserved') AS reserved_direct,
       (SELECT COUNT(*) FROM tokenless_assurance_assignments
        WHERE reviewer_account_address=$1 AND status='reserved') AS reserved_assurance`,
    [principalId],
  );
  const remainingRow = remaining.rows[0] as Row | undefined;
  if (rowNumber(remainingRow, "reserved_direct") !== 0 || rowNumber(remainingRow, "reserved_assurance") !== 0) {
    throw new Error("Account deletion reservation-release postcondition failed.");
  }
  const assurance = released.rowCount ?? 0;
  const directPrivate = direct.rowCount ?? 0;
  return { assurance, directPrivate, total: assurance + directPrivate };
}

async function lockRaterProfileForDeletion(client: PoolClient, principalId: string) {
  await client.query(
    `SELECT rater_id FROM tokenless_rater_profiles
     WHERE principal_id=$1 LIMIT 1 FOR UPDATE`,
    [principalId],
  );
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
  await client.query(
    `INSERT INTO tokenless_assurance_cohort_reviewers
     (project_id,cohort_id,reviewer_account_address,qualification_provenance_json,
      qualification_expires_at,maximum_active_assignments,active_reservations,status,
      created_by,created_at,updated_at)
     SELECT DISTINCT assignment.project_id,assignment.cohort_id,$1,'{"subject":"deleted"}',
            $2::timestamptz,1,0,'removed','system:account_deletion',
            $2::timestamptz,$2::timestamptz
     FROM (
       SELECT project_id,cohort_id FROM tokenless_assurance_assignments
       WHERE reviewer_account_address=$3
       UNION
       SELECT project_id,cohort_id FROM tokenless_private_unpaid_review_assignments
       WHERE reviewer_account_address=$3
     ) assignment
     ON CONFLICT (project_id,cohort_id,reviewer_account_address) DO NOTHING`,
    [tombstonePrincipalId, input.now, input.principalId],
  );
  const assuranceAssignments = await client.query(
    `UPDATE tokenless_assurance_assignments
     SET reviewer_account_address=$1,updated_at=$2
     WHERE reviewer_account_address=$3`,
    [tombstonePrincipalId, input.now, input.principalId],
  );
  const directPrivateAssignments = await client.query(
    `UPDATE tokenless_private_unpaid_review_assignments
     SET reviewer_account_address=$1,updated_at=$2
     WHERE reviewer_account_address=$3`,
    [tombstonePrincipalId, input.now, input.principalId],
  );
  const privateGroupPolicyAcceptances = await client.query(
    `DELETE FROM tokenless_private_group_policy_acceptances WHERE principal_address=$1`,
    [input.principalId],
  );
  await client.query(
    `DELETE FROM tokenless_assurance_cohort_reviewers
     WHERE reviewer_account_address=$1 AND active_reservations=0`,
    [input.principalId],
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
        WHERE principal_id=$1 OR better_auth_user_id=$2) AS enterprise_members,
       (SELECT COUNT(*) FROM tokenless_assurance_assignments
        WHERE reviewer_account_address=$1) AS assurance_assignments,
       (SELECT COUNT(*) FROM tokenless_private_unpaid_review_assignments
        WHERE reviewer_account_address=$1) AS direct_private_assignments,
       (SELECT COUNT(*) FROM tokenless_private_group_policy_acceptances
        WHERE principal_address=$1) AS private_group_policy_acceptances,
       (SELECT COUNT(*) FROM tokenless_assurance_cohort_reviewers
        WHERE reviewer_account_address=$1) AS cohort_reviewers`,
    [input.principalId, input.betterAuthUserId],
  );
  const remainingRow = remaining.rows[0] as Row;
  const incomplete = Object.entries(remainingRow).find(([, value]) => Number(value) !== 0);
  if (incomplete) throw new Error(`Account deletion postcondition failed: ${incomplete[0]}.`);
  return {
    enterpriseMembersUnlinked: enterpriseMembers.rowCount ?? 0,
    assuranceAssignmentsAnonymized: assuranceAssignments.rowCount ?? 0,
    directPrivateAssignmentsAnonymized: directPrivateAssignments.rowCount ?? 0,
    privateGroupPolicyAcceptancesDeleted: privateGroupPolicyAcceptances.rowCount ?? 0,
    reviewerAccessRowsAnonymized: (grants.rowCount ?? 0) + (redemptions.rowCount ?? 0),
    reviewerAcceptancesDeleted: acceptances.rowCount ?? 0,
    tombstonePrincipalId,
  };
}

async function eraseServiceIdentityReferences(
  client: PoolClient,
  input: {
    now: Date;
    principalId: string;
    receiptDigest: string;
    tombstonePrincipalId: string;
  },
): Promise<ServiceIdentityErasureEvidence> {
  const actorTombstone = `deleted-actor:${digest(`service-actor:${input.receiptDigest}`)}`;
  const mediaOwnerTombstone = `deleted-media:${digest(`public-media:${input.receiptDigest}`)}`;
  const agents = await client.query(
    `UPDATE tokenless_agents
     SET owner_account_address=CASE WHEN owner_account_address=$1 THEN $2 ELSE owner_account_address END,
         created_by=CASE WHEN created_by=$1 THEN $3 ELSE created_by END,
         status=CASE WHEN owner_account_address=$1 THEN 'inactive' ELSE status END,
         deactivated_at=CASE WHEN owner_account_address=$1 THEN COALESCE(deactivated_at,$4) ELSE deactivated_at END,
         updated_at=$4
     WHERE owner_account_address=$1 OR created_by=$1`,
    [input.principalId, input.tombstonePrincipalId, actorTombstone, input.now],
  );
  const agentVersions = await client.query("UPDATE tokenless_agent_versions SET created_by=$1 WHERE created_by=$2", [
    actorTombstone,
    input.principalId,
  ]);
  const agentAuditEvents = await client.query(
    `UPDATE tokenless_agent_audit_events
     SET actor_account_address=CASE WHEN actor_account_address=$1 THEN $2 ELSE actor_account_address END,
         details_json=CASE WHEN details_json LIKE '%' || $1 || '%'
           THEN '{"subject":"deleted","retentionBasis":"security_audit"}' ELSE details_json END
     WHERE actor_account_address=$1 OR details_json LIKE '%' || $1 || '%'`,
    [input.principalId, actorTombstone],
  );
  const agentIntegrations = await client.query(
    `UPDATE tokenless_agent_integrations
     SET oauth_subject_principal_id=CASE WHEN oauth_subject_principal_id=$1 THEN $2 ELSE oauth_subject_principal_id END,
         created_by=CASE WHEN created_by=$1 THEN $3 ELSE created_by END,
         status=CASE WHEN oauth_subject_principal_id=$1 THEN 'revoked' ELSE status END,
         revoked_at=CASE WHEN oauth_subject_principal_id=$1 THEN COALESCE(revoked_at,$4) ELSE revoked_at END,
         updated_at=$4
     WHERE oauth_subject_principal_id=$1 OR created_by=$1`,
    [input.principalId, input.tombstonePrincipalId, actorTombstone, input.now],
  );
  const connectionIntents = await client.query(
    `UPDATE tokenless_agent_connection_intents
     SET claimed_subject_principal_id=CASE
           WHEN claimed_subject_principal_id=$1 THEN $2 ELSE claimed_subject_principal_id END,
         created_by=CASE WHEN created_by=$1 THEN $3 ELSE created_by END
     WHERE claimed_subject_principal_id=$1 OR created_by=$1`,
    [input.principalId, input.tombstonePrincipalId, actorTombstone],
  );
  const oversightAttestations = await client.query(
    `UPDATE tokenless_oversight_attestations
     SET account_address=CASE WHEN account_address=$1 THEN $2 ELSE account_address END,
         attested_by=CASE WHEN attested_by=$1 THEN $3 ELSE attested_by END,
         revoked_by=CASE
           WHEN account_address=$1 AND status='active' THEN 'system:account_deletion'
           WHEN revoked_by=$1 THEN $3 ELSE revoked_by END,
         revoked_at=CASE WHEN account_address=$1 AND status='active' THEN $4 ELSE revoked_at END,
         status=CASE WHEN account_address=$1 THEN 'revoked' ELSE status END,
         training_records_json=CASE
           WHEN account_address=$1 OR training_records_json LIKE '%' || $1 || '%' THEN '[]'
           ELSE training_records_json END,
         updated_at=$4
     WHERE account_address=$1 OR attested_by=$1 OR revoked_by=$1
        OR training_records_json LIKE '%' || $1 || '%'`,
    [input.principalId, input.tombstonePrincipalId, actorTombstone, input.now],
  );
  const publicMedia = await client.query(
    `UPDATE tokenless_public_question_media
     SET owner_account_address=$1,
         client_request_id='deleted:' || asset_id,
         original_filename='deleted',
         deletion_requested_at=CASE
           WHEN question_id IS NULL AND technical_status='ready' THEN COALESCE(deletion_requested_at,$2)
           ELSE deletion_requested_at END,
         updated_at=$2
     WHERE owner_account_address=$3`,
    [mediaOwnerTombstone, input.now, input.principalId],
  );
  const publicMediaQuotas = await client.query(
    "DELETE FROM tokenless_public_media_daily_quotas WHERE owner_account_address=$1",
    [input.principalId],
  );
  const mcpSessions = await client.query(
    `UPDATE tokenless_mcp_sessions
     SET subject_principal_id=$1,status='revoked',last_seen_at=$2
     WHERE subject_principal_id=$3`,
    [input.tombstonePrincipalId, input.now, input.principalId],
  );
  const workspaceMoves = await client.query(
    `UPDATE tokenless_agent_workspace_moves
     SET oauth_subject_principal_id=$1,
         target_approved_by=CASE WHEN target_approved_by=$2 THEN $3 ELSE target_approved_by END,
         status=CASE
           WHEN status IN ('source_confirmation_required','owner_approval_required') THEN 'cancelled'
           ELSE status END
     WHERE oauth_subject_principal_id=$2 OR target_approved_by=$2`,
    [input.tombstonePrincipalId, input.principalId, actorTombstone],
  );
  // Governance and agent-configuration objects belong to a workspace that outlives the account, so
  // they are tombstoned rather than deleted: "an authorised person configured this" is worth
  // keeping, the identity is not. Account deletion blocks only on *owned* workspaces, so an admin
  // of someone else's workspace could otherwise leave a stable identifier on every object they
  // created. The hash-chained audit event tables are deliberately excluded — rewriting an actor
  // reference in place would break chain verification for the whole workspace.
  const workspaceGovernanceObjects = await client.query(
    `WITH clients AS (
       UPDATE tokenless_workspace_clients SET created_by=$2 WHERE created_by=$1 RETURNING 1
     ), costCenters AS (
       UPDATE tokenless_workspace_cost_centers SET created_by=$2 WHERE created_by=$1 RETURNING 1
     ), groups AS (
       UPDATE tokenless_private_groups SET created_by=$2 WHERE created_by=$1 RETURNING 1
     ), groupPolicies AS (
       UPDATE tokenless_private_group_policy_versions SET created_by=$2 WHERE created_by=$1 RETURNING 1
     ), reviewerTerms AS (
       UPDATE tokenless_workspace_reviewer_terms_versions SET created_by=$2 WHERE created_by=$1 RETURNING 1
     )
     SELECT (SELECT COUNT(*) FROM clients) + (SELECT COUNT(*) FROM costCenters) + (SELECT COUNT(*) FROM groups)
          + (SELECT COUNT(*) FROM groupPolicies) + (SELECT COUNT(*) FROM reviewerTerms) AS pseudonymized`,
    [input.principalId, actorTombstone],
  );
  const agentPolicyObjects = await client.query(
    `WITH publishing AS (
       UPDATE tokenless_agent_publishing_policies
       SET created_by=CASE WHEN created_by=$1 THEN $2 ELSE created_by END,
           payer_address=CASE WHEN payer_address=$1 THEN NULL ELSE payer_address END
       WHERE created_by=$1 OR payer_address=$1 RETURNING 1
     ), reviewPolicies AS (
       UPDATE tokenless_agent_review_policies
       SET created_by=CASE WHEN created_by=$1 THEN $2 ELSE created_by END,
           approved_by=CASE WHEN approved_by=$1 THEN $2 ELSE approved_by END
       WHERE created_by=$1 OR approved_by=$1 RETURNING 1
     ), requestProfiles AS (
       UPDATE tokenless_agent_review_request_profiles
       SET created_by=CASE WHEN created_by=$1 THEN $2 ELSE created_by END,
           approved_by=CASE WHEN approved_by=$1 THEN $2 ELSE approved_by END
       WHERE created_by=$1 OR approved_by=$1 RETURNING 1
     ), reviewBindings AS (
       UPDATE tokenless_agent_human_review_bindings
       SET created_by=CASE WHEN created_by=$1 THEN $2 ELSE created_by END,
           approved_by=CASE WHEN approved_by=$1 THEN $2 ELSE approved_by END
       WHERE created_by=$1 OR approved_by=$1 RETURNING 1
     ), pairingSessions AS (
       UPDATE tokenless_agent_pairing_sessions SET created_by=$2 WHERE created_by=$1 RETURNING 1
     ), apiKeys AS (
       UPDATE tokenless_workspace_api_keys SET wallet_address=NULL WHERE wallet_address=$1 RETURNING 1
     )
     SELECT (SELECT COUNT(*) FROM publishing) + (SELECT COUNT(*) FROM reviewPolicies)
          + (SELECT COUNT(*) FROM requestProfiles) + (SELECT COUNT(*) FROM reviewBindings)
          + (SELECT COUNT(*) FROM pairingSessions) + (SELECT COUNT(*) FROM apiKeys) AS pseudonymized`,
    [input.principalId, actorTombstone],
  );
  return {
    agentAuditEventsPseudonymized: agentAuditEvents.rowCount ?? 0,
    agentIntegrationsPseudonymized: agentIntegrations.rowCount ?? 0,
    agentVersionsPseudonymized: agentVersions.rowCount ?? 0,
    agentsPseudonymized: agents.rowCount ?? 0,
    connectionIntentsPseudonymized: connectionIntents.rowCount ?? 0,
    mcpSessionsPseudonymized: mcpSessions.rowCount ?? 0,
    oversightAttestationsPseudonymized: oversightAttestations.rowCount ?? 0,
    publicMediaPseudonymized: publicMedia.rowCount ?? 0,
    publicMediaQuotasErased: publicMediaQuotas.rowCount ?? 0,
    agentPolicyObjectsPseudonymized: Number((agentPolicyObjects.rows[0] as Row | undefined)?.pseudonymized ?? 0),
    workspaceGovernanceObjectsPseudonymized: Number(
      (workspaceGovernanceObjects.rows[0] as Row | undefined)?.pseudonymized ?? 0,
    ),
    workspaceMovesPseudonymized: workspaceMoves.rowCount ?? 0,
  };
}

async function eraseOauthAuthorizationIdentity(
  client: PoolClient,
  input: {
    now: Date;
    principalId: string;
    tombstonePrincipalId: string;
  },
): Promise<OauthAuthorizationErasureEvidence> {
  const accessTokens = await client.query(
    `UPDATE tokenless_agent_oauth_access_tokens
     SET subject_principal_id=$1,revoked_at=COALESCE(revoked_at,$2),
         revocation_reason=COALESCE(revocation_reason,'account_deleted')
     WHERE subject_principal_id=$3`,
    [input.tombstonePrincipalId, input.now, input.principalId],
  );
  const refreshTokens = await client.query(
    `UPDATE tokenless_agent_oauth_refresh_tokens
     SET subject_principal_id=$1,revoked_at=COALESCE(revoked_at,$2),
         revocation_reason=COALESCE(revocation_reason,'account_deleted')
     WHERE subject_principal_id=$3`,
    [input.tombstonePrincipalId, input.now, input.principalId],
  );
  const authorizationCodes = await client.query(
    `UPDATE tokenless_agent_oauth_authorization_codes
     SET subject_principal_id=$1,revoked_at=COALESCE(revoked_at,$2)
     WHERE subject_principal_id=$3`,
    [input.tombstonePrincipalId, input.now, input.principalId],
  );
  const tokenFamilies = await client.query(
    `UPDATE tokenless_agent_oauth_token_families
     SET subject_principal_id=$1,status='revoked',revoked_at=COALESCE(revoked_at,$2),
         revoked_by='system:account_deletion',revocation_reason='account_deleted'
     WHERE subject_principal_id=$3`,
    [input.tombstonePrincipalId, input.now, input.principalId],
  );
  const deviceAuthorizations = await client.query(
    `UPDATE tokenless_agent_oauth_device_authorizations
     SET status=CASE WHEN status='approved' THEN 'denied' ELSE status END,
         approved_by_principal_id=CASE WHEN status='approved' THEN NULL ELSE $1 END,
         approved_at=CASE WHEN status='approved' THEN NULL ELSE approved_at END,
         denied_at=CASE WHEN status='approved' THEN $2 ELSE denied_at END,
         updated_at=$2
     WHERE approved_by_principal_id=$3`,
    [input.tombstonePrincipalId, input.now, input.principalId],
  );
  return {
    accessTokensPseudonymized: accessTokens.rowCount ?? 0,
    authorizationCodesPseudonymized: authorizationCodes.rowCount ?? 0,
    deviceAuthorizationsPseudonymized: deviceAuthorizations.rowCount ?? 0,
    refreshTokensPseudonymized: refreshTokens.rowCount ?? 0,
    tokenFamiliesPseudonymized: tokenFamilies.rowCount ?? 0,
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
    ["service_identity_references", "anonymize", "completed", null, null],
    ["oauth_authorization_records", "anonymize", "completed", null, null],
    ["eligibility_handoffs", "erase", "completed", null, null],
    ["world_id_and_rater_linkage", "erase", "completed", null, null],
    ["private_quote_plaintext_payloads", "erase", "completed", null, null],
    ["subject_export_payloads", "erase", "completed", null, null],
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
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'system:account_deletion', $9)`,
    [
      id("dsrc"),
      input.requestId,
      JSON.stringify([
        "account_authentication",
        "contact_and_preferences",
        "shared_workspace_access",
        "hybrid_network_reviewer_exclusions",
        "eligibility_handoffs",
        "world_id_and_rater_linkage",
        "private_quote_plaintext_payloads",
        "subject_export_payloads",
      ]),
      JSON.stringify(["service_identity_references", "oauth_authorization_records"]),
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

async function anonymizeNetworkRaterCopies(
  client: PoolClient,
  input: {
    erasedAccount: string;
    now: Date;
    originalAccount: string;
    raterId: string;
    receiptDigest: string;
  },
): Promise<RaterErasureEvidence["networkCopiesErasure"]> {
  const assignments = await client.query(
    `SELECT assignment_id,project_id,cohort_id,status,assurance_snapshot_hash,
            integrity_provenance_hash
     FROM tokenless_assurance_assignments
     WHERE source='rateloop_network' AND rater_id=$1
     ORDER BY assignment_id FOR UPDATE`,
    [input.raterId],
  );
  const liveAssignment = assignments.rows.find(value =>
    ["reserved", "accepted"].includes(String((value as Row).status ?? "")),
  );
  if (liveAssignment) {
    throw new TokenlessServiceError(
      "Network review work changed while the account was being deleted. Try again after it reaches a terminal state.",
      409,
      "accepted_assignments_require_completion",
    );
  }

  let assignmentsAnonymized = 0;
  let assignmentHistoryAnonymized = 0;
  for (const value of assignments.rows) {
    const row = value as Row;
    const assignmentId = String(row.assignment_id);
    await client.query(
      `INSERT INTO tokenless_assurance_cohort_reviewers
       (project_id,cohort_id,reviewer_account_address,qualification_provenance_json,
        qualification_expires_at,maximum_active_assignments,active_reservations,status,
        network_managed,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,'{"subject":"deleted"}',$4,1,0,'removed',true,
               'system:account_deletion',$4,$4)
       ON CONFLICT (project_id,cohort_id,reviewer_account_address) DO NOTHING`,
      [row.project_id, row.cohort_id, input.erasedAccount, input.now],
    );
    const assuranceSnapshot = JSON.stringify({
      schemaVersion: "rateloop.erased-assurance-snapshot.v1",
      snapshotCommitment: String(row.assurance_snapshot_hash),
    });
    const integrityProvenance =
      row.integrity_provenance_hash === null || row.integrity_provenance_hash === undefined
        ? null
        : JSON.stringify({
            schemaVersion: "rateloop.erased-integrity-provenance.v1",
            provenanceCommitment: String(row.integrity_provenance_hash),
          });
    const updated = await client.query(
      `UPDATE tokenless_assurance_assignments
       SET reviewer_account_address=$1,
           payout_account_snapshot=CASE WHEN paid_assignment=true THEN $1 ELSE NULL END,
           qualification_provenance_json='[]',assurance_snapshot_json=$2,
           blinding_json='{"subject":"deleted"}',integrity_reviewer_lookup=NULL,
           integrity_cluster_pseudonym=NULL,integrity_risk_band=NULL,
           provider_subject_hashes_json=CASE
             WHEN provider_subject_hashes_json IS NULL THEN NULL ELSE '[]' END,
           integrity_provenance_json=$3,updated_at=$4
       WHERE assignment_id=$5 AND source='rateloop_network' AND rater_id=$6`,
      [input.erasedAccount, assuranceSnapshot, integrityProvenance, input.now, assignmentId, input.raterId],
    );
    assignmentsAnonymized += updated.rowCount ?? 0;

    const historyReviewer = `deleted-reviewer:${digest(
      `${input.receiptDigest}:network-history-reviewer:${assignmentId}`,
    ).slice(0, 48)}`;
    const historyCluster = `deleted-cluster:${digest(
      `${input.receiptDigest}:network-history-cluster:${assignmentId}`,
    ).slice(0, 48)}`;
    const history = await client.query(
      `UPDATE tokenless_integrity_assignment_history
       SET reviewer_lookup=$1,cluster_pseudonym=$2,provider_subject_hashes_json='[]'
       WHERE assignment_id=$3`,
      [historyReviewer, historyCluster, assignmentId],
    );
    assignmentHistoryAnonymized += history.rowCount ?? 0;
  }

  const voucherSnapshots = await client.query(
    `SELECT voucher_id,snapshot_hash FROM tokenless_voucher_assurance_snapshots
     WHERE rater_id=$1 AND reviewer_source='rateloop_network' FOR UPDATE`,
    [input.raterId],
  );
  let voucherSnapshotsAnonymized = 0;
  for (const value of voucherSnapshots.rows) {
    const row = value as Row;
    const updated = await client.query(
      `UPDATE tokenless_voucher_assurance_snapshots SET snapshot_json=$1
       WHERE voucher_id=$2 AND rater_id=$3`,
      [
        JSON.stringify({
          schemaVersion: "rateloop.erased-voucher-assurance-snapshot.v1",
          snapshotCommitment: String(row.snapshot_hash),
        }),
        row.voucher_id,
        input.raterId,
      ],
    );
    voucherSnapshotsAnonymized += updated.rowCount ?? 0;
  }

  const staleMemberships = await client.query(
    `SELECT COUNT(*) AS count FROM tokenless_assurance_cohort_reviewers
     WHERE reviewer_account_address=$1 AND network_managed=true AND active_reservations<>0`,
    [input.originalAccount],
  );
  if (rowNumber(staleMemberships.rows[0] as Row | undefined, "count") !== 0) {
    throw new Error("Account deletion found live capacity on a network-managed membership.");
  }
  const deletedMemberships = await client.query(
    `DELETE FROM tokenless_assurance_cohort_reviewers
     WHERE reviewer_account_address=$1 AND network_managed=true AND active_reservations=0`,
    [input.originalAccount],
  );
  const postconditions = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM tokenless_assurance_cohort_reviewers
        WHERE reviewer_account_address=$1 AND network_managed=true) AS original_memberships,
       (SELECT COUNT(*) FROM tokenless_assurance_assignments
        WHERE source='rateloop_network' AND rater_id=$2
          AND (reviewer_account_address=$1 OR payout_account_snapshot=$1
            OR qualification_provenance_json<>'[]'
            OR assurance_snapshot_json NOT LIKE '%rateloop.erased-assurance-snapshot.v1%'
            OR blinding_json<>'{"subject":"deleted"}'
            OR integrity_reviewer_lookup IS NOT NULL
            OR integrity_cluster_pseudonym IS NOT NULL
            OR integrity_risk_band IS NOT NULL
            OR COALESCE(provider_subject_hashes_json,'[]')<>'[]'
            OR (integrity_provenance_hash IS NOT NULL
              AND COALESCE(integrity_provenance_json,'')
                NOT LIKE '%rateloop.erased-integrity-provenance.v1%')))
         AS assignment_direct_copies,
       (SELECT COUNT(*) FROM tokenless_integrity_assignment_history history
        JOIN tokenless_assurance_assignments assignment
          ON assignment.assignment_id=history.assignment_id
        WHERE assignment.source='rateloop_network' AND assignment.rater_id=$2
          AND (history.reviewer_lookup NOT LIKE 'deleted-reviewer:%'
            OR history.cluster_pseudonym NOT LIKE 'deleted-cluster:%'
            OR history.provider_subject_hashes_json<>'[]')) AS history_direct_copies,
       (SELECT COUNT(*) FROM tokenless_voucher_assurance_snapshots
        WHERE rater_id=$2 AND reviewer_source='rateloop_network'
          AND snapshot_json NOT LIKE '%rateloop.erased-voucher-assurance-snapshot.v1%')
         AS voucher_snapshot_direct_copies,
       (SELECT COUNT(*) FROM tokenless_assurance_cohort_reviewers
        WHERE reviewer_account_address=$3 AND network_managed=true
          AND status='removed' AND qualification_provenance_json='{"subject":"deleted"}')
         AS tombstone_memberships`,
    [input.originalAccount, input.raterId, input.erasedAccount],
  );
  const postcondition = postconditions.rows[0] as Row | undefined;
  const remainingDirectCopies =
    rowNumber(postcondition, "original_memberships") +
    rowNumber(postcondition, "assignment_direct_copies") +
    rowNumber(postcondition, "history_direct_copies") +
    rowNumber(postcondition, "voucher_snapshot_direct_copies");
  if (remainingDirectCopies !== 0 || assignmentsAnonymized !== (assignments.rowCount ?? 0)) {
    throw new Error("Account deletion network-copy erasure postcondition failed.");
  }
  return {
    assignmentsAnonymized,
    assignmentHistoryAnonymized,
    materializedMembershipsDeleted: deletedMemberships.rowCount ?? 0,
    tombstoneMembershipsRetained: rowNumber(postcondition, "tombstone_memberships"),
    voucherSnapshotsAnonymized,
    remainingDirectCopies,
  };
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
      integrityEpochMemberships: 0,
      reviewerQualifications: 0,
      sanctionsScreenings: 0,
      paidEligibilityRiskChecks: 0,
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
      integrityEpochMemberships: 0,
      reviewerQualifications: 0,
      sanctionsScreenings: 0,
      paidEligibilityRiskChecks: 0,
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
      networkSettlementCommitments: 0,
      sanctionsMatches: 0,
      dac7Records: 0,
    },
    retainedPaidVouchers: 0,
    networkCopiesErasure: {
      assignmentsAnonymized: 0,
      assignmentHistoryAnonymized: 0,
      materializedMembershipsDeleted: 0,
      tombstoneMembershipsRetained: 0,
      voucherSnapshotsAnonymized: 0,
      remainingDirectCopies: 0,
    },
    tombstoneReceiptHash: null,
    tombstoneWritten: false,
  };
  const rater = await client.query(
    `SELECT rater_id,account_address FROM tokenless_rater_profiles WHERE principal_id = $1 LIMIT 1 FOR UPDATE`,
    [principalId],
  );
  const raterRow = rater.rows[0] as { rater_id?: unknown; account_address?: unknown } | undefined;
  const raterId = String(raterRow?.rater_id ?? "");
  if (!raterId) return emptyEvidence;
  const originalAccount = String(raterRow?.account_address ?? "");
  const erasedAccount = `0x${digest(`deleted-rater-payout:${receiptDigest}`).slice(0, 40)}`;
  const integrityErasure = await eraseIntegrityEpochReviewerMemberships(client, {
    reviewerId: originalAccount,
  });
  const networkCopiesErasure = await anonymizeNetworkRaterCopies(client, {
    erasedAccount,
    now,
    originalAccount,
    raterId,
    receiptDigest,
  });

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
  const legalEligibility = await client.query(`DELETE FROM tokenless_legal_eligibility WHERE rater_id = $1`, [raterId]);
  const paidEligibilityRiskChecks = await client.query(
    `DELETE FROM tokenless_paid_eligibility_risk_checks WHERE rater_id = $1`,
    [raterId],
  );
  const paidEligibilityScopes = await client.query(
    `DELETE FROM tokenless_paid_eligibility_scopes WHERE rater_id = $1`,
    [raterId],
  );
  const sanctionsScreenings = await client.query(
    `DELETE FROM tokenless_sanctions_screenings WHERE rater_id = $1 AND status <> 'match'`,
    [raterId],
  );
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
       (SELECT COUNT(*) FROM tokenless_paid_eligibility_risk_checks WHERE rater_id = $1)
         AS paid_eligibility_risk_checks,
       (SELECT COUNT(*) FROM tokenless_sanctions_screenings WHERE rater_id = $1 AND status <> 'match')
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
         AS retained_voucher_assurance_snapshots,
       (SELECT COUNT(*) FROM tokenless_network_assignment_settlements settlement
        JOIN tokenless_assurance_assignments assignment
          ON assignment.assignment_id=settlement.assignment_id
       WHERE assignment.rater_id=$1)
         AS retained_network_settlement_commitments,
       (SELECT COUNT(*) FROM tokenless_sanctions_blocks WHERE rater_id=$1)
         AS retained_sanctions_matches,
       (SELECT COUNT(*) FROM tokenless_dac7_records WHERE rater_id=$1)
         AS retained_dac7_records`,
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
      integrityEpochMemberships: integrityErasure.erased,
      reviewerQualifications: reviewerQualifications.rowCount ?? 0,
      sanctionsScreenings: sanctionsScreenings.rowCount ?? 0,
      paidEligibilityRiskChecks: paidEligibilityRiskChecks.rowCount ?? 0,
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
      integrityEpochMemberships: integrityErasure.remaining,
      reviewerQualifications: rowNumber(row, "reviewer_qualifications"),
      sanctionsScreenings: rowNumber(row, "sanctions_screenings"),
      paidEligibilityRiskChecks: rowNumber(row, "paid_eligibility_risk_checks"),
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
      networkSettlementCommitments: rowNumber(row, "retained_network_settlement_commitments"),
      sanctionsMatches: rowNumber(row, "retained_sanctions_matches"),
      dac7Records: rowNumber(row, "retained_dac7_records"),
    },
    retainedPaidVouchers: rowNumber(row, "retained_paid_vouchers"),
    networkCopiesErasure,
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
    hybridNetworkExclusionErasure: HybridNetworkExclusionErasureEvidence;
    oauthAuthorizationErasure: OauthAuthorizationErasureEvidence;
    releasedReservations: ReleasedReservationEvidence;
    serviceIdentityErasure: ServiceIdentityErasureEvidence;
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
          WHERE subject_principal_id = $1) AS oauth_access_token_identity_links,
       (SELECT COUNT(*) FROM tokenless_agent_oauth_refresh_tokens
          WHERE subject_principal_id = $1) AS oauth_refresh_token_identity_links,
       (SELECT COUNT(*) FROM tokenless_agent_oauth_authorization_codes
          WHERE subject_principal_id = $1) AS oauth_authorization_code_identity_links,
       (SELECT COUNT(*) FROM tokenless_agent_oauth_token_families
          WHERE subject_principal_id = $1) AS oauth_token_family_identity_links,
       (SELECT COUNT(*) FROM tokenless_agent_oauth_device_authorizations
          WHERE approved_by_principal_id = $1) AS oauth_device_authorization_identity_links,
       (SELECT COUNT(*) FROM tokenless_agent_integrations
          WHERE oauth_subject_principal_id = $1 AND status = 'active') AS active_agent_integrations,
       (SELECT COUNT(*) FROM tokenless_better_auth_users WHERE id = $2) AS better_auth_users,
       (SELECT COUNT(*) FROM tokenless_browser_identities WHERE principal_address = $1) AS browser_identities,
       (SELECT COUNT(*) FROM tokenless_subject_request_exports WHERE principal_id = $1)
         AS subject_request_export_payloads,
       (SELECT COUNT(*) FROM tokenless_workspace_members WHERE account_address = $1) AS workspace_memberships,
       (SELECT COUNT(*) FROM tokenless_workspace_member_clients WHERE account_address = $1) AS workspace_clients,
       (SELECT COUNT(*) FROM tokenless_workspace_member_governance WHERE account_address = $1)
         AS workspace_governance,
       (SELECT COUNT(*) FROM tokenless_project_access_assignments
          WHERE subject_kind IN ('account','principal') AND subject_reference = $1 AND status = 'active')
         AS active_project_access,
       (SELECT COUNT(*) FROM tokenless_eligibility_provider_handoffs WHERE principal_id = $1)
         AS eligibility_handoffs,
       (SELECT COUNT(*) FROM tokenless_paid_eligibility_decisions WHERE principal_id = $1)
         AS paid_eligibility_decisions,
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
         AS paid_assignment_seat_direct_identities,
       (SELECT COUNT(*) FROM tokenless_network_assignment_settlements settlement
        JOIN tokenless_assurance_assignments assignment
          ON assignment.assignment_id=settlement.assignment_id
       JOIN tokenless_rater_profiles profile ON profile.rater_id=assignment.rater_id
        WHERE profile.principal_id=$1) AS network_settlement_principal_links,
       (SELECT COUNT(*) FROM tokenless_hybrid_network_reviewer_exclusions
        WHERE reviewer_principal_id=$1) AS hybrid_network_exclusion_identity_links,
       (SELECT COUNT(*) FROM tokenless_agents
        WHERE owner_account_address=$1 OR created_by=$1) AS agent_identity_links,
       (SELECT COUNT(*) FROM tokenless_agent_versions
        WHERE created_by=$1) AS agent_version_identity_links,
       (SELECT COUNT(*) FROM tokenless_agent_audit_events
        WHERE actor_account_address=$1 OR details_json LIKE '%' || $1 || '%') AS agent_audit_identity_links,
       (SELECT COUNT(*) FROM tokenless_agent_integrations
        WHERE oauth_subject_principal_id=$1 OR created_by=$1) AS agent_integration_identity_links,
       (SELECT COUNT(*) FROM tokenless_agent_connection_intents
        WHERE claimed_subject_principal_id=$1 OR created_by=$1) AS connection_intent_identity_links,
       (SELECT COUNT(*) FROM tokenless_oversight_attestations
        WHERE account_address=$1 OR attested_by=$1 OR revoked_by=$1
           OR training_records_json LIKE '%' || $1 || '%') AS oversight_identity_links,
       (SELECT COUNT(*) FROM tokenless_public_question_media
        WHERE owner_account_address=$1) AS public_media_identity_links,
       (SELECT COUNT(*) FROM tokenless_public_media_daily_quotas
        WHERE owner_account_address=$1) AS public_media_quota_identity_links,
       (SELECT COUNT(*) FROM tokenless_mcp_sessions
        WHERE subject_principal_id=$1) AS mcp_session_identity_links,
       (SELECT COUNT(*) FROM tokenless_agent_workspace_moves
        WHERE oauth_subject_principal_id=$1 OR target_approved_by=$1) AS workspace_move_identity_links`,
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
    hybrid_network_reviewer_exclusions: input.hybridNetworkExclusionErasure,
    service_identity_references: input.serviceIdentityErasure,
    oauth_authorization_records: input.oauthAuthorizationErasure,
    eligibility_handoffs: {
      eligibilityHandoffs: rowNumber(row, "eligibility_handoffs"),
      paidEligibilityDecisions: rowNumber(row, "paid_eligibility_decisions"),
      managedWalletJtis: rowNumber(row, "managed_wallet_jtis"),
      payoutWalletOwnership: rowNumber(row, "payout_wallet_ownership"),
      passkeyActionProofs: rowNumber(row, "passkey_action_proofs"),
      recentAccountActionProofs: rowNumber(row, "recent_account_action_proofs"),
      walletBindings: rowNumber(row, "wallet_bindings"),
      walletChallenges: rowNumber(row, "wallet_challenges"),
    },
    world_id_and_rater_linkage: {
      deletedRows: input.raterErasure.deletedRows,
      networkCopiesErasure: input.raterErasure.networkCopiesErasure,
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
    subject_export_payloads: {
      remainingExportPayloads: rowNumber(row, "subject_request_export_payloads"),
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
      networkReviewerLinkageRetention:
        input.raterErasure.retainedRaterRows.networkSettlementCommitments > 0
          ? {
              form: "one_way_assignment_scoped_commitment",
              basis: "settlement_integrity_and_legal_claims",
              directPrincipalLinkRetained: false,
            }
          : null,
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
    agentAuditIdentityLinks: rowNumber(row, "agent_audit_identity_links"),
    agentIdentityLinks: rowNumber(row, "agent_identity_links"),
    agentIntegrationIdentityLinks: rowNumber(row, "agent_integration_identity_links"),
    agentVersionIdentityLinks: rowNumber(row, "agent_version_identity_links"),
    activeAuthSessions: rowNumber(row, "active_auth_sessions"),
    activeIdentityBindings: rowNumber(row, "active_identity_bindings"),
    oauthAccessTokenIdentityLinks: rowNumber(row, "oauth_access_token_identity_links"),
    oauthAuthorizationCodeIdentityLinks: rowNumber(row, "oauth_authorization_code_identity_links"),
    oauthDeviceAuthorizationIdentityLinks: rowNumber(row, "oauth_device_authorization_identity_links"),
    oauthRefreshTokenIdentityLinks: rowNumber(row, "oauth_refresh_token_identity_links"),
    oauthTokenFamilyIdentityLinks: rowNumber(row, "oauth_token_family_identity_links"),
    activeProjectAccess: rowNumber(row, "active_project_access"),
    betterAuthUsers: rowNumber(row, "better_auth_users"),
    betterAuthVerifications,
    browserIdentities: rowNumber(row, "browser_identities"),
    connectionIntentIdentityLinks: rowNumber(row, "connection_intent_identity_links"),
    eligibilityHandoffs: rowNumber(row, "eligibility_handoffs"),
    paidEligibilityDecisions: rowNumber(row, "paid_eligibility_decisions"),
    managedWalletJtis: rowNumber(row, "managed_wallet_jtis"),
    payoutWalletOwnership: rowNumber(row, "payout_wallet_ownership"),
    paidAssignmentSeatDirectIdentities: rowNumber(row, "paid_assignment_seat_direct_identities"),
    networkRaterDirectCopies: input.raterErasure.networkCopiesErasure.remainingDirectCopies,
    networkSettlementPrincipalLinks: rowNumber(row, "network_settlement_principal_links"),
    hybridNetworkExclusionIdentityLinks: rowNumber(row, "hybrid_network_exclusion_identity_links"),
    mcpSessionIdentityLinks: rowNumber(row, "mcp_session_identity_links"),
    oversightIdentityLinks: rowNumber(row, "oversight_identity_links"),
    passkeyActionProofs: rowNumber(row, "passkey_action_proofs"),
    recentAccountActionProofs: rowNumber(row, "recent_account_action_proofs"),
    privateQuoteOwnerLinks: input.privateQuoteErasure.remainingDirectOwnerLinks,
    publicMediaIdentityLinks: rowNumber(row, "public_media_identity_links"),
    publicMediaQuotaIdentityLinks: rowNumber(row, "public_media_quota_identity_links"),
    subjectRequestExportPayloads: rowNumber(row, "subject_request_export_payloads"),
    walletBindings: rowNumber(row, "wallet_bindings"),
    walletChallenges: rowNumber(row, "wallet_challenges"),
    workspaceClients: rowNumber(row, "workspace_clients"),
    workspaceGovernance: rowNumber(row, "workspace_governance"),
    workspaceMemberships: rowNumber(row, "workspace_memberships"),
    workspaceMoveIdentityLinks: rowNumber(row, "workspace_move_identity_links"),
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
    throw new TokenlessServiceError(
      "Type DELETE to confirm account deletion.",
      400,
      "account_deletion_unconfirmed",
      false,
      "confirmation",
    );
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
    // Network selection locks the same profile rows before materializing a
    // membership/assignment. Holding this lock through commit prevents a
    // selector from resurrecting a deleted subject after the erasure sweep.
    await lockRaterProfileForDeletion(client, input.principalId);
    const releasedReservations = await releaseReservedAssignments(client, input.principalId, now);
    await releaseSelectedNetworkAssignmentsForAccountDeletion(client, {
      principalId: input.principalId,
      receiptDigest,
      now,
    });
    const hybridNetworkExclusionErasure = await eraseHybridNetworkReviewerExclusions(client, input.principalId);

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
      `UPDATE tokenless_agent_connection_intents
       SET status = 'cancelled', cancelled_at = $1, last_transition_at = $1,
           last_transition_reason = 'account_deleted'
       WHERE claimed_subject_principal_id = $2
         AND status NOT IN ('rejected','expired','cancelled')`,
      [now, input.principalId],
    );
    const serviceIdentityErasure = await eraseServiceIdentityReferences(client, {
      now,
      principalId: input.principalId,
      receiptDigest,
      tombstonePrincipalId: directAccessErasure.tombstonePrincipalId,
    });
    const oauthAuthorizationErasure = await eraseOauthAuthorizationIdentity(client, {
      now,
      principalId: input.principalId,
      tombstonePrincipalId: directAccessErasure.tombstonePrincipalId,
    });
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
    await client.query(`DELETE FROM tokenless_paid_eligibility_decisions WHERE principal_id = $1`, [input.principalId]);
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
    // A completed access or export request leaves the subject's whole record as plaintext JSON
    // for seven days. The deletion receipt is only honest if that copy goes with the account.
    await client.query(`DELETE FROM tokenless_subject_request_exports WHERE principal_id = $1`, [input.principalId]);
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
      hybridNetworkExclusionErasure,
      releasedReservations,
      serviceIdentityErasure,
      oauthAuthorizationErasure,
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
      releasedReservations: releasedReservations.total,
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
