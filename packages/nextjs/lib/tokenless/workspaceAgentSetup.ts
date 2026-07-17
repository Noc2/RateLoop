import { createHash, randomUUID } from "node:crypto";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import { SAFE_AGENT_CONNECTION_SCOPES, createAgentConnectionIntent } from "~~/lib/tokenless/agentConnectionIntents";
import { AGENT_SETUP_SCREEN_STEPS, type AgentSetupScreenStep } from "~~/lib/tokenless/agentSetupNavigation";
import { getHumanReviewConfigurationForOwner } from "~~/lib/tokenless/humanReviewConfiguration";
import { recordWorkspaceSetupFunnelEvent } from "~~/lib/tokenless/onboardingObservability";
import { createPrivateGroupInvitation } from "~~/lib/tokenless/privateGroups";
import { MAXIMUM_REVIEW_PANEL_SIZE } from "~~/lib/tokenless/reviewRequestProfiles";
import {
  type ReviewerExpertiseRequirement,
  normalizeReviewerExpertiseRequirementsSelection,
} from "~~/lib/tokenless/reviewerExpertiseOptions";
import {
  type ReviewerExpertiseKey,
  normalizeReviewerExpertiseKeys,
} from "~~/lib/tokenless/reviewerExpertiseVocabulary";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export { agentSetupUrl } from "~~/lib/tokenless/agentSetupNavigation";
export type { AgentSetupScreenStep } from "~~/lib/tokenless/agentSetupNavigation";

type Row = Record<string, unknown>;

export const AGENT_SETUP_STEPS = ["connect", "agent", "reviews", "people", "complete"] as const;
export type AgentSetupStep = (typeof AGENT_SETUP_STEPS)[number];
export type AgentSetupStatus = "in_progress" | "completed" | "grandfathered";
export type AgentSetupReviewMode = "adaptive" | "always" | "manual" | "rules" | "fixed";

type AgentIdentityInput = {
  displayName: string;
  description?: string | null;
  provider?: string | null;
  model?: string | null;
  modelVersion?: string | null;
  environment?: "staging" | "production";
};

type LegacyReviewDraft = {
  schemaVersion: "rateloop.workspace-agent-setup-review.v1";
  mode: AgentSetupReviewMode;
  reviewerAudience: "private_invited";
  contentBoundary: "private_workspace";
  autonomousAccess: false;
};

export type AgentSetupReviewDraft = {
  schemaVersion: "rateloop.workspace-agent-setup-review.v2";
  bindingRevision: number | null;
  selection: {
    mode: AgentSetupReviewMode;
    enforcementMode: "advisory" | "host_enforced";
    agreementThresholdBps: number;
    productionFloorBps: number;
    fixedRateBps: number | null;
    maximumUnreviewedGap: number;
    requiredRiskTiers: string[];
    criticalRiskTiers: string[];
    minimumConfidenceBps: number | null;
    maximumLatencyMs: number | null;
  };
  requestProfile: {
    questionAuthority: "owner_fixed" | "agent_per_request";
    resultSemantics: "assurance" | "feedback";
    criterion: string | null;
    positiveLabel: string | null;
    negativeLabel: string | null;
    rationaleMode: "off" | "optional" | "required";
    audience: "private_invited" | "public_network" | "hybrid";
    contentBoundary: "public_or_test" | "private_workspace";
    privateSensitivity: "internal" | "confidential" | "restricted" | "regulated" | null;
    privateGroupId: string | null;
    requiredExpertiseKeys?: ReviewerExpertiseKey[];
    expertiseRequirements?: ReviewerExpertiseRequirement[];
    responseWindowSeconds: number | null;
    panelSize: number | null;
    compensationMode: "unpaid" | "usdc";
    bountyPerSeatAtomic: string | null;
    feedbackBonusEnabled?: boolean;
    feedbackBonusPoolAtomic?: string | null;
    feedbackBonusAwarderKind?: "requester" | "designated";
    feedbackBonusAwarderAccount?: string | null;
    feedbackBonusAwardWindowSeconds?: number | null;
    configurationStatus: "ready" | "action_required";
  };
  authority: "check_only" | "prepare_for_approval" | "ask_automatically";
};

