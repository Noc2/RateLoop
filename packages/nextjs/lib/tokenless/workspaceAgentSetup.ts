import { createHash, randomUUID } from "node:crypto";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { DEFAULT_ADAPTIVE_AGREEMENT_THRESHOLD_BPS } from "~~/lib/tokenless/adaptiveReviewDefaults";
import { createAgentConnectionIntent } from "~~/lib/tokenless/agentConnectionIntents";
import { AGENT_SETUP_SCREEN_STEPS, type AgentSetupScreenStep } from "~~/lib/tokenless/agentSetupNavigation";
import { createPrivateGroup, createPrivateGroupInvitation } from "~~/lib/tokenless/privateGroups";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export { agentSetupUrl } from "~~/lib/tokenless/agentSetupNavigation";
export type { AgentSetupScreenStep } from "~~/lib/tokenless/agentSetupNavigation";

type Row = Record<string, unknown>;

export const AGENT_SETUP_STEPS = ["connect", "agent", "reviews", "people", "complete"] as const;
export type AgentSetupStep = (typeof AGENT_SETUP_STEPS)[number];
export type AgentSetupStatus = "in_progress" | "completed" | "grandfathered";
export type AgentSetupReviewMode = "adaptive" | "always" | "manual";

type AgentIdentityInput = {
  displayName: string;
  description?: string | null;
  provider?: string | null;
  model?: string | null;
  modelVersion?: string | null;
  deploymentName?: string | null;
  environment?: "staging" | "production";
};

type ReviewDraft = {
  schemaVersion: "rateloop.workspace-agent-setup-review.v1";
  mode: AgentSetupReviewMode;
  reviewerAudience: "private_invited";
  contentBoundary: "private_workspace";
  autonomousAccess: false;
};

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowNumber(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  return Number.isSafeInteger(value) ? value : null;
}

function rowDate(row: Row | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error("Workspace setup data is invalid.");
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredRevision(value: unknown) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new TokenlessServiceError("Setup revision is invalid.", 400, "invalid_agent_setup_revision");
  }
  return revision;
}

function bounded(value: unknown, field: string, maximum: number, optional = false) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new TokenlessServiceError(`${field} must contain 1-${maximum} characters.`, 400, "invalid_agent_setup");
  }
  return value.trim();
}

function normalizeIdentity(input: AgentIdentityInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TokenlessServiceError("Agent details are invalid.", 400, "invalid_agent_setup");
  }
  const environment = input.environment ?? "production";
  if (environment !== "staging" && environment !== "production") {
    throw new TokenlessServiceError("Agent environment is invalid.", 400, "invalid_agent_setup");
  }
  const normalized = {
    displayName: bounded(input.displayName, "Agent name", 120)!,
    description: bounded(input.description, "Agent description", 1_000, true),
    provider: bounded(input.provider ?? "unknown", "Provider", 120)!,
    model: bounded(input.model ?? "unknown", "Model", 160)!,
    modelVersion: bounded(input.modelVersion, "Model version", 160, true),
    deploymentName: bounded(input.deploymentName, "Deployment name", 160, true),
    environment,
  };
  return { ...normalized, configurationCommitment: digest(stableJson(normalized)) };
}

function normalizeReviewDraft(input: unknown): ReviewDraft {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TokenlessServiceError("Review behavior is invalid.", 400, "invalid_agent_setup_review");
  }
  const body = input as Record<string, unknown>;
  if (body.autonomousAccess === true) {
    throw new TokenlessServiceError(
      "Autonomous review sending is not available for the current reviewer lane.",
      409,
      "agent_setup_lane_unavailable",
    );
  }
  if (!(["adaptive", "always", "manual"] as unknown[]).includes(body.mode)) {
    throw new TokenlessServiceError("Review mode is invalid.", 400, "invalid_agent_setup_review");
  }
  if (body.reviewerAudience !== undefined && body.reviewerAudience !== "private_invited") {
    throw new TokenlessServiceError(
      "The selected reviewer lane is not available.",
      409,
      "agent_setup_lane_unavailable",
    );
  }
  if (body.contentBoundary !== undefined && body.contentBoundary !== "private_workspace") {
    throw new TokenlessServiceError("The selected content lane is not available.", 409, "agent_setup_lane_unavailable");
  }
  return {
    schemaVersion: "rateloop.workspace-agent-setup-review.v1",
    mode: body.mode as AgentSetupReviewMode,
    reviewerAudience: "private_invited",
    contentBoundary: "private_workspace",
    autonomousAccess: false,
  };
}

