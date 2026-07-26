import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import { verifySecurityAuditChain } from "~~/lib/privacy/audit";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { recordPrivacyWorkerFailure } from "~~/lib/privacy/privacyWorkerFailures";
import { listPrincipalForecastIntegrityInTransaction } from "~~/lib/tokenless/crowdForecastPersistence";
import { authorizeProjectAccount } from "~~/lib/tokenless/projectAccess";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const SUBJECT_REQUEST_TYPES = [
  "access",
  "correction",
  "restriction",
  "objection",
  "export",
  "deletion",
] as const;
export type SubjectRequestType = (typeof SUBJECT_REQUEST_TYPES)[number];
export const SELF_SERVICE_SUBJECT_REQUEST_TYPES = ["access", "export"] as const satisfies readonly SubjectRequestType[];
export type SelfServiceSubjectRequestType = (typeof SELF_SERVICE_SUBJECT_REQUEST_TYPES)[number];
export const SUBJECT_REQUEST_STATUSES = [
  "received",
  "identity_verified",
  "in_progress",
  "blocked_by_hold",
  "blocked_by_funds",
  "completed",
  "denied",
] as const;
export type SubjectRequestStatus = (typeof SUBJECT_REQUEST_STATUSES)[number];

const TRANSITIONS = new Map<SubjectRequestStatus, ReadonlySet<SubjectRequestStatus>>([
  ["received", new Set(["identity_verified", "denied"])],
  ["identity_verified", new Set(["in_progress", "denied"])],
  ["in_progress", new Set(["blocked_by_hold", "blocked_by_funds", "completed", "denied"])],
  ["blocked_by_hold", new Set(["in_progress", "completed", "denied"])],
  ["blocked_by_funds", new Set(["in_progress", "completed", "denied"])],
  ["completed", new Set()],
  ["denied", new Set()],
]);
const SUBJECT_EXPORT_RETENTION_MS = 7 * 86_400_000;

type QueryRow = Record<string, unknown>;

function rowDate(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function required(value: string, field: string, max = 500) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_privacy_request");
  }
  return normalized;
}