const DEFAULT_REVIEW_DRAFT: AgentSetupReviewDraft = {
  schemaVersion: "rateloop.workspace-agent-setup-review.v2",
  bindingRevision: null,
  selection: {
    mode: "adaptive",
    enforcementMode: "advisory",
    agreementThresholdBps: 8_000,
    productionFloorBps: 1_000,
    fixedRateBps: null,
    maximumUnreviewedGap: 20,
    requiredRiskTiers: ["high"],
    criticalRiskTiers: ["critical"],
    minimumConfidenceBps: 7_000,
    maximumLatencyMs: 120_000,
  },
  requestProfile: {
    questionAuthority: "owner_fixed",
    resultSemantics: "assurance",
    criterion: "Is this response safe and correct?",
    positiveLabel: "Approve",
    negativeLabel: "Reject",
    rationaleMode: "required",
    audience: "private_invited",
    contentBoundary: "private_workspace",
    privateSensitivity: "confidential",
    privateGroupId: null,
    requiredExpertiseKeys: [],
    expertiseRequirements: [],
    responseWindowSeconds: 3_600,
    panelSize: 2,
    compensationMode: "unpaid",
    bountyPerSeatAtomic: null,
    feedbackBonusEnabled: false,
    feedbackBonusPoolAtomic: null,
    feedbackBonusAwarderKind: "requester",
    feedbackBonusAwarderAccount: null,
    feedbackBonusAwardWindowSeconds: null,
    configurationStatus: "ready",
  },
  authority: "check_only",
};

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowNumber(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  return Number.isSafeInteger(value) ? value : null;
}

function rowOptionalNumber(row: Row | undefined, key: string) {
  return row?.[key] === null || row?.[key] === undefined ? null : rowNumber(row, key);
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
    environment,
  };
  return { ...normalized, configurationCommitment: digest(stableJson(normalized)) };
}

function defaultReviewDraft(mode: AgentSetupReviewMode = "adaptive"): AgentSetupReviewDraft {
  return {
    ...DEFAULT_REVIEW_DRAFT,
    selection: { ...DEFAULT_REVIEW_DRAFT.selection, mode },
    requestProfile: { ...DEFAULT_REVIEW_DRAFT.requestProfile },
  };
}

function legacyReviewMode(input: unknown): AgentSetupReviewMode | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Partial<LegacyReviewDraft>;
  if (body.schemaVersion !== "rateloop.workspace-agent-setup-review.v1") return null;
  return (["adaptive", "always", "manual"] as unknown[]).includes(body.mode) ? body.mode! : null;
}

function migrateReviewDraft(input: unknown): AgentSetupReviewDraft {
  const legacyMode = legacyReviewMode(input);
  if (legacyMode) return defaultReviewDraft(legacyMode);
  if (!input || typeof input !== "object" || Array.isArray(input)) return defaultReviewDraft();
  const body = input as Partial<AgentSetupReviewDraft>;
  if (body.schemaVersion !== "rateloop.workspace-agent-setup-review.v2") return defaultReviewDraft();
  const mode = body.selection?.mode;
  if (!(["adaptive", "always", "manual", "rules", "fixed"] as unknown[]).includes(mode)) {
    return defaultReviewDraft();
  }
  return {
    ...defaultReviewDraft(mode!),
    ...body,
    schemaVersion: "rateloop.workspace-agent-setup-review.v2",
    bindingRevision:
      body.bindingRevision === null || (Number.isSafeInteger(body.bindingRevision) && Number(body.bindingRevision) > 0)
        ? (body.bindingRevision ?? null)
        : null,
    selection: { ...DEFAULT_REVIEW_DRAFT.selection, ...body.selection, mode: mode! },
    requestProfile: {
      ...DEFAULT_REVIEW_DRAFT.requestProfile,
      ...body.requestProfile,
      questionAuthority: body.requestProfile?.questionAuthority ?? "owner_fixed",
      resultSemantics: body.requestProfile?.resultSemantics ?? "assurance",
    },
  };
}

type OwnerReviewView = Awaited<ReturnType<typeof getHumanReviewConfigurationForOwner>>;