async function workspaceAccess(accountAddress: string, workspaceId: string) {
  const actor = normalizeAccountSubject(accountAddress);
  const result = await dbClient.execute({
    sql: `SELECT m.role,w.name
          FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
          WHERE m.workspace_id=? AND m.account_address=? LIMIT 1`,
    args: [workspaceId, actor],
  });
  const row = result.rows[0] as Row | undefined;
  const role = rowString(row, "role");
  if (!role) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return { actor, role, canManage: role === "owner" || role === "admin", workspaceName: rowString(row, "name")! };
}

async function requireManager(accountAddress: string, workspaceId: string) {
  const access = await workspaceAccess(accountAddress, workspaceId);
  if (!access.canManage) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return access;
}

function stageState(resumeStep: AgentSetupStep, status: AgentSetupStatus) {
  const resumeIndex = AGENT_SETUP_STEPS.indexOf(resumeStep);
  return [
    { key: "workspace" as const, status: "complete" as const },
    ...AGENT_SETUP_SCREEN_STEPS.slice(1).map((step, index) => ({
      key: step,
      status:
        status !== "in_progress" || index < resumeIndex
          ? ("complete" as const)
          : index === resumeIndex
            ? ("current" as const)
            : ("not_started" as const),
    })),
  ];
}

export function clampAgentSetupStep(
  requested: string | null | undefined,
  resumeStep: AgentSetupStep,
): AgentSetupScreenStep | "complete" {
  if (resumeStep === "complete") return "complete";
  if (!requested || !AGENT_SETUP_SCREEN_STEPS.includes(requested as AgentSetupScreenStep)) {
    return resumeStep as AgentSetupScreenStep;
  }
  const requestedStep = requested as AgentSetupScreenStep;
  return AGENT_SETUP_SCREEN_STEPS.indexOf(requestedStep) <= AGENT_SETUP_STEPS.indexOf(resumeStep)
    ? requestedStep
    : (resumeStep as AgentSetupScreenStep);
}