export async function createLegalHold(input: {
  accountAddress: string;
  projectId: string;
  reason: string;
  reviewAt: Date;
  scope?: string;
  workspaceId: string;
  now?: Date;
}) {
  const manager = await authorizeProjectAccount({
    accountAddress: input.accountAddress,
    action: "manage",
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  });
  const now = input.now ?? new Date();
  if (input.reviewAt <= now || input.reviewAt.getTime() - now.getTime() > 365 * 86_400_000) {
    throw new TokenlessServiceError("Legal holds require a review within one year.", 400, "invalid_legal_hold_review");
  }
  const holdId = `hold_${randomUUID().replaceAll("-", "")}`;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT workspace_id FROM tokenless_workspaces WHERE workspace_id = $1 FOR UPDATE", [
      input.workspaceId,
    ]);
    await client.query(
      `INSERT INTO tokenless_legal_holds
       (hold_id, workspace_id, project_id, scope, reason, status, created_by, created_at, review_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)`,
      [
        holdId,
        input.workspaceId,
        input.projectId,
        required(input.scope ?? "project", "Hold scope", 120),
        required(input.reason, "Hold reason"),
        manager.accountReference,
        now,
        input.reviewAt,
      ],
    );
    await client.query(
      "UPDATE tokenless_assurance_projects SET legal_hold_state = 'active', updated_at = $1 WHERE project_id = $2 AND workspace_id = $3",
      [now, input.projectId, input.workspaceId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await appendAuditEvent({
    action: "privacy.legal_hold_created",
    actorKind: "account",
    actorReference: manager.accountReference,
    assuranceMethod: "rateloop_session",
    metadata: { holdId, projectId: input.projectId, reviewAt: input.reviewAt.toISOString() },
    purpose: "legal_hold",
    reason: input.reason,
    result: "success",
    targetId: holdId,
    targetKind: "legal_hold",
    workspaceId: input.workspaceId,
  });
  return { holdId, reviewAt: input.reviewAt.toISOString() };
}

export async function releaseLegalHold(input: {
  accountAddress: string;
  holdId: string;
  projectId: string;
  reason: string;
  workspaceId: string;
  now?: Date;
}) {
  const manager = await authorizeProjectAccount({
    accountAddress: input.accountAddress,
    action: "manage",
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  });
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT workspace_id FROM tokenless_workspaces WHERE workspace_id = $1 FOR UPDATE", [
      input.workspaceId,
    ]);
    const released = await client.query(
      `UPDATE tokenless_legal_holds
       SET status = 'released', released_by = $1, released_at = $2, release_reason = $3
       WHERE hold_id = $4 AND workspace_id = $5 AND project_id = $6 AND status = 'active'`,
      [
        manager.accountReference,
        now,
        required(input.reason, "Release reason"),
        input.holdId,
        input.workspaceId,
        input.projectId,
      ],
    );
    if (released.rowCount !== 1) {
      throw new TokenlessServiceError("Legal hold not found.", 404, "legal_hold_not_found");
    }
    await client.query(
      `UPDATE tokenless_assurance_projects SET legal_hold_state = 'none', updated_at = $1
       WHERE project_id = $2 AND workspace_id = $3
         AND NOT EXISTS (SELECT 1 FROM tokenless_legal_holds WHERE project_id = $2 AND status = 'active')`,
      [now, input.projectId, input.workspaceId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await appendAuditEvent({
    action: "privacy.legal_hold_released",
    actorKind: "account",
    actorReference: manager.accountReference,
    assuranceMethod: "rateloop_session",
    metadata: { holdId: input.holdId, projectId: input.projectId },
    purpose: "legal_hold",
    reason: input.reason,
    result: "success",
    targetId: input.holdId,
    targetKind: "legal_hold",
    workspaceId: input.workspaceId,
  });
}

export async function assertProjectDeletionAllowed(projectId: string, workspaceId: string) {
  const result = await dbClient.execute({
    sql: `SELECT legal_hold_state FROM tokenless_assurance_projects
          WHERE project_id = ? AND workspace_id = ? LIMIT 1`,
    args: [projectId, workspaceId],
  });
  if (rowString(result.rows[0] as QueryRow | undefined, "legal_hold_state") === "active") {
    throw new TokenlessServiceError("Deletion is blocked by an active legal hold.", 409, "deletion_blocked_by_hold");
  }
}

export async function createSubjectRequest(input: {
  identityAssurance: string;
  principalId: string;
  requestType: SelfServiceSubjectRequestType;
  scope: Record<string, unknown>;
  workspaceId?: string | null;
  now?: Date;
}) {
  if (!SELF_SERVICE_SUBJECT_REQUEST_TYPES.includes(input.requestType)) {
    throw new TokenlessServiceError("Subject request type is invalid.", 400, "invalid_privacy_request");
  }
  const principalId = required(input.principalId, "Principal", 120);
  const now = input.now ?? new Date();
  const requestId = `dsr_${randomUUID().replaceAll("-", "")}`;
  const dueAt = new Date(now.getTime() + 30 * 86_400_000);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tokenless_subject_requests
       (request_id, principal_id, workspace_id, request_type, status, scope_json, identity_assurance, received_at, due_at)
       VALUES ($1, $2, $3, $4, 'received', $5, $6, $7, $8)`,
      [
        requestId,
        principalId,
        input.workspaceId ?? null,
        input.requestType,
        JSON.stringify(input.scope),
        required(input.identityAssurance, "Identity assurance", 120),
        now,
        dueAt,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_subject_request_events
       (event_id, request_id, from_status, to_status, actor_reference, reason, created_at)
       VALUES ($1, $2, NULL, 'received', $3, 'request_received', $4)`,
      [`dsre_${randomUUID().replaceAll("-", "")}`, requestId, principalId, now],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (input.workspaceId) {
    await appendAuditEvent({
      action: "privacy.subject_request_received",
      actorKind: "principal",
      actorReference: principalId,
      assuranceMethod: input.identityAssurance,
      metadata: { requestType: input.requestType },
      purpose: "data_subject_rights",
      reason: "subject_request",
      result: "success",
      targetId: requestId,
      targetKind: "subject_request",
      workspaceId: input.workspaceId,
    });
  }
  return { dueAt: dueAt.toISOString(), requestId };
}

export async function listSubjectRequests(principalId: string, now = new Date()) {
  const result = await dbClient.execute({
    sql: `SELECT requests.request_id,requests.workspace_id,requests.request_type,requests.status,
                 requests.received_at,requests.due_at,requests.completed_at,
                 exports.payload_hash,exports.delete_after
          FROM tokenless_subject_requests requests
          LEFT JOIN tokenless_subject_request_exports exports ON exports.request_id=requests.request_id
          WHERE requests.principal_id=?
          ORDER BY requests.received_at DESC,requests.request_id DESC`,
    args: [required(principalId, "Principal", 120)],
  });
  return result.rows.map(value => {
    const row = value as QueryRow;
    const deleteAfter = rowDate(row, "delete_after");
    return {
      requestId: rowString(row, "request_id"),
      workspaceId: rowString(row, "workspace_id"),
      requestType: rowString(row, "request_type"),
      status: rowString(row, "status"),
      receivedAt: rowDate(row, "received_at")?.toISOString(),
      dueAt: rowDate(row, "due_at")?.toISOString(),
      completedAt: rowDate(row, "completed_at")?.toISOString(),
      exportReady: Boolean(rowString(row, "payload_hash")) && Boolean(deleteAfter && deleteAfter > now),
      exportDeleteAfter: deleteAfter?.toISOString() ?? null,
    };
  });
}

async function buildSubjectExport(client: PoolClient, principalId: string) {
  const [account, workspaces, reviewerAccess, rater, requests] = await Promise.all([
    client.query(
      `SELECT principal.principal_id,principal.status,principal.created_at,
              browser.primary_email,browser.email_verified,browser.display_name,
              better.name AS account_name,better.email AS account_email
       FROM tokenless_principals principal
       LEFT JOIN tokenless_browser_identities browser ON browser.principal_address=principal.principal_id
       LEFT JOIN tokenless_identity_bindings binding
         ON binding.principal_id=principal.principal_id
        AND binding.provider='better_auth' AND binding.status='active'
       LEFT JOIN tokenless_better_auth_users better ON better.id=binding.provider_subject
       WHERE principal.principal_id=$1 LIMIT 1`,
      [principalId],
    ),
    client.query(
      `SELECT membership.workspace_id,workspace.name,membership.role,membership.created_at
       FROM tokenless_workspace_members membership
       JOIN tokenless_workspaces workspace ON workspace.workspace_id=membership.workspace_id
       WHERE membership.account_address=$1 ORDER BY membership.workspace_id`,
      [principalId],
    ),
    client.query(
      `SELECT reviewer.workspace_id,workspace.name AS workspace_name,reviewer.status,
              reviewer.activated_at,reviewer.ended_at,access_grant.max_private_sensitivity,
              access_grant.valid_until,access_grant.revoked_at
       FROM tokenless_workspace_reviewers reviewer
       JOIN tokenless_workspaces workspace ON workspace.workspace_id=reviewer.workspace_id
       LEFT JOIN tokenless_workspace_reviewer_access_grants access_grant
         ON access_grant.workspace_id=reviewer.workspace_id
        AND access_grant.principal_address=reviewer.principal_address
       WHERE reviewer.principal_address=$1 ORDER BY reviewer.workspace_id,access_grant.grant_id`,
      [principalId],
    ),
    client.query(
      `SELECT profile.rater_id,profile.created_at,legal.declared_residence_country,
              legal.tax_residence_country,legal.tax_profile_status,legal.dac7_status,
              legal.sanctions_status,legal.eligibility_status,payout.payout_account,
              payout.eligibility_status AS payout_status
       FROM tokenless_rater_profiles profile
       LEFT JOIN tokenless_legal_eligibility legal ON legal.rater_id=profile.rater_id
       LEFT JOIN tokenless_payout_eligibility payout ON payout.rater_id=profile.rater_id
       WHERE profile.principal_id=$1 LIMIT 1`,
      [principalId],
    ),
    client.query(
      `SELECT request_id,workspace_id,request_type,status,received_at,due_at,completed_at
       FROM tokenless_subject_requests WHERE principal_id=$1 ORDER BY received_at,request_id`,
      [principalId],
    ),
  ]);
  const [
    notificationPreferences,
    notifications,
    assuranceAssignments,
    directReviewAssignments,
    workspaceAuditEvents,
    securityEvents,
    oauthAuthorizations,
    agentIntegrations,
    passkeys,
    enterpriseMemberships,
    ownedSsoConfigurations,
    billingSubscriptions,
    payerTransactions,
    agentRegistry,
    agentAuditActivity,
    oversightAttestations,
    publicQuestionMedia,
    publicMediaQuotas,
    mcpSessions,
    workspaceMoves,
    networkSettlements,
  ] = await Promise.all([
    client.query(
      `SELECT preferences.assignment_available,preferences.assignment_completed,
              preferences.payment_updates,preferences.ask_results,preferences.account_security,
              preferences.created_at,preferences.updated_at,
              subscription.email,subscription.verified_at
       FROM tokenless_notification_preferences preferences
       LEFT JOIN tokenless_notification_email_subscriptions subscription
         ON subscription.principal_address=preferences.principal_address
       WHERE preferences.principal_address=$1`,
      [principalId],
    ),
    client.query(
      `SELECT notification.notification_id,notification.kind,notification.preference_key,
              notification.read_at,notification.created_at,
              delivery.state AS email_delivery_state,delivery.delivered_at,delivery.suppressed_at,
              delivery.dead_at
       FROM tokenless_notifications notification
       LEFT JOIN tokenless_notification_email_deliveries delivery
         ON delivery.notification_id=notification.notification_id
       WHERE notification.principal_address=$1
       ORDER BY notification.created_at,notification.notification_id`,
      [principalId],
    ),
    client.query(
      `SELECT assignment.assignment_id,assignment.workspace_id,assignment.project_id,
              assignment.run_id,assignment.source,assignment.selection,assignment.status,
              assignment.paid_assignment,assignment.created_at,assignment.accepted_at,
              assignment.updated_at
       FROM tokenless_assurance_assignments assignment
       WHERE assignment.reviewer_account_address=$1 OR assignment.rater_id IN (
         SELECT rater_id FROM tokenless_rater_profiles WHERE principal_id=$1
       )
       ORDER BY assignment.created_at,assignment.assignment_id`,
      [principalId],
    ),
    client.query(
      `SELECT assignment.assignment_id,assignment.delivery_id,assignment.workspace_id,
              assignment.project_id,assignment.private_review_id,assignment.status,
              assignment.created_at,assignment.accepted_at,assignment.updated_at,
              response.choice,response.response_commitment,response.created_at AS response_created_at
       FROM tokenless_private_unpaid_review_assignments assignment
       LEFT JOIN tokenless_private_review_responses response
         ON response.assignment_id=assignment.assignment_id
       WHERE assignment.reviewer_account_address=$1 OR assignment.assignment_id IN (
         SELECT seat.assignment_id FROM tokenless_paid_assignment_seats seat
         WHERE seat.reviewer_principal_id=$1
       )
       ORDER BY assignment.created_at,assignment.assignment_id`,
      [principalId],
    ),
    client.query(
      `SELECT event.workspace_id,event.sequence,event.actor_kind,event.action,event.target_kind,
              event.purpose,event.reason,event.result,event.occurred_at
       FROM tokenless_audit_events event
       WHERE event.actor_reference=$1
       ORDER BY event.occurred_at,event.workspace_id,event.sequence`,
      [principalId],
    ),
    client.query(
      `SELECT event.sequence,event.actor_kind,event.action,event.target_kind,event.purpose,
              event.reason,event.result,event.occurred_at
       FROM tokenless_security_audit_events event
       WHERE event.scope_kind='identity' AND event.scope_id=$1
       ORDER BY event.occurred_at,event.sequence`,
      [principalId],
    ),
    client.query(
      `SELECT family.token_family_id,family.client_id,client.client_name,
              family.granted_scopes_json,family.status,family.created_at,
              family.absolute_expires_at,family.last_rotated_at,family.revoked_at,
              family.revocation_reason
       FROM tokenless_agent_oauth_token_families family
       JOIN tokenless_agent_oauth_clients client ON client.client_id=family.client_id
       WHERE family.subject_principal_id=$1
       ORDER BY family.created_at,family.token_family_id`,
      [principalId],
    ),
    client.query(
      `SELECT integration.integration_id,integration.workspace_id,integration.agent_id,
              integration.status,integration.enforcement_mode,integration.credential_expires_at,
              integration.last_seen_at,integration.created_at,integration.updated_at,
              integration.revoked_at
       FROM tokenless_agent_integrations integration
       WHERE integration.oauth_subject_principal_id=$1 OR integration.created_by=$1
       ORDER BY integration.created_at,integration.integration_id`,
      [principalId],
    ),
    client.query(
      `SELECT passkey.id,passkey.name,passkey.device_type,passkey.backed_up,passkey.created_at
       FROM tokenless_better_auth_passkeys passkey
       WHERE passkey.user_id IN (
         SELECT provider_subject FROM tokenless_identity_bindings
         WHERE principal_id=$1 AND provider='better_auth'
       )
       ORDER BY passkey.created_at,passkey.id`,
      [principalId],
    ),
    client.query(
      `SELECT member.workspace_id,member.provider_id,member.source,member.status,
              member.created_at,member.last_synced_at,member.deactivated_at
       FROM tokenless_enterprise_managed_members member
       WHERE member.principal_id=$1
       ORDER BY member.created_at,member.workspace_id`,
      [principalId],
    ),
    client.query(
      `SELECT provider.id,provider.provider_id,provider.domain,provider.domain_verified,
              CASE WHEN provider.oidc_config IS NULL THEN 'saml' ELSE 'oidc' END AS protocol
       FROM tokenless_better_auth_sso_providers provider
       WHERE provider.user_id IN (
         SELECT provider_subject FROM tokenless_identity_bindings
         WHERE principal_id=$1 AND provider='better_auth'
       )
       ORDER BY provider.provider_id`,
      [principalId],
    ),
    client.query(
      `SELECT subscription.workspace_id,subscription.plan_key,subscription.price_version,
              subscription.provider_status,subscription.current_period_start,
              subscription.current_period_end,subscription.cancel_at_period_end,
              subscription.created_at,subscription.updated_at
       FROM tokenless_workspace_subscriptions subscription
       JOIN tokenless_workspace_members member ON member.workspace_id=subscription.workspace_id
       WHERE member.account_address=$1 AND member.role='owner'
       ORDER BY subscription.workspace_id`,
      [principalId],
    ),
    client.query(
      `SELECT intent.payment_intent_id,intent.workspace_id,intent.mode,intent.amount_atomic,
              intent.state,intent.created_at,intent.updated_at
       FROM tokenless_payment_intents intent
       WHERE intent.payer_address IN (
         SELECT wallet_address FROM tokenless_wallet_bindings WHERE principal_id=$1
       )
       ORDER BY intent.created_at,intent.payment_intent_id`,
      [principalId],
    ),
    client.query(
      `SELECT agent.agent_id,agent.workspace_id,agent.external_id,agent.status,
              agent.created_at,agent.updated_at,agent.deactivated_at,
              version.version_id,version.version_number,version.display_name,
              version.declared_provider,version.declared_model,version.declared_model_version,
              version.environment,version.configuration_commitment,
              version.created_at AS version_created_at
       FROM tokenless_agents agent
       LEFT JOIN tokenless_agent_versions version
         ON version.workspace_id=agent.workspace_id AND version.agent_id=agent.agent_id
       WHERE agent.owner_account_address=$1 OR agent.created_by=$1 OR version.created_by=$1
       ORDER BY agent.created_at,agent.agent_id,version.version_number`,
      [principalId],
    ),
    client.query(
      `SELECT event.event_id,event.workspace_id,event.agent_id,event.version_id,
              event.event_type,event.created_at
       FROM tokenless_agent_audit_events event
       WHERE event.actor_account_address=$1 OR event.agent_id IN (
         SELECT agent_id FROM tokenless_agents
         WHERE owner_account_address=$1 OR created_by=$1
       )
       ORDER BY event.created_at,event.event_id`,
      [principalId],
    ),
    client.query(
      `SELECT attestation.attestation_id,attestation.workspace_id,
              CASE WHEN attestation.account_address=$1 THEN attestation.competence_basis ELSE NULL END
                AS competence_basis,
              CASE WHEN attestation.account_address=$1 THEN attestation.training_records_json ELSE '[]' END
                AS training_records_json,
              attestation.authority_scope,attestation.attested_at,attestation.expires_at,
              attestation.status,attestation.revoked_at,attestation.created_at,attestation.updated_at,
              attestation.account_address=$1 AS subject_is_oversight_member,
              attestation.attested_by=$1 AS subject_is_attestor,
              attestation.revoked_by=$1 AS subject_is_revoker
       FROM tokenless_oversight_attestations attestation
       WHERE attestation.account_address=$1 OR attestation.attested_by=$1 OR attestation.revoked_by=$1
          OR attestation.training_records_json LIKE '%' || $1 || '%'
       ORDER BY attestation.created_at,attestation.attestation_id`,
      [principalId],
    ),
    client.query(
      `SELECT media.asset_id,media.workspace_id,media.client_request_id,media.question_id,
              media.digest,media.content_type,media.original_filename,media.size_bytes,
              media.width,media.height,media.technical_status,media.moderation_status,
              media.expires_at,media.bound_at,media.moderated_at,media.deletion_requested_at,
              media.created_at,media.updated_at
       FROM tokenless_public_question_media media
       WHERE media.owner_account_address=$1
       ORDER BY media.created_at,media.asset_id`,
      [principalId],
    ),
    client.query(
      `SELECT quota.workspace_id,quota.day_key,quota.upload_count,quota.upload_bytes,quota.updated_at
       FROM tokenless_public_media_daily_quotas quota
       WHERE quota.owner_account_address=$1
       ORDER BY quota.day_key,quota.workspace_id`,
      [principalId],
    ),
    client.query(
      `SELECT session.session_hash,session.workspace_id,session.integration_id,
              session.client_name,session.client_version,session.protocol_version,
              session.elicitation_mode,session.status,session.created_at,
              session.last_seen_at,session.expires_at
       FROM tokenless_mcp_sessions session
       WHERE session.subject_principal_id=$1
       ORDER BY session.created_at,session.session_hash`,
      [principalId],
    ),
    client.query(
      `SELECT move.move_id,move.source_workspace_id,move.target_workspace_id,move.status,
              move.source_confirmed_at,move.target_approved_at,move.completed_at,
              move.created_at,move.expires_at,
              move.oauth_subject_principal_id=$1 AS subject_is_oauth_principal,
              move.target_approved_by=$1 AS subject_is_approver
       FROM tokenless_agent_workspace_moves move
       WHERE move.oauth_subject_principal_id=$1 OR move.target_approved_by=$1
       ORDER BY move.created_at,move.move_id`,
      [principalId],
    ),
    client.query(
      `SELECT settlement.binding_id,settlement.assignment_id,settlement.state,
              settlement.terminal_outcome,settlement.settlement_reference,
              settlement.settlement_evidence_hash,settlement.committed_at,
              settlement.terminal_at,settlement.created_at,settlement.updated_at,
              COALESCE(receipts.append_only_receipt_count,0) AS append_only_receipt_count
       FROM tokenless_network_assignment_settlements settlement
       JOIN tokenless_assurance_assignments assignment
         ON assignment.assignment_id=settlement.assignment_id
       LEFT JOIN (
         SELECT binding_id,COUNT(*) AS append_only_receipt_count
         FROM tokenless_network_assignment_settlement_receipts GROUP BY binding_id
       ) receipts ON receipts.binding_id=settlement.binding_id
       WHERE assignment.reviewer_account_address=$1 OR assignment.rater_id IN (
         SELECT rater_id FROM tokenless_rater_profiles WHERE principal_id=$1
       )
       ORDER BY settlement.created_at,settlement.binding_id`,
      [principalId],
    ),
  ]);
  const securityHead = await client.query(
    `SELECT last_sequence,last_digest FROM tokenless_security_audit_heads
     WHERE scope_kind='identity' AND scope_id=$1 LIMIT 1`,
    [principalId],
  );
  const securityAuditIntegrity =
    securityEvents.rowCount === 0 && securityHead.rowCount === 0
      ? { eventCount: 0, headDigest: `sha256:${"0".repeat(64)}`, valid: true as const }
      : await verifySecurityAuditChain({ scopeKind: "identity", scopeId: principalId }, client);
  if (!securityAuditIntegrity.valid) {
    throw new TokenlessServiceError(
      "Subject export is unavailable because the identity security audit chain failed verification.",
      503,
      "security_audit_integrity_invalid",
      true,
    );
  }
  const forecastIntegrity = await listPrincipalForecastIntegrityInTransaction(client, principalId);
  const categoryManifest = {
    included: [
      { category: "account_profile", path: "accountProfile" },
      { category: "workspace_access", path: "workspaceMemberships" },
      { category: "reviewer_and_paid_profile", path: "workspaceReviewerAccess, paidReviewerProfile" },
      { category: "communications_metadata", path: "communications" },
      { category: "review_activity", path: "reviewActivity" },
      { category: "network_settlement_status", path: "reviewActivity.networkSettlements" },
      { category: "agent_registry_and_audit", path: "agentActivity" },
      { category: "oversight_attestations", path: "oversightAttestations" },
      { category: "public_question_media_and_quota", path: "publicQuestionMedia" },
      { category: "mcp_sessions_and_workspace_moves", path: "connectedAutomation" },
      { category: "authentication_devices", path: "authentication" },
      { category: "enterprise_identity", path: "enterpriseIdentity" },
      { category: "billing_metadata", path: "billing" },
      { category: "forecast_integrity", path: "forecastIntegrity" },
      { category: "subject_request_history", path: "subjectRequests" },
    ],
    withheld: [
      {
        category: "authentication_and_recovery_secrets",
        reason: "Secrets and reusable authentication, OAuth, and recovery material are never exported.",
      },
      {
        category: "encrypted_tax_and_provider_evidence",
        reason:
          "Encrypted statutory/provider evidence and provider credentials remain restricted to their legal purpose.",
      },
      {
        category: "notification_and_private_review_content",
        reason: "Message bodies, private rationale, customer artifacts, and other people's data are excluded.",
      },
      {
        category: "network_reviewer_lookup_and_receipt_payloads",
        reason:
          "The reviewer HMAC correlation handle and append-only receipt payloads are withheld as security and multi-party evidence. Their presence and receipt count are disclosed; they remain restricted for assignment integrity, fraud/dispute handling, and settlement evidence only for the applicable retention period.",
      },
      {
        category: "public_chain_records",
        reason: "Public-chain records are referenced by the product but are not copied into this off-chain export.",
      },
    ],
  };
  return {
    schemaVersion: "rateloop.subject-export.v3",
    generatedFor: principalId,
    accountProfile: account.rows[0] ?? null,
    workspaceMemberships: workspaces.rows,
    workspaceReviewerAccess: reviewerAccess.rows,
    paidReviewerProfile: rater.rows[0] ?? null,
    communications: {
      preferences: notificationPreferences.rows[0] ?? null,
      notifications: notifications.rows,
    },
    reviewActivity: {
      assuranceAssignments: assuranceAssignments.rows,
      directAssignmentsAndResponses: directReviewAssignments.rows,
      networkSettlements: networkSettlements.rows.map(row => ({
        ...row,
        reviewerLookup: "withheld_security_identifier",
        settlementReceipts: "append_only_hash_evidence_retained",
      })),
    },
    agentActivity: {
      registryAndVersions: agentRegistry.rows,
      auditEventsWithoutDetails: agentAuditActivity.rows,
    },
    oversightAttestations: oversightAttestations.rows,
    publicQuestionMedia: {
      media: publicQuestionMedia.rows,
      dailyQuotaUsage: publicMediaQuotas.rows,
    },
    auditAndSecurityActivity: {
      workspaceEventsAsActor: workspaceAuditEvents.rows,
      identitySecurity: {
        integrity: securityAuditIntegrity,
        events: securityEvents.rows,
      },
    },
    connectedAutomation: {
      oauthAuthorizations: oauthAuthorizations.rows,
      agentIntegrations: agentIntegrations.rows,
      mcpSessions: mcpSessions.rows,
      workspaceMoves: workspaceMoves.rows,
    },
    authentication: {
      passkeys: passkeys.rows,
    },
    enterpriseIdentity: {
      managedMemberships: enterpriseMemberships.rows,
      ownedSsoConfigurations: ownedSsoConfigurations.rows,
    },
    billing: {
      ownedWorkspaceSubscriptions: billingSubscriptions.rows,
      payerTransactions: payerTransactions.rows,
    },
    forecastIntegrity,
    subjectRequests: requests.rows,
    categoryManifest,
    exclusions: [
      "Authentication secrets, OAuth token material, recovery material, encrypted tax payloads, provider evidence, notification content, private rationale, and other users' data are excluded.",
      "Public-chain records are referenced by the product but are not copied into this export.",
    ],
  };
}

export async function processSubjectRequestQueue(now = new Date(), requestedLimit = 25) {
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 100);
  const queued = await dbPool.query(
    `SELECT request.request_id FROM tokenless_subject_requests request
     LEFT JOIN tokenless_privacy_worker_failures failure
       ON failure.worker_kind='subject_request' AND failure.work_item_key=request.request_id
     WHERE request.request_type IN ('access','export') AND request.status='received'
       AND (failure.failure_id IS NULL OR (failure.status='retrying' AND failure.next_retry_at<=$1))
     ORDER BY request.received_at,request.request_id LIMIT $2`,
    [now, limit],
  );
  let completed = 0;
  for (const queuedRow of queued.rows) {
    const requestId = rowString(queuedRow as QueryRow, "request_id")!;
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const request = await client.query(
        `SELECT principal_id,status FROM tokenless_subject_requests
         WHERE request_id=$1 LIMIT 1 FOR UPDATE`,
        [requestId],
      );
      const row = request.rows[0] as QueryRow | undefined;
      if (rowString(row, "status") !== "received") {
        await client.query("COMMIT");
        continue;
      }
      const principalId = rowString(row, "principal_id")!;
      const exportValue = await buildSubjectExport(client, principalId);
      const payloadJson = JSON.stringify(exportValue);
      const payloadHash = `sha256:${createHash("sha256").update(payloadJson).digest("hex")}`;
      const deleteAfter = new Date(now.getTime() + SUBJECT_EXPORT_RETENTION_MS);
      await client.query(
        `INSERT INTO tokenless_subject_request_exports
         (request_id,principal_id,schema_version,payload_json,payload_hash,generated_at,delete_after)
         VALUES ($1,$2,1,$3,$4,$5,$6)
         ON CONFLICT (request_id) DO NOTHING`,
        [requestId, principalId, payloadJson, payloadHash, now, deleteAfter],
      );
      await client.query(
        `UPDATE tokenless_subject_requests SET status='completed',completed_at=$1 WHERE request_id=$2`,
        [now, requestId],
      );
      for (const [fromStatus, toStatus, reason] of [
        ["received", "identity_verified", "authenticated_intake_identity"],
        ["identity_verified", "in_progress", "subject_export_generated"],
        ["in_progress", "completed", "subject_export_ready"],
      ] as const) {
        await client.query(
          `INSERT INTO tokenless_subject_request_events
           (event_id,request_id,from_status,to_status,actor_reference,reason,created_at)
           VALUES ($1,$2,$3,$4,'system:subject_request_worker',$5,$6)`,
          [`dsre_${randomUUID().replaceAll("-", "")}`, requestId, fromStatus, toStatus, reason, now],
        );
      }
      await client.query(
        `INSERT INTO tokenless_subject_request_completions
         (completion_id,request_id,deleted_categories_json,anonymized_categories_json,
          retained_categories_json,pending_backup_expiry_json,public_chain_exceptions_json,
          evidence_json,completed_by,completed_at)
         VALUES ($1,$2,'[]','[]','[]','[]','[]',$3,'system:subject_request_worker',$4)
         ON CONFLICT (request_id) DO NOTHING`,
        [
          `dsrc_${randomUUID().replaceAll("-", "")}`,
          requestId,
          JSON.stringify({ exportDeleteAfter: deleteAfter.toISOString(), payloadHash }),
          now,
        ],
      );
      await client.query(
        `UPDATE tokenless_privacy_worker_failures
         SET status='resolved',next_retry_at=NULL,operator_alert_state='resolved',
             resolved_at=$1,updated_at=$1
         WHERE worker_kind='subject_request' AND work_item_key=$2 AND status <> 'resolved'`,
        [now, requestId],
      );
      await client.query("COMMIT");
      completed += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      await recordPrivacyWorkerFailure({
        error,
        now,
        workerKind: "subject_request",
        workItemKey: requestId,
      });
    } finally {
      client.release();
    }
  }
  return { completed, queued: queued.rowCount ?? 0 };
}