function reviewDraftFromOwnerView(view: OwnerReviewView): AgentSetupReviewDraft | null {
  const configuration = view.configuration;
  if (!configuration) return null;
  const selection = configuration.selection.value;
  const profile = configuration.requestProfile.value;
  if (
    !(["adaptive", "always", "manual", "rules", "fixed"] as unknown[]).includes(selection.mode) ||
    !(["advisory", "host_enforced"] as unknown[]).includes(selection.enforcementMode) ||
    !(["off", "optional", "required"] as unknown[]).includes(profile.rationaleMode) ||
    !(["owner_fixed", "agent_per_request"] as unknown[]).includes(profile.questionAuthority) ||
    !(["assurance", "feedback"] as unknown[]).includes(profile.resultSemantics) ||
    !(["private_invited", "public_network", "hybrid"] as unknown[]).includes(profile.audience) ||
    !(["public_or_test", "private_workspace"] as unknown[]).includes(profile.contentBoundary) ||
    !([null, "internal", "confidential", "restricted", "regulated"] as unknown[]).includes(
      profile.privateSensitivity,
    ) ||
    !(["unpaid", "usdc"] as unknown[]).includes(profile.compensationMode) ||
    typeof profile.feedbackBonusEnabled !== "boolean" ||
    !(["requester", "designated"] as unknown[]).includes(profile.feedbackBonusAwarderKind) ||
    !(["ready", "action_required"] as unknown[]).includes(profile.configurationStatus)
  ) {
    throw new Error("Saved human-review configuration is invalid.");
  }
  return {
    schemaVersion: "rateloop.workspace-agent-setup-review.v2",
    bindingRevision: view.bindingRevision,
    selection: {
      mode: selection.mode as AgentSetupReviewMode,
      enforcementMode: selection.enforcementMode as AgentSetupReviewDraft["selection"]["enforcementMode"],
      agreementThresholdBps: selection.agreementThresholdBps,
      productionFloorBps: selection.productionFloorBps,
      fixedRateBps: selection.fixedRateBps ?? null,
      maximumUnreviewedGap: selection.maximumUnreviewedGap,
      requiredRiskTiers: selection.requiredRiskTiers,
      criticalRiskTiers: selection.criticalRiskTiers,
      minimumConfidenceBps: selection.minimumConfidenceBps ?? null,
      maximumLatencyMs: selection.maximumLatencyMs ?? null,
    },
    requestProfile: {
      questionAuthority: profile.questionAuthority as AgentSetupReviewDraft["requestProfile"]["questionAuthority"],
      resultSemantics: profile.resultSemantics as AgentSetupReviewDraft["requestProfile"]["resultSemantics"],
      criterion: profile.criterion,
      positiveLabel: profile.positiveLabel,
      negativeLabel: profile.negativeLabel,
      rationaleMode: profile.rationaleMode as AgentSetupReviewDraft["requestProfile"]["rationaleMode"],
      audience: profile.audience as AgentSetupReviewDraft["requestProfile"]["audience"],
      contentBoundary: profile.contentBoundary as AgentSetupReviewDraft["requestProfile"]["contentBoundary"],
      privateSensitivity: profile.privateSensitivity as AgentSetupReviewDraft["requestProfile"]["privateSensitivity"],
      privateGroupId: profile.privateGroupId,
      requiredExpertiseKeys: normalizeReviewerExpertiseKeys(profile.requiredExpertiseKeys),
      expertiseRequirements: normalizeReviewerExpertiseRequirementsSelection(
        profile.expertiseRequirements,
        profile.panelSize ?? MAXIMUM_REVIEW_PANEL_SIZE,
      ),
      responseWindowSeconds: profile.responseWindowSeconds,
      panelSize: profile.panelSize,
      compensationMode: profile.compensationMode as AgentSetupReviewDraft["requestProfile"]["compensationMode"],
      bountyPerSeatAtomic: profile.bountyPerSeatAtomic,
      feedbackBonusEnabled: profile.feedbackBonusEnabled === true,
      feedbackBonusPoolAtomic: profile.feedbackBonusPoolAtomic,
      feedbackBonusAwarderKind: profile.feedbackBonusAwarderKind === "designated" ? "designated" : "requester",
      feedbackBonusAwarderAccount: profile.feedbackBonusAwarderAccount,
      feedbackBonusAwardWindowSeconds: profile.feedbackBonusAwardWindowSeconds,
      configurationStatus:
        profile.configurationStatus as AgentSetupReviewDraft["requestProfile"]["configurationStatus"],
    },
    authority: configuration.authority,
  };
}