export async function getWorkspaceAgentSetup(input: {
  accountAddress: string;
  workspaceId: string;
  requestedStep?: string | null;
}) {
  const access = await workspaceAccess(input.accountAddress, input.workspaceId);
  const result = await dbClient.execute({
    sql: `SELECT s.*,ci.status AS connection_status,ci.client_name AS observed_client_name,
                 ci.client_version AS observed_client_version,ci.hard_expires_at,
                 i.integration_id,i.status AS integration_status,i.agent_id,i.agent_version_id,
                 i.review_policy_id AS integration_review_policy_id,
                 i.review_policy_version AS integration_review_policy_version,
                 v.display_name,v.description,v.declared_provider,v.declared_model,
                 v.declared_model_version,v.declared_deployment_name,v.environment
          FROM tokenless_workspace_agent_setups s
          LEFT JOIN tokenless_agent_connection_intents ci ON ci.intent_id=s.primary_connection_intent_id
          LEFT JOIN tokenless_agent_integrations i
            ON i.connection_intent_id=s.primary_connection_intent_id AND i.status='active'
          LEFT JOIN tokenless_agent_versions v ON v.version_id=i.agent_version_id
          WHERE s.workspace_id=? LIMIT 1`,
    args: [input.workspaceId],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new TokenlessServiceError("Workspace setup not found.", 404, "agent_setup_not_found");
  const status = rowString(row, "status") as AgentSetupStatus;
  const connected =
    rowString(row, "connection_status") === "connected" &&
    rowString(row, "integration_status") === "active" &&
    Boolean(rowString(row, "integration_id"));
  const confirmed =
    connected &&
    Boolean(rowString(row, "agent_confirmed_at")) &&
    rowString(row, "confirmed_agent_version_id") === rowString(row, "agent_version_id");
  const reviewsConfirmed = confirmed && Boolean(rowString(row, "reviews_confirmed_at"));
  const peopleDecided = reviewsConfirmed && Boolean(rowString(row, "people_decided_at"));
  const resumeStep: AgentSetupStep =
    status !== "in_progress"
      ? "complete"
      : !connected
        ? "connect"
        : !confirmed
          ? "agent"
          : !reviewsConfirmed
            ? "reviews"
            : !peopleDecided
              ? "people"
              : "people";
  const currentStep = clampAgentSetupStep(input.requestedStep, resumeStep);
  const reviewDraft = parseJson<ReviewDraft | null>(row.review_draft_json, null);
  const safeConnection = {
    canCheckReviewRequirement: true,
    canSpend: false,
    canPublish: false,
    canReadPrivateArtifacts: false,
    canAdministerWorkspace: false,
  };
  return {
    workspaceId: input.workspaceId,
    workspaceName: access.workspaceName,
    role: access.role,
    canManage: access.canManage,
    status,
    revision: rowNumber(row, "revision")!,
    resumeStep,
    currentStep,
    stages: stageState(resumeStep, status),
    complete: status === "completed" || status === "grandfathered",
    grandfathered: status === "grandfathered",
    connection: access.canManage
      ? {
          intentId: rowString(row, "primary_connection_intent_id"),
          integrationId: rowString(row, "integration_id"),
          status: rowString(row, "connection_status"),
          hardExpiresAt: rowDate(row, "hard_expires_at"),
          safeAccess: safeConnection,
        }
      : { status: rowString(row, "connection_status") },
    agent:
      access.canManage && connected
        ? {
            agentId: rowString(row, "agent_id")!,
            versionId: rowString(row, "agent_version_id")!,
            displayName: rowString(row, "display_name")!,
            description: rowString(row, "description"),
            provider: rowString(row, "declared_provider")!,
            model: rowString(row, "declared_model")!,
            modelVersion: rowString(row, "declared_model_version"),
            deploymentName: rowString(row, "declared_deployment_name"),
            environment: rowString(row, "environment")!,
            observedClientName: rowString(row, "observed_client_name"),
            observedClientVersion: rowString(row, "observed_client_version"),
          }
        : null,
    reviewDraft: access.canManage ? reviewDraft : null,
    peopleDecision: access.canManage ? rowString(row, "people_decision") : null,
    privateGroupId: access.canManage ? rowString(row, "private_group_id") : null,
    capabilities: {
      reviewerAudiences: ["private_invited"] as const,
      contentBoundaries: ["private_workspace"] as const,
      autonomousAccess: false,
      unavailableReason: "Autonomous private review delivery is not connected yet.",
    },
  };
}

export type WorkspaceAgentSetupView = Awaited<ReturnType<typeof getWorkspaceAgentSetup>>;

export async function createWorkspaceAgentSetupConnection(input: {
  accountAddress: string;
  workspaceId: string;
  origin: string;
  revision: unknown;
}) {
  await requireManager(input.accountAddress, input.workspaceId);
  return createAgentConnectionIntent({
    accountAddress: input.accountAddress,
    workspaceId: input.workspaceId,
    origin: input.origin,
    setupRevision: requiredRevision(input.revision),
  });
}

export async function confirmWorkspaceSetupAgent(input: {
  accountAddress: string;
  workspaceId: string;
  revision: unknown;
  agent: AgentIdentityInput;
}) {
  const access = await requireManager(input.accountAddress, input.workspaceId);
  const expectedRevision = requiredRevision(input.revision);
  const version = normalizeIdentity(input.agent);
  const now = new Date();
  const client = await dbPool.connect();
  let confirmedVersionId = "";
  try {
    await client.query("BEGIN");
    const setupResult = await client.query(
      `SELECT * FROM tokenless_workspace_agent_setups WHERE workspace_id=$1 FOR UPDATE`,
      [input.workspaceId],
    );
    const setup = setupResult.rows[0] as Row | undefined;
    if (!setup || rowString(setup, "status") !== "in_progress") {
      throw new TokenlessServiceError("Workspace setup is not active.", 409, "agent_setup_not_active");
    }
    if (rowNumber(setup, "revision") !== expectedRevision) {
      throw new TokenlessServiceError("Workspace setup changed. Reload and try again.", 409, "agent_setup_conflict");
    }
    const intentId = rowString(setup, "primary_connection_intent_id");
    const integrationResult = await client.query(
      `SELECT i.*,ci.status AS connection_status,v.version_number,v.display_name,v.description,
              v.declared_provider,v.declared_model,v.declared_model_version,v.declared_deployment_name,v.environment
       FROM tokenless_agent_integrations i
       JOIN tokenless_agent_connection_intents ci ON ci.intent_id=i.connection_intent_id
       JOIN tokenless_agent_versions v ON v.version_id=i.agent_version_id
       WHERE i.workspace_id=$1 AND i.connection_intent_id=$2 AND i.status='active' FOR UPDATE`,
      [input.workspaceId, intentId],
    );
    const integration = integrationResult.rows[0] as Row | undefined;
    if (!integration || rowString(integration, "connection_status") !== "connected") {
      throw new TokenlessServiceError("Connect and verify the agent first.", 409, "agent_setup_connection_required");
    }
    const unchanged =
      rowString(integration, "display_name") === version.displayName &&
      rowString(integration, "description") === version.description &&
      rowString(integration, "declared_provider") === version.provider &&
      rowString(integration, "declared_model") === version.model &&
      rowString(integration, "declared_model_version") === version.modelVersion &&
      rowString(integration, "declared_deployment_name") === version.deploymentName &&
      rowString(integration, "environment") === version.environment;
    const integrationId = rowString(integration, "integration_id")!;
    const agentId = rowString(integration, "agent_id")!;
    const reviewPolicyId = rowString(integration, "review_policy_id")!;
    let reviewPolicyVersion = rowNumber(integration, "review_policy_version")!;
    if (unchanged) {
      confirmedVersionId = rowString(integration, "agent_version_id")!;
    } else {
      confirmedVersionId = `agtv_${randomUUID().replaceAll("-", "")}`;
      const nextVersion = rowNumber(integration, "version_number")! + 1;
      await client.query(
        `INSERT INTO tokenless_agent_versions
         (version_id,agent_id,workspace_id,version_number,display_name,description,declared_provider,
          declared_model,declared_model_version,declared_deployment_name,environment,
          configuration_commitment,created_by,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          confirmedVersionId,
          agentId,
          input.workspaceId,
          nextVersion,
          version.displayName,
          version.description,
          version.provider,
          version.model,
          version.modelVersion,
          version.deploymentName,
          version.environment,
          version.configurationCommitment,
          access.actor,
          now,
        ],
      );
      await client.query("UPDATE tokenless_agents SET updated_at=$1 WHERE agent_id=$2", [now, agentId]);
      await client.query(
        `INSERT INTO tokenless_agent_audit_events
         (event_id,workspace_id,agent_id,version_id,event_type,actor_account_address,details_json,created_at)
         VALUES ($1,$2,$3,$4,'agent.version_created',$5,$6,$7)`,
        [
          `agevt_${randomUUID().replaceAll("-", "")}`,
          input.workspaceId,
          agentId,
          confirmedVersionId,
          access.actor,
          JSON.stringify({ source: "workspace_setup", versionNumber: nextVersion }),
          now,
        ],
      );
      const policyResult = await client.query(
        `SELECT * FROM tokenless_agent_review_policies
         WHERE workspace_id=$1 AND policy_id=$2 AND version=$3 AND enabled=true FOR UPDATE`,
        [input.workspaceId, reviewPolicyId, reviewPolicyVersion],
      );
      const policy = policyResult.rows[0] as Row | undefined;
      if (!policy) throw new TokenlessServiceError("Review policy is unavailable.", 409, "agent_setup_policy_mismatch");
      await client.query(
        `UPDATE tokenless_agent_review_policies SET enabled=false,superseded_at=$1
         WHERE workspace_id=$2 AND policy_id=$3 AND version=$4`,
        [now, input.workspaceId, reviewPolicyId, reviewPolicyVersion],
      );
      reviewPolicyVersion += 1;
      await client.query(
        `INSERT INTO tokenless_agent_review_policies
         (policy_id,version,workspace_id,agent_id,agent_version_id,mode,enabled,agreement_threshold_bps,
          production_floor_bps,maximum_unreviewed_gap,rules_json,audience_policy_json,publishing_policy_id,
          created_by,approved_by,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12,$13,$13,$14)`,
        [
          reviewPolicyId,
          reviewPolicyVersion,
          input.workspaceId,
          agentId,
          confirmedVersionId,
          rowString(policy, "mode"),
          rowNumber(policy, "agreement_threshold_bps"),
          rowNumber(policy, "production_floor_bps"),
          rowNumber(policy, "maximum_unreviewed_gap"),
          String(policy.rules_json),
          String(policy.audience_policy_json),
          rowString(policy, "publishing_policy_id"),
          access.actor,
          now,
        ],
      );
      await client.query(
        `UPDATE tokenless_agent_integrations
         SET agent_version_id=$1,review_policy_id=$2,review_policy_version=$3,updated_at=$4
         WHERE integration_id=$5`,
        [confirmedVersionId, reviewPolicyId, reviewPolicyVersion, now, integrationId],
      );
    }
    await client.query(
      `UPDATE tokenless_workspace_agent_setups
       SET primary_integration_id=$1,confirmed_agent_version_id=$2,agent_confirmed_at=$3,agent_confirmed_by=$4,
           review_draft_json='{}',review_policy_id=NULL,review_policy_version=NULL,
           reviews_confirmed_at=NULL,reviews_confirmed_by=NULL,people_decision=NULL,private_group_id=NULL,
           people_decided_at=NULL,people_decided_by=NULL,current_step='reviews',revision=$5,updated_at=$3
       WHERE workspace_id=$6`,
      [integrationId, confirmedVersionId, now, access.actor, expectedRevision + 1, input.workspaceId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { confirmedAgentVersionId: confirmedVersionId, revision: expectedRevision + 1 };
}

export async function configureWorkspaceSetupReviews(input: {
  accountAddress: string;
  workspaceId: string;
  revision: unknown;
  review: unknown;
}) {
  const access = await requireManager(input.accountAddress, input.workspaceId);
  const expectedRevision = requiredRevision(input.revision);
  const review = normalizeReviewDraft(input.review);
  const now = new Date();
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_workspace_agent_setups
          SET review_draft_json=?,reviews_confirmed_at=?,reviews_confirmed_by=?,
              people_decision=NULL,private_group_id=NULL,people_decided_at=NULL,people_decided_by=NULL,
              current_step='people',revision=?,updated_at=?
          WHERE workspace_id=? AND status='in_progress' AND revision=?
            AND confirmed_agent_version_id IS NOT NULL AND agent_confirmed_at IS NOT NULL`,
    args: [JSON.stringify(review), now, access.actor, expectedRevision + 1, now, input.workspaceId, expectedRevision],
  });
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError("Workspace setup changed. Reload and try again.", 409, "agent_setup_conflict");
  }
  return { review, revision: expectedRevision + 1 };
}

async function setupDefaultGroup(accountAddress: string, workspaceId: string) {
  const groups = await dbClient.execute({
    sql: `SELECT group_id FROM tokenless_private_groups
          WHERE workspace_id=? AND name='Reviewers' AND status='active' LIMIT 1`,
    args: [workspaceId],
  });
  const existingGroupId = rowString(groups.rows[0] as Row | undefined, "group_id");
  if (existingGroupId) return { groupId: existingGroupId };
  return createPrivateGroup({
    accountAddress,
    workspaceId,
    name: "Reviewers",
    purpose: "People invited to review this workspace's private material.",
    policy: { defaultCompensation: "unpaid", dataClassifications: ["internal", "confidential"] },
  });
}

export async function configureWorkspaceSetupPeople(input: {
  accountAddress: string;
  workspaceId: string;
  revision: unknown;
  decision: unknown;
  groupId?: unknown;
  createInvitation?: unknown;
  intendedEmail?: unknown;
}) {
  const access = await requireManager(input.accountAddress, input.workspaceId);
  const expectedRevision = requiredRevision(input.revision);
  if (input.decision !== "invited" && input.decision !== "later") {
    throw new TokenlessServiceError("People decision is invalid.", 400, "invalid_agent_setup_people");
  }
  const current = await dbClient.execute({
    sql: `SELECT revision,reviews_confirmed_at FROM tokenless_workspace_agent_setups
          WHERE workspace_id=? AND status='in_progress' LIMIT 1`,
    args: [input.workspaceId],
  });
  const setup = current.rows[0] as Row | undefined;
  if (rowNumber(setup, "revision") !== expectedRevision || !rowString(setup, "reviews_confirmed_at")) {
    throw new TokenlessServiceError("Workspace setup changed. Reload and try again.", 409, "agent_setup_conflict");
  }
  const group =
    typeof input.groupId === "string" && input.groupId
      ? await (async () => {
          const selected = await dbClient.execute({
            sql: `SELECT group_id FROM tokenless_private_groups
                  WHERE workspace_id=? AND group_id=? AND status='active' LIMIT 1`,
            args: [input.workspaceId, input.groupId],
          });
          const groupId = rowString(selected.rows[0] as Row | undefined, "group_id");
          if (!groupId) {
            throw new TokenlessServiceError("Reviewer group is unavailable.", 409, "agent_setup_group_unavailable");
          }
          return { groupId };
        })()
      : await setupDefaultGroup(access.actor, input.workspaceId);
  let invitation: Awaited<ReturnType<typeof createPrivateGroupInvitation>> | null = null;
  if (input.createInvitation === true) {
    const intendedEmail =
      input.intendedEmail === undefined || input.intendedEmail === null || input.intendedEmail === ""
        ? null
        : bounded(input.intendedEmail, "Recipient email", 320);
    invitation = await createPrivateGroupInvitation({
      accountAddress: access.actor,
      workspaceId: input.workspaceId,
      groupId: group.groupId,
      intendedEmail,
      maximumRedemptions: 1,
    });
  }
  const now = new Date();
  const updated = await dbClient.execute({
    sql: `UPDATE tokenless_workspace_agent_setups
          SET people_decision=?,private_group_id=?,people_decided_at=?,people_decided_by=?,
              current_step='people',revision=?,updated_at=?
          WHERE workspace_id=? AND status='in_progress' AND revision=?`,
    args: [
      input.decision,
      group.groupId,
      now,
      access.actor,
      expectedRevision + 1,
      now,
      input.workspaceId,
      expectedRevision,
    ],
  });
  if (updated.rowCount !== 1) {
    throw new TokenlessServiceError("Workspace setup changed. Reload and try again.", 409, "agent_setup_conflict");
  }
  return { groupId: group.groupId, invitation, revision: expectedRevision + 1 };
}

export async function completeWorkspaceAgentSetup(input: {
  accountAddress: string;
  workspaceId: string;
  revision: unknown;
}) {
  const access = await requireManager(input.accountAddress, input.workspaceId);
  const expectedRevision = requiredRevision(input.revision);
  const now = new Date();
  const client = await dbPool.connect();
  let policyId = "";
  let policyVersion = 0;
  try {
    await client.query("BEGIN");
    const setupResult = await client.query(
      `SELECT * FROM tokenless_workspace_agent_setups WHERE workspace_id=$1 FOR UPDATE`,
      [input.workspaceId],
    );
    const setup = setupResult.rows[0] as Row | undefined;
    if (!setup) throw new TokenlessServiceError("Workspace setup not found.", 404, "agent_setup_not_found");
    const status = rowString(setup, "status");
    if (status === "completed" || status === "grandfathered") {
      await client.query("COMMIT");
      return {
        destination: `/agents?workspace=${encodeURIComponent(input.workspaceId)}&tab=overview`,
        idempotent: true,
      };
    }
    if (rowNumber(setup, "revision") !== expectedRevision) {
      throw new TokenlessServiceError("Workspace setup changed. Reload and try again.", 409, "agent_setup_conflict");
    }
    const intentId = rowString(setup, "primary_connection_intent_id");
    const integrationResult = await client.query(
      `SELECT i.*,ci.status AS connection_status
       FROM tokenless_agent_integrations i
       JOIN tokenless_agent_connection_intents ci ON ci.intent_id=i.connection_intent_id
       WHERE i.workspace_id=$1 AND i.connection_intent_id=$2 AND i.status='active' FOR UPDATE`,
      [input.workspaceId, intentId],
    );
    const integration = integrationResult.rows[0] as Row | undefined;
    if (
      !integration ||
      rowString(integration, "connection_status") !== "connected" ||
      rowString(integration, "agent_version_id") !== rowString(setup, "confirmed_agent_version_id") ||
      !rowString(setup, "agent_confirmed_at") ||
      !rowString(setup, "reviews_confirmed_at") ||
      !rowString(setup, "people_decided_at")
    ) {
      throw new TokenlessServiceError(
        "Workspace setup prerequisites changed.",
        409,
        "agent_setup_prerequisite_mismatch",
      );
    }
    const draft = normalizeReviewDraft(parseJson(setup.review_draft_json, null));
    const groupId = rowString(setup, "private_group_id");
    if (!groupId) throw new TokenlessServiceError("Choose a reviewer group first.", 409, "agent_setup_group_required");
    const groupResult = await client.query(
      `SELECT g.current_policy_version,g.status,p.policy_hash
       FROM tokenless_private_groups g
       JOIN tokenless_private_group_policy_versions p
         ON p.group_id=g.group_id AND p.version=g.current_policy_version
       WHERE g.workspace_id=$1 AND g.group_id=$2 FOR SHARE`,
      [input.workspaceId, groupId],
    );
    const group = groupResult.rows[0] as Row | undefined;
    if (!group || rowString(group, "status") !== "active") {
      throw new TokenlessServiceError("Reviewer group is unavailable.", 409, "agent_setup_group_unavailable");
    }
    policyId = rowString(integration, "review_policy_id")!;
    const currentPolicyVersion = rowNumber(integration, "review_policy_version")!;
    const policyResult = await client.query(
      `SELECT * FROM tokenless_agent_review_policies
       WHERE workspace_id=$1 AND policy_id=$2 AND version=$3 AND enabled=true FOR UPDATE`,
      [input.workspaceId, policyId, currentPolicyVersion],
    );
    const currentPolicy = policyResult.rows[0] as Row | undefined;
    if (!currentPolicy) {
      throw new TokenlessServiceError("Review policy is unavailable.", 409, "agent_setup_policy_mismatch");
    }
    await client.query(
      `UPDATE tokenless_agent_review_policies SET enabled=false,superseded_at=$1
       WHERE workspace_id=$2 AND policy_id=$3 AND version=$4`,
      [now, input.workspaceId, policyId, currentPolicyVersion],
    );
    policyVersion = currentPolicyVersion + 1;
    const audiencePolicy = {
      schemaVersion: "rateloop.agent-audience-policy.v1",
      reviewerSource: "private_invited",
      contentVisibility: "private",
      maximumPrivateSensitivity: "confidential",
      group: {
        groupId,
        policyVersion: rowNumber(group, "current_policy_version"),
        policyHash: rowString(group, "policy_hash"),
      },
      autonomousAccess: false,
    };
    await client.query(
      `INSERT INTO tokenless_agent_review_policies
       (policy_id,version,workspace_id,agent_id,agent_version_id,mode,enabled,agreement_threshold_bps,
        production_floor_bps,maximum_unreviewed_gap,rules_json,audience_policy_json,publishing_policy_id,
        created_by,approved_by,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,NULL,$12,$12,$13)`,
      [
        policyId,
        policyVersion,
        input.workspaceId,
        rowString(integration, "agent_id"),
        rowString(integration, "agent_version_id"),
        draft.mode,
        rowNumber(currentPolicy, "agreement_threshold_bps") ?? DEFAULT_ADAPTIVE_AGREEMENT_THRESHOLD_BPS,
        rowNumber(currentPolicy, "production_floor_bps") ?? 1_000,
        rowNumber(currentPolicy, "maximum_unreviewed_gap") ?? 20,
        String(currentPolicy.rules_json),
        JSON.stringify(audiencePolicy),
        access.actor,
        now,
      ],
    );
    await client.query(
      `UPDATE tokenless_agent_integrations
       SET review_policy_id=$1,review_policy_version=$2,publishing_policy_id=NULL,
           publishing_policy_version=NULL,activation_mode='preauthorized_safe',updated_at=$3
       WHERE integration_id=$4`,
      [policyId, policyVersion, now, rowString(integration, "integration_id")],
    );
    await client.query(
      `UPDATE tokenless_workspace_agent_setups
       SET status='completed',current_step='complete',primary_integration_id=$1,
           review_policy_id=$2,review_policy_version=$3,publishing_policy_id=NULL,publishing_policy_version=NULL,
           revision=$4,completed_at=$5,completed_by=$6,updated_at=$5
       WHERE workspace_id=$7`,
      [
        rowString(integration, "integration_id"),
        policyId,
        policyVersion,
        expectedRevision + 1,
        now,
        access.actor,
        input.workspaceId,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await appendAuditEvent({
    action: "onboarding.workspace_setup_completed",
    actorKind: "principal",
    actorReference: access.actor,
    assuranceMethod: "authorized_browser_session",
    metadata: { revision: expectedRevision + 1 },
    purpose: "product_onboarding",
    reason: "workspace_administrator_completed_setup",
    result: "success",
    targetId: input.workspaceId,
    targetKind: "workspace_onboarding",
    workspaceId: input.workspaceId,
  });
  return {
    destination: `/agents?workspace=${encodeURIComponent(input.workspaceId)}&tab=overview`,
    idempotent: false,
    policyId,
    policyVersion,
    revision: expectedRevision + 1,
  };
}