export async function readSubjectRequestExport(input: { principalId: string; requestId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const result = await dbClient.execute({
    sql: `SELECT exports.payload_json,exports.payload_hash,exports.generated_at,exports.delete_after
          FROM tokenless_subject_request_exports exports
          JOIN tokenless_subject_requests requests ON requests.request_id=exports.request_id
          WHERE exports.request_id=? AND requests.principal_id=? AND requests.status='completed'
          LIMIT 1`,
    args: [input.requestId, required(input.principalId, "Principal", 120)],
  });
  const row = result.rows[0] as QueryRow | undefined;
  const deleteAfter = rowDate(row, "delete_after");
  if (!row || !deleteAfter || deleteAfter <= now) {
    throw new TokenlessServiceError("Subject export is unavailable.", 404, "subject_export_unavailable");
  }
  return {
    data: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    generatedAt: rowDate(row, "generated_at")!.toISOString(),
    payloadHash: rowString(row, "payload_hash"),
    deleteAfter: deleteAfter.toISOString(),
  };
}

export async function transitionSubjectRequest(input: {
  actorReference: string;
  nextStatus: SubjectRequestStatus;
  reason: string;
  requestId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  let workspaceId: string | null = null;
  let previousStatus: SubjectRequestStatus | null = null;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT status, workspace_id FROM tokenless_subject_requests WHERE request_id = $1 FOR UPDATE",
      [input.requestId],
    );
    const status = rowString(current.rows[0] as QueryRow | undefined, "status") as SubjectRequestStatus | null;
    if (!status) throw new TokenlessServiceError("Subject request not found.", 404, "subject_request_not_found");
    if (!TRANSITIONS.get(status)?.has(input.nextStatus)) {
      throw new TokenlessServiceError(
        "Subject request transition is invalid.",
        409,
        "invalid_subject_request_transition",
      );
    }
    previousStatus = status;
    workspaceId = rowString(current.rows[0] as QueryRow | undefined, "workspace_id");
    await client.query(
      `UPDATE tokenless_subject_requests SET status = $1, completed_at = CASE WHEN $1 IN ('completed','denied') THEN $2 ELSE NULL END
       WHERE request_id = $3`,
      [input.nextStatus, now, input.requestId],
    );
    await client.query(
      `INSERT INTO tokenless_subject_request_events
       (event_id, request_id, from_status, to_status, actor_reference, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `dsre_${randomUUID().replaceAll("-", "")}`,
        input.requestId,
        status,
        input.nextStatus,
        required(input.actorReference, "Actor", 160),
        required(input.reason, "Transition reason"),
        now,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (workspaceId && previousStatus) {
    await appendAuditEvent({
      action: "privacy.subject_request_transitioned",
      actorKind: "operator",
      actorReference: input.actorReference,
      assuranceMethod: "privacy_workflow",
      metadata: { fromStatus: previousStatus, toStatus: input.nextStatus },
      purpose: "data_subject_rights",
      reason: input.reason,
      result: "success",
      targetId: input.requestId,
      targetKind: "subject_request",
      workspaceId,
    });
  }
}

export async function recordSubjectRequestCompletion(input: {
  completedBy: string;
  deletedCategories?: string[];
  anonymizedCategories?: string[];
  retainedCategories?: Array<{ category: string; basis: string }>;
  pendingBackupExpiry?: Array<{ category: string; expiresAt: string }>;
  publicChainExceptions?: string[];
  evidence?: Record<string, unknown>;
  requestId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const completedBy = required(input.completedBy, "Completion actor", 160);
  const payload = {
    anonymizedCategories: JSON.stringify(input.anonymizedCategories ?? []),
    deletedCategories: JSON.stringify(input.deletedCategories ?? []),
    evidence: JSON.stringify(input.evidence ?? {}),
    pendingBackupExpiry: JSON.stringify(input.pendingBackupExpiry ?? []),
    publicChainExceptions: JSON.stringify(input.publicChainExceptions ?? []),
    retainedCategories: JSON.stringify(input.retainedCategories ?? []),
  };
  let completionId = `dsrc_${randomUUID().replaceAll("-", "")}`;
  let previousStatus: SubjectRequestStatus | null = null;
  let workspaceId: string | null = null;
  let transitioned = false;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT status, workspace_id FROM tokenless_subject_requests WHERE request_id = $1 FOR UPDATE",
      [input.requestId],
    );
    const status = rowString(current.rows[0] as QueryRow | undefined, "status") as SubjectRequestStatus | null;
    if (!status) throw new TokenlessServiceError("Subject request not found.", 404, "subject_request_not_found");
    previousStatus = status;
    workspaceId = rowString(current.rows[0] as QueryRow | undefined, "workspace_id");
    if (status !== "completed" && !TRANSITIONS.get(status)?.has("completed")) {
      throw new TokenlessServiceError(
        "Subject request transition is invalid.",
        409,
        "invalid_subject_request_transition",
      );
    }

    const existing = await client.query(
      `SELECT completion_id, deleted_categories_json, anonymized_categories_json,
              retained_categories_json, pending_backup_expiry_json, public_chain_exceptions_json,
              evidence_json, completed_by
       FROM tokenless_subject_request_completions WHERE request_id = $1 FOR UPDATE`,
      [input.requestId],
    );
    let completion = existing.rows[0] as QueryRow | undefined;
    if (!completion) {
      const inserted = await client.query(
        `INSERT INTO tokenless_subject_request_completions
         (completion_id, request_id, deleted_categories_json, anonymized_categories_json,
          retained_categories_json, pending_backup_expiry_json, public_chain_exceptions_json,
          evidence_json, completed_by, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (request_id) DO NOTHING
         RETURNING completion_id, deleted_categories_json, anonymized_categories_json,
                   retained_categories_json, pending_backup_expiry_json, public_chain_exceptions_json,
                   evidence_json, completed_by`,
        [
          completionId,
          input.requestId,
          payload.deletedCategories,
          payload.anonymizedCategories,
          payload.retainedCategories,
          payload.pendingBackupExpiry,
          payload.publicChainExceptions,
          payload.evidence,
          completedBy,
          now,
        ],
      );
      completion = inserted.rows[0] as QueryRow | undefined;
      if (!completion) {
        const raced = await client.query(
          `SELECT completion_id, deleted_categories_json, anonymized_categories_json,
                  retained_categories_json, pending_backup_expiry_json, public_chain_exceptions_json,
                  evidence_json, completed_by
           FROM tokenless_subject_request_completions WHERE request_id = $1 FOR UPDATE`,
          [input.requestId],
        );
        completion = raced.rows[0] as QueryRow | undefined;
      }
    }
    if (!completion || !completionMatches(completion, payload, completedBy)) {
      throw new TokenlessServiceError(
        "Subject request completion conflicts with the recorded evidence.",
        409,
        "subject_request_completion_conflict",
      );
    }
    completionId = rowString(completion, "completion_id")!;

    if (status === "completed") {
      await client.query("COMMIT");
    } else {
      await client.query(
        "UPDATE tokenless_subject_requests SET status = 'completed', completed_at = $1 WHERE request_id = $2",
        [now, input.requestId],
      );
      await client.query(
        `INSERT INTO tokenless_subject_request_events
         (event_id, request_id, from_status, to_status, actor_reference, reason, created_at)
         VALUES ($1, $2, $3, 'completed', $4, 'completion_evidence_recorded', $5)`,
        [`dsre_${randomUUID().replaceAll("-", "")}`, input.requestId, status, completedBy, now],
      );
      transitioned = true;
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (workspaceId && previousStatus && transitioned) {
    await appendAuditEvent({
      action: "privacy.subject_request_transitioned",
      actorKind: "operator",
      actorReference: completedBy,
      assuranceMethod: "privacy_workflow",
      metadata: { fromStatus: previousStatus, toStatus: "completed" },
      purpose: "data_subject_rights",
      reason: "completion_evidence_recorded",
      result: "success",
      targetId: input.requestId,
      targetKind: "subject_request",
      workspaceId,
    });
  }
  return completionId;
}

function completionMatches(
  row: QueryRow,
  payload: {
    anonymizedCategories: string;
    deletedCategories: string;
    evidence: string;
    pendingBackupExpiry: string;
    publicChainExceptions: string;
    retainedCategories: string;
  },
  completedBy: string,
) {
  if (rowString(row, "completed_by") !== completedBy) return false;
  const fields: Array<[string, string]> = [
    ["deleted_categories_json", payload.deletedCategories],
    ["anonymized_categories_json", payload.anonymizedCategories],
    ["retained_categories_json", payload.retainedCategories],
    ["pending_backup_expiry_json", payload.pendingBackupExpiry],
    ["public_chain_exceptions_json", payload.publicChainExceptions],
    ["evidence_json", payload.evidence],
  ];
  return fields.every(([field, expected]) => {
    const stored = rowString(row, field);
    if (stored === null) return false;
    try {
      return isDeepStrictEqual(JSON.parse(stored), JSON.parse(expected));
    } catch {
      return false;
    }
  });
}