function isReviewDraftReady(draft: AgentSetupReviewDraft | null): draft is AgentSetupReviewDraft {
  return Boolean(
    draft &&
      draft.bindingRevision !== null &&
      draft.requestProfile.configurationStatus === "ready" &&
      ((draft.requestProfile.questionAuthority === "owner_fixed" &&
        draft.requestProfile.resultSemantics === "assurance" &&
        Boolean(draft.requestProfile.criterion) &&
        Boolean(draft.requestProfile.positiveLabel) &&
        Boolean(draft.requestProfile.negativeLabel)) ||
        (draft.requestProfile.questionAuthority === "agent_per_request" &&
          draft.requestProfile.resultSemantics === "feedback" &&
          draft.requestProfile.criterion === null &&
          draft.requestProfile.positiveLabel === null &&
          draft.requestProfile.negativeLabel === null &&
          draft.requestProfile.audience === "public_network" &&
          draft.requestProfile.contentBoundary === "public_or_test" &&
          draft.selection.mode !== "adaptive")) &&
      Number.isSafeInteger(draft.requestProfile.responseWindowSeconds) &&
      Number(draft.requestProfile.responseWindowSeconds) >= 1_200 &&
      Number.isSafeInteger(draft.requestProfile.panelSize) &&
      Number(draft.requestProfile.panelSize) >= 1,
  );
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
                 v.declared_model_version,v.environment
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
  const ownerReviewView =
    access.canManage && confirmed && rowString(row, "agent_id")
      ? await getHumanReviewConfigurationForOwner({
          accountAddress: access.actor,
          workspaceId: input.workspaceId,
          agentId: rowString(row, "agent_id")!,
        })
      : null;
  const savedReviewDraft =
    ownerReviewView?.agent.agentVersionId === rowString(row, "confirmed_agent_version_id")
      ? reviewDraftFromOwnerView(ownerReviewView)
      : null;
  const reviewsConfirmed =
    confirmed && Boolean(rowString(row, "reviews_confirmed_at")) && isReviewDraftReady(savedReviewDraft);
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
  const reviewDraft = savedReviewDraft ?? migrateReviewDraft(parseJson<unknown>(row.review_draft_json, {}));
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

export async function updateWorkspaceSetupName(input: {
  accountAddress: string;
  workspaceId: string;
  revision: unknown;
  name: unknown;
}) {
  await requireManager(input.accountAddress, input.workspaceId);
  const expectedRevision = requiredRevision(input.revision);
  const name = bounded(input.name, "Workspace name", 120)!;
  const now = new Date();
  const client = await dbPool.connect();
  let revision = expectedRevision;
  try {
    await client.query("BEGIN");
    const setupResult = await client.query(
      `SELECT revision,status FROM tokenless_workspace_agent_setups WHERE workspace_id=$1 FOR UPDATE`,
      [input.workspaceId],
    );
    const setup = setupResult.rows[0] as Row | undefined;
    if (!setup || rowString(setup, "status") !== "in_progress") {
      throw new TokenlessServiceError("Workspace setup is not active.", 409, "agent_setup_not_active");
    }
    if (rowNumber(setup, "revision") !== expectedRevision) {
      throw new TokenlessServiceError("Workspace setup changed. Reload and try again.", 409, "agent_setup_conflict");
    }
    const workspaceResult = await client.query(
      `SELECT name FROM tokenless_workspaces WHERE workspace_id=$1 AND status='active' FOR UPDATE`,
      [input.workspaceId],
    );
    const workspace = workspaceResult.rows[0] as Row | undefined;
    if (!workspace) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
    if (rowString(workspace, "name") !== name) {
      revision = expectedRevision + 1;
      await client.query(`UPDATE tokenless_workspaces SET name=$1,updated_at=$2 WHERE workspace_id=$3`, [
        name,
        now,
        input.workspaceId,
      ]);
      await client.query(
        `UPDATE tokenless_workspace_agent_setups SET revision=$1,updated_at=$2 WHERE workspace_id=$3`,
        [revision, now, input.workspaceId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { workspaceName: name, revision };
}

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
              v.declared_provider,v.declared_model,v.declared_model_version,v.environment
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
          declared_model,declared_model_version,environment,
          configuration_commitment,created_by,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
          production_floor_bps,fixed_rate_bps,maximum_unreviewed_gap,rules_json,audience_policy_json,publishing_policy_id,
          created_by,approved_by,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15)`,
        [
          reviewPolicyId,
          reviewPolicyVersion,
          input.workspaceId,
          agentId,
          confirmedVersionId,
          rowString(policy, "mode"),
          rowNumber(policy, "agreement_threshold_bps"),
          rowNumber(policy, "production_floor_bps"),
          rowOptionalNumber(policy, "fixed_rate_bps"),
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
  await recordWorkspaceSetupFunnelEvent({
    accountAddress: access.actor,
    workspaceId: input.workspaceId,
    event: "agent_details_confirmed",
    revision: expectedRevision + 1,
    occurredAt: now,
  });
  return { confirmedAgentVersionId: confirmedVersionId, revision: expectedRevision + 1 };
}

export async function configureWorkspaceSetupReviews(input: {
  accountAddress: string;
  workspaceId: string;
  revision: unknown;
  bindingRevision: unknown;
}) {
  const access = await requireManager(input.accountAddress, input.workspaceId);
  const expectedRevision = requiredRevision(input.revision);
  const bindingRevision = Number(input.bindingRevision);
  if (!Number.isSafeInteger(bindingRevision) || bindingRevision < 1) {
    throw new TokenlessServiceError(
      "Save the human-review configuration before continuing.",
      409,
      "agent_setup_review_configuration_required",
    );
  }
  const current = await dbClient.execute({
    sql: `SELECT s.revision,s.confirmed_agent_version_id,s.people_decision,s.private_group_id,
                 s.people_decided_at,s.people_decided_by,i.agent_id
          FROM tokenless_workspace_agent_setups s
          JOIN tokenless_agent_integrations i
            ON i.integration_id=s.primary_integration_id AND i.workspace_id=s.workspace_id AND i.status='active'
          WHERE s.workspace_id=? AND s.status='in_progress' LIMIT 1`,
    args: [input.workspaceId],
  });
  const setup = current.rows[0] as Row | undefined;
  const agentId = rowString(setup, "agent_id");
  if (rowNumber(setup, "revision") !== expectedRevision || !agentId) {
    throw new TokenlessServiceError("Workspace setup changed. Reload and try again.", 409, "agent_setup_conflict");
  }
  const ownerView = await getHumanReviewConfigurationForOwner({
    accountAddress: access.actor,
    workspaceId: input.workspaceId,
    agentId,
  });
  const review = reviewDraftFromOwnerView(ownerView);
  if (
    !isReviewDraftReady(review) ||
    review.bindingRevision !== bindingRevision ||
    ownerView.agent.agentVersionId !== rowString(setup, "confirmed_agent_version_id") ||
    review.requestProfile.responseWindowSeconds === null ||
    review.requestProfile.panelSize === null
  ) {
    throw new TokenlessServiceError(
      "The saved human-review configuration does not match this setup.",
      409,
      "agent_setup_review_configuration_mismatch",
    );
  }
  const preservePeople =
    Boolean(rowString(setup, "people_decision")) &&
    rowString(setup, "private_group_id") === review.requestProfile.privateGroupId;
  const now = new Date();
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_workspace_agent_setups
          SET review_draft_json=?,reviews_confirmed_at=?,reviews_confirmed_by=?,
              people_decision=?,private_group_id=?,people_decided_at=?,people_decided_by=?,
              current_step='people',revision=?,updated_at=?
          WHERE workspace_id=? AND status='in_progress' AND revision=?
            AND confirmed_agent_version_id=? AND agent_confirmed_at IS NOT NULL
            AND human_review_binding_id=? AND human_review_binding_version=?`,
    args: [
      JSON.stringify(review),
      now,
      access.actor,
      preservePeople ? rowString(setup, "people_decision") : null,
      review.requestProfile.privateGroupId,
      preservePeople ? setup?.people_decided_at : null,
      preservePeople ? rowString(setup, "people_decided_by") : null,
      expectedRevision + 1,
      now,
      input.workspaceId,
      expectedRevision,
      ownerView.agent.agentVersionId,
      ownerView.configuration!.binding.id,
      bindingRevision,
    ],
  });
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError("Workspace setup changed. Reload and try again.", 409, "agent_setup_conflict");
  }
  await recordWorkspaceSetupFunnelEvent({
    accountAddress: access.actor,
    workspaceId: input.workspaceId,
    event: "review_behavior_confirmed",
    revision: expectedRevision + 1,
    occurredAt: now,
  });
  return { review, revision: expectedRevision + 1 };
}

export async function configureWorkspaceSetupPeople(input: {
  accountAddress: string;
  workspaceId: string;
  revision: unknown;
  decision: unknown;
  groupId?: unknown;
  createInvitation?: unknown;
  intendedEmail?: unknown;
  expertiseDefinitionIds?: unknown;
}) {
  const access = await requireManager(input.accountAddress, input.workspaceId);
  const expectedRevision = requiredRevision(input.revision);
  const current = await dbClient.execute({
    sql: `SELECT s.revision,s.reviews_confirmed_at,s.private_group_id,i.agent_id
          FROM tokenless_workspace_agent_setups s
          JOIN tokenless_agent_integrations i
            ON i.integration_id=s.primary_integration_id AND i.workspace_id=s.workspace_id AND i.status='active'
          WHERE s.workspace_id=? AND s.status='in_progress' LIMIT 1`,
    args: [input.workspaceId],
  });
  const setup = current.rows[0] as Row | undefined;
  const agentId = rowString(setup, "agent_id");
  if (rowNumber(setup, "revision") !== expectedRevision || !rowString(setup, "reviews_confirmed_at") || !agentId) {
    throw new TokenlessServiceError("Workspace setup changed. Reload and try again.", 409, "agent_setup_conflict");
  }
  const review = reviewDraftFromOwnerView(
    await getHumanReviewConfigurationForOwner({
      accountAddress: access.actor,
      workspaceId: input.workspaceId,
      agentId,
    }),
  );
  if (!isReviewDraftReady(review)) {
    throw new TokenlessServiceError(
      "Save the exact human-review configuration before continuing.",
      409,
      "agent_setup_review_configuration_required",
    );
  }
  const requiresInvitedGroup = review.requestProfile.audience !== "public_network";
  if (
    (requiresInvitedGroup && input.decision !== "invited" && input.decision !== "later") ||
    (!requiresInvitedGroup && input.decision !== "not_required")
  ) {
    throw new TokenlessServiceError(
      "People decision does not match the review audience.",
      400,
      "invalid_agent_setup_people",
    );
  }
  const boundGroupId = review.requestProfile.privateGroupId;
  if (requiresInvitedGroup && (!boundGroupId || rowString(setup, "private_group_id") !== boundGroupId)) {
    throw new TokenlessServiceError("The exact reviewer group is unavailable.", 409, "agent_setup_group_unavailable");
  }
  if (typeof input.groupId === "string" && input.groupId && input.groupId !== boundGroupId) {
    throw new TokenlessServiceError(
      "The selected reviewer group does not match the saved review profile.",
      409,
      "agent_setup_group_unavailable",
    );
  }
  if (boundGroupId) {
    const selected = await dbClient.execute({
      sql: `SELECT group_id FROM tokenless_private_groups
            WHERE workspace_id=? AND group_id=? AND status='active' LIMIT 1`,
      args: [input.workspaceId, boundGroupId],
    });
    if (!rowString(selected.rows[0] as Row | undefined, "group_id")) {
      throw new TokenlessServiceError("Reviewer group is unavailable.", 409, "agent_setup_group_unavailable");
    }
  }
  let invitation: Awaited<ReturnType<typeof createPrivateGroupInvitation>> | null = null;
  if (input.createInvitation === true) {
    if (!boundGroupId || input.decision !== "invited") {
      throw new TokenlessServiceError(
        "An invitation is not allowed for this review audience.",
        400,
        "invalid_agent_setup_people",
      );
    }
    const intendedEmail =
      input.intendedEmail === undefined || input.intendedEmail === null || input.intendedEmail === ""
        ? null
        : bounded(input.intendedEmail, "Recipient email", 320);
    const expertiseDefinitionIds = input.expertiseDefinitionIds ?? [];
    if (
      !Array.isArray(expertiseDefinitionIds) ||
      expertiseDefinitionIds.length > 8 ||
      expertiseDefinitionIds.some(value => typeof value !== "string") ||
      new Set(expertiseDefinitionIds).size !== expertiseDefinitionIds.length
    ) {
      throw new TokenlessServiceError("Invitation specialist areas are invalid.", 400, "invalid_agent_setup_people");
    }
    const expertiseDefinitions = expertiseDefinitionIds.map(definitionId => {
      const requirement = review.requestProfile.expertiseRequirements.find(
        candidate => candidate.definitionId === definitionId,
      );
      if (!requirement || requirement.sourceScope !== "customer_invited") {
        throw new TokenlessServiceError(
          "An invitation specialist area is not required by this review profile.",
          400,
          "invalid_agent_setup_people",
        );
      }
      return {
        definitionId: requirement.definitionId,
        definitionVersion: requirement.definitionVersion,
        definitionHash: requirement.definitionHash,
      };
    });
    if (expertiseDefinitions.length > 0 && !intendedEmail) {
      throw new TokenlessServiceError(
        "Enter the recipient email before assigning intended specialist areas.",
        400,
        "invalid_agent_setup_people",
      );
    }
    invitation = await createPrivateGroupInvitation({
      accountAddress: access.actor,
      workspaceId: input.workspaceId,
      groupId: boundGroupId,
      intendedEmail,
      maximumRedemptions: 1,
      expertiseDefinitions,
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
      boundGroupId,
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
  await recordWorkspaceSetupFunnelEvent({
    accountAddress: access.actor,
    workspaceId: input.workspaceId,
    event: invitation ? "reviewer_invitation_issued" : "reviewers_deferred",
    revision: expectedRevision + 1,
    occurredAt: now,
  });
  return { groupId: boundGroupId, invitation, revision: expectedRevision + 1 };
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
    const groupId = rowString(setup, "private_group_id");
    const bindingId = rowString(setup, "human_review_binding_id");
    const bindingVersion = rowNumber(setup, "human_review_binding_version");
    const bindingResult = await client.query(
      `SELECT b.selection_policy_id,b.selection_policy_version,b.publishing_policy_id,b.publishing_policy_version,
              b.authority,
              r.audience,r.private_group_id,r.configuration_status,r.response_window_seconds,r.panel_size
       FROM tokenless_agent_human_review_bindings b
       JOIN tokenless_agent_review_policies p
         ON p.workspace_id=b.workspace_id AND p.policy_id=b.selection_policy_id
        AND p.version=b.selection_policy_version AND p.enabled=true AND p.superseded_at IS NULL
       JOIN tokenless_agent_review_request_profiles r
         ON r.workspace_id=b.workspace_id AND r.profile_id=b.request_profile_id
        AND r.version=b.request_profile_version AND r.profile_hash=b.request_profile_hash
        AND r.superseded_at IS NULL
       WHERE b.workspace_id=$1 AND b.binding_id=$2 AND b.version=$3
         AND b.agent_id=$4 AND b.agent_version_id=$5 AND b.enabled=true AND b.superseded_at IS NULL
       FOR SHARE`,
      [
        input.workspaceId,
        bindingId,
        bindingVersion,
        rowString(integration, "agent_id"),
        rowString(integration, "agent_version_id"),
      ],
    );
    const binding = bindingResult.rows[0] as Row | undefined;
    const requiresInvitedGroup = rowString(binding, "audience") !== "public_network";
    const groupStatus =
      requiresInvitedGroup && groupId
        ? rowString(
            (
              await client.query(
                `SELECT status FROM tokenless_private_groups
                 WHERE workspace_id=$1 AND group_id=$2 FOR SHARE`,
                [input.workspaceId, groupId],
              )
            ).rows[0] as Row | undefined,
            "status",
          )
        : null;
    const authority = rowString(binding, "authority");
    const publishingPolicyId = rowString(binding, "publishing_policy_id");
    const publishingPolicyVersion = rowOptionalNumber(binding, "publishing_policy_version");
    const automaticAuthority = authority === "ask_automatically";
    const integrationScopes = parseJson<string[]>(integration?.granted_scopes_json, []);
    const allowedWorkflowKeys = parseJson<string[]>(integration?.allowed_workflow_keys_json, []);
    const exactAutomaticGrant =
      automaticAuthority &&
      Boolean(publishingPolicyId && publishingPolicyVersion) &&
      rowString(integration, "activation_mode") === "owner_approved" &&
      rowString(integration, "publishing_policy_id") === publishingPolicyId &&
      rowOptionalNumber(integration, "publishing_policy_version") === publishingPolicyVersion &&
      integrationScopes.includes("panel:publish") &&
      integrationScopes.includes("payment:submit") &&
      allowedWorkflowKeys.length > 0;
    const safeAuthority = authority === "check_only" || authority === "prepare_for_approval";
    const groupMatches = requiresInvitedGroup
      ? Boolean(groupId && rowString(binding, "private_group_id") === groupId && groupStatus === "active")
      : groupId === null && rowString(binding, "private_group_id") === null;
    if (
      !binding ||
      (!safeAuthority && !exactAutomaticGrant) ||
      (safeAuthority && publishingPolicyId !== null) ||
      rowString(binding, "configuration_status") !== "ready" ||
      rowOptionalNumber(binding, "response_window_seconds") === null ||
      rowOptionalNumber(binding, "panel_size") === null ||
      !groupMatches ||
      rowString(integration, "human_review_binding_id") !== bindingId ||
      rowNumber(integration, "human_review_binding_version") !== bindingVersion
    ) {
      throw new TokenlessServiceError(
        "The saved human-review configuration no longer matches this setup.",
        409,
        "agent_setup_review_configuration_mismatch",
      );
    }
    policyId = rowString(binding, "selection_policy_id")!;
    policyVersion = rowNumber(binding, "selection_policy_version")!;
    if (safeAuthority) {
      await client.query(
        `UPDATE tokenless_agent_integrations
         SET review_policy_id=$1,review_policy_version=$2,publishing_policy_id=NULL,
             publishing_policy_version=NULL,activation_mode='preauthorized_safe',
             granted_scopes_json=$3,updated_at=$4
         WHERE integration_id=$5`,
        [
          policyId,
          policyVersion,
          JSON.stringify(SAFE_AGENT_CONNECTION_SCOPES),
          now,
          rowString(integration, "integration_id"),
        ],
      );
    } else {
      await client.query(
        `UPDATE tokenless_agent_integrations
         SET review_policy_id=$1,review_policy_version=$2,updated_at=$3
         WHERE integration_id=$4`,
        [policyId, policyVersion, now, rowString(integration, "integration_id")],
      );
    }
    await client.query(
      `UPDATE tokenless_workspace_agent_setups
       SET status='completed',current_step='complete',primary_integration_id=$1,
           review_policy_id=$2,review_policy_version=$3,publishing_policy_id=$4,publishing_policy_version=$5,
           revision=$6,completed_at=$7,completed_by=$8,updated_at=$7
       WHERE workspace_id=$9`,
      [
        rowString(integration, "integration_id"),
        policyId,
        policyVersion,
        publishingPolicyId,
        publishingPolicyVersion,
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
  await recordWorkspaceSetupFunnelEvent({
    accountAddress: access.actor,
    workspaceId: input.workspaceId,
    event: "workspace_setup_completed",
    revision: expectedRevision + 1,
    occurredAt: now,
  });
  return {
    destination: `/agents?workspace=${encodeURIComponent(input.workspaceId)}&tab=overview`,
    idempotent: false,
    policyId,
    policyVersion,
    revision: expectedRevision + 1,
  };
}
