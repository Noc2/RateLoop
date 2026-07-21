import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import {
  SAFE_AGENT_CONNECTION_SCOPES,
  connectionLaneFromClientCapabilitiesJson,
} from "~~/lib/tokenless/agentConnectionIntents";
import {
  type HumanReviewPaymentProfile,
  automaticHumanReviewGrantScopes,
  humanReviewRequiresPayment,
  sameAutomaticHumanReviewGrantScopes,
} from "~~/lib/tokenless/humanReviewGrantScopes";
import {
  HUMAN_REVIEW_AUTHORITY_LEVELS,
  type HumanReviewAuthorityLevel,
  deployedHumanReviewReadiness,
  resolveHumanReviewCapability,
} from "~~/lib/tokenless/reviewCapabilities";
import { normalizeManagedReviewPolicyInput } from "~~/lib/tokenless/reviewPolicyManagement";
import {
  REVIEW_REQUEST_PRIVATE_SENSITIVITIES,
  hashReviewRequestProfile,
  normalizeReviewRequestProfileInput,
} from "~~/lib/tokenless/reviewRequestProfiles";
import { exactReviewerExpertiseDefinitionKey } from "~~/lib/tokenless/reviewerExpertiseAssignments";
import { validateReviewerExpertiseRequirementsWithClient } from "~~/lib/tokenless/reviewerExpertiseDefinitions";
import { expertiseQualificationRules } from "~~/lib/tokenless/reviewerExpertiseVocabulary";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  type WorkspacePrivateReviewRoutingReadiness,
  provisionWorkspacePrivateReviewRouting,
  workspacePrivateReviewRoutingIds,
} from "~~/lib/tokenless/workspacePrivateReviewRouting";

type Row = Record<string, unknown>;

export type HumanReviewVersionReference = { id: string; version: number };

export type HumanReviewConfiguration = {
  bindingId: string;
  version: number;
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  selectionPolicy: HumanReviewVersionReference;
  requestProfile: HumanReviewVersionReference & { hash: string };
  publishingPolicy: HumanReviewVersionReference | null;
  authority: HumanReviewAuthorityLevel;
  enabled: boolean;
  canonicalHash: string;
  createdBy: string;
  createdAt: string;
  approvedBy: string;
  approvedAt: string;
  supersededAt: string | null;
};

export type SaveHumanReviewConfigurationInput = {
  accountAddress: string;
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  expectedBindingVersion: number | null;
  selectionPolicy?: HumanReviewVersionReference;
  requestProfile?: HumanReviewVersionReference;
  publishingPolicy?: HumanReviewVersionReference | null;
  authority?: HumanReviewAuthorityLevel;
};

export type PutHumanReviewConfigurationInput = {
  accountAddress: string;
  workspaceId: string;
  agentId: string;
  body: unknown;
};

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const WORKFLOW_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SAFE_EVALUATION_SCOPES = ["evaluation:read", "review:decide"] as const;
const OWNER_BODY_KEYS = new Set([
  "expectedBindingVersion",
  "selection",
  "requestProfile",
  "authority",
  "publishingGrant",
]);
const OWNER_SELECTION_KEYS = new Set([
  "mode",
  "enforcementMode",
  "agreementThresholdBps",
  "productionFloorBps",
  "fixedRateBps",
  "maximumUnreviewedGap",
  "requiredRiskTiers",
  "criticalRiskTiers",
  "minimumConfidenceBps",
  "maximumLatencyMs",
]);
const OWNER_PROFILE_KEYS = new Set([
  "questionAuthority",
  "criterion",
  "positiveLabel",
  "negativeLabel",
  "rationaleMode",
  "audience",
  "contentBoundary",
  "privateSensitivity",
  "privateGroupId",
  "requiredExpertiseKeys",
  "expertiseRequirements",
  "responseWindowSeconds",
  "panelSize",
  "compensationMode",
  "bountyPerSeatAtomic",
  "feedbackBonusEnabled",
  "feedbackBonusPoolAtomic",
  "feedbackBonusAwarderKind",
  "feedbackBonusAwarderAccount",
  "feedbackBonusAwardWindowSeconds",
]);
const OWNER_GRANT_KEYS = new Set([
  "integrationId",
  "publishingPolicyId",
  "publishingPolicyVersion",
  "allowedWorkflowKeys",
  "provision",
]);

type ExactOwnerPublishingGrant = {
  integrationId: string;
  publishingPolicyId: string;
  publishingPolicyVersion: number;
  allowedWorkflowKeys: string[];
};

type ProvisionedOwnerPublishingGrant = {
  integrationId: string;
  provision: "private_invited_unpaid";
  allowedWorkflowKeys: string[];
};

function configurationError(message: string, code = "invalid_human_review_configuration"): never {
  throw new TokenlessServiceError(message, 400, code);
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
  const encoded = JSON.stringify(value);
  if (encoded === undefined) configurationError("Human-review configuration values must be JSON serializable.");
  return encoded;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowInteger(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Database returned an invalid ${key}.`);
  return value;
}

function rowBasisPoints(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`Database returned an invalid ${key}.`);
  }
  return value;
}

function iso(value: unknown, field: string) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`Database returned an invalid ${field}.`);
  return date.toISOString();
}

function reference(value: unknown, field: string): HumanReviewVersionReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    configurationError(`${field} must identify an immutable version.`);
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).some(key => !["id", "version"].includes(key)) ||
    typeof candidate.id !== "string" ||
    !candidate.id.trim() ||
    !Number.isSafeInteger(candidate.version) ||
    Number(candidate.version) < 1
  ) {
    configurationError(`${field} must contain an ID and positive integer version.`);
  }
  return { id: candidate.id.trim(), version: Number(candidate.version) };
}

function parseStringArray(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== "string")) throw new Error();
    return parsed as string[];
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function selectionAudience(value: unknown) {
  try {
    const parsed = JSON.parse(String(value)) as { reviewerSource?: unknown };
    if (typeof parsed.reviewerSource !== "string") throw new Error();
    if (parsed.reviewerSource === "customer_invited") return "private_invited";
    if (parsed.reviewerSource === "rateloop_network") return "public_network";
    return parsed.reviewerSource;
  } catch {
    throw new Error("Database returned an invalid selection-policy audience.");
  }
}

function semanticDocument(input: {
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  selectionPolicy: HumanReviewVersionReference;
  requestProfile: HumanReviewVersionReference & { hash: string };
  publishingPolicy: HumanReviewVersionReference | null;
  authority: HumanReviewAuthorityLevel;
}) {
  return {
    schemaVersion: "rateloop.human-review-configuration.v1",
    workspaceId: input.workspaceId,
    agent: { agentId: input.agentId, agentVersionId: input.agentVersionId },
    selectionPolicy: input.selectionPolicy,
    requestProfile: input.requestProfile,
    publishingPolicy: input.publishingPolicy,
    authority: input.authority,
  };
}

export function hashHumanReviewConfiguration(input: Parameters<typeof semanticDocument>[0]) {
  return sha256(stableJson(semanticDocument(input)));
}

export function humanReviewEvaluationPartition(input: {
  agentVersionId: string;
  selectionPolicy: HumanReviewVersionReference;
  workflowKey: string;
  riskTier: string;
  audiencePolicyHash: string;
  executionProfileHash: string;
  requestProfileHash: string;
}) {
  if (
    ![input.audiencePolicyHash, input.executionProfileHash, input.requestProfileHash].every(hash =>
      HASH_PATTERN.test(hash),
    )
  ) {
    configurationError("Evaluation partition hashes are invalid.");
  }
  const document = {
    schemaVersion: "rateloop.human-review-evaluation-partition.v1",
    agentVersionId: input.agentVersionId,
    selectionPolicy: input.selectionPolicy,
    workflowKey: input.workflowKey,
    riskTier: input.riskTier,
    audiencePolicyHash: input.audiencePolicyHash,
    executionProfileHash: input.executionProfileHash,
    requestProfileHash: input.requestProfileHash,
  };
  return { document, commitment: sha256(stableJson(document)) };
}

export function humanReviewReplayIdentity(input: {
  workspaceId: string;
  agentId: string;
  externalOpportunityId: string;
  requestProfileHash: string;
}) {
  if (!HASH_PATTERN.test(input.requestProfileHash)) configurationError("Replay request-profile hash is invalid.");
  const document = {
    schemaVersion: "rateloop.human-review-replay-identity.v1",
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    externalOpportunityId: input.externalOpportunityId,
  };
  return {
    document,
    identity: sha256(stableJson(document)),
    requestProfileHash: input.requestProfileHash,
  };
}

async function requireManagement(accountAddress: string, workspaceId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account identity is invalid.", 400, "invalid_account");
  }
  const result = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ? AND w.status = 'active'
            AND m.role IN ('owner','admin') LIMIT 1`,
    args: [workspaceId, actor],
  });
  if (result.rowCount !== 1) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

async function exactAutomaticDelegation(
  client: PoolClient,
  input: {
    workspaceId: string;
    agentId: string;
    agentVersionId: string;
    publishingPolicy: HumanReviewVersionReference;
    paymentProfile: HumanReviewPaymentProfile;
    now: Date;
  },
) {
  const result = await client.query(
    `SELECT i.granted_scopes_json, i.allowed_workflow_keys_json
     FROM tokenless_agent_integrations i
     JOIN tokenless_agent_connection_intents c ON c.intent_id = i.connection_intent_id
     JOIN tokenless_agent_oauth_token_families f ON f.token_family_id = i.token_family_id
     WHERE i.workspace_id = $1 AND i.agent_id = $2 AND i.agent_version_id = $3
       AND i.publishing_policy_id = $4 AND i.publishing_policy_version = $5
       AND i.status = 'active' AND i.revoked_at IS NULL AND i.activation_mode = 'owner_approved'
       AND c.status = 'connected'
       AND f.status = 'active' AND f.revoked_at IS NULL AND f.absolute_expires_at > $6
     FOR SHARE`,
    [
      input.workspaceId,
      input.agentId,
      input.agentVersionId,
      input.publishingPolicy.id,
      input.publishingPolicy.version,
      input.now,
    ],
  );
  return result.rows.some(row => {
    const scopes = parseStringArray((row as Row).granted_scopes_json, "delegation scopes");
    const workflows = parseStringArray((row as Row).allowed_workflow_keys_json, "delegation workflows");
    return (
      sameAutomaticHumanReviewGrantScopes(scopes, input.paymentProfile) &&
      workflows.length >= 1 &&
      workflows.length <= 32 &&
      workflows.every(workflow => WORKFLOW_PATTERN.test(workflow))
    );
  });
}

async function validateExactObjects(
  client: PoolClient,
  input: {
    workspaceId: string;
    agentId: string;
    agentVersionId: string;
    selectionPolicy: HumanReviewVersionReference;
    requestProfile: HumanReviewVersionReference;
    publishingPolicy: HumanReviewVersionReference | null;
    authority: HumanReviewAuthorityLevel;
    now: Date;
  },
) {
  const agent = await client.query(
    `SELECT 1 FROM tokenless_agents a
     JOIN tokenless_agent_versions v
       ON v.workspace_id = a.workspace_id AND v.agent_id = a.agent_id
     WHERE a.workspace_id = $1 AND a.agent_id = $2 AND a.status = 'active' AND v.version_id = $3
     FOR SHARE`,
    [input.workspaceId, input.agentId, input.agentVersionId],
  );
  if (agent.rowCount !== 1) {
    throw new TokenlessServiceError("Active agent version not found.", 404, "agent_version_not_found");
  }
  const selection = await client.query(
    `SELECT mode, rules_json, audience_policy_json FROM tokenless_agent_review_policies
     WHERE workspace_id = $1 AND policy_id = $2 AND version = $3
       AND agent_id = $4 AND agent_version_id = $5 AND enabled = true AND superseded_at IS NULL
     FOR SHARE`,
    [input.workspaceId, input.selectionPolicy.id, input.selectionPolicy.version, input.agentId, input.agentVersionId],
  );
  if (selection.rowCount !== 1) {
    throw new TokenlessServiceError(
      "The active selection-policy version does not belong to this workspace and agent version.",
      409,
      "human_review_selection_policy_mismatch",
    );
  }
  const selectionRow = selection.rows[0] as Row;
  const selectionMode = rowString(selectionRow, "mode");
  const selectionRules = parseJsonObject(selectionRow.rules_json, "review rules");
  if (
    selectionMode === "manual" &&
    (selectionRules.enforcementMode !== "advisory" ||
      input.authority !== "check_only" ||
      input.publishingPolicy !== null)
  ) {
    throw new TokenlessServiceError(
      "Manual handoff configurations must be advisory, check-only, and have no publishing grant.",
      409,
      "human_review_manual_invariant_mismatch",
    );
  }
  const profile = await client.query(
    `SELECT audience, configuration_status, profile_hash, approved_at,
            compensation_mode, feedback_bonus_enabled
     FROM tokenless_agent_review_request_profiles
     WHERE workspace_id = $1 AND profile_id = $2 AND version = $3
       AND agent_id = $4 AND agent_version_id = $5 AND superseded_at IS NULL
     FOR SHARE`,
    [input.workspaceId, input.requestProfile.id, input.requestProfile.version, input.agentId, input.agentVersionId],
  );
  const profileRow = profile.rows[0] as Row | undefined;
  const profileHash = rowString(profileRow, "profile_hash");
  if (profile.rowCount !== 1 || !profileHash || !HASH_PATTERN.test(profileHash)) {
    throw new TokenlessServiceError(
      "The active request-profile version does not belong to this workspace and agent version.",
      409,
      "human_review_request_profile_mismatch",
    );
  }
  const profileAudience = rowString(profileRow, "audience");
  const compensationMode = rowString(profileRow, "compensation_mode");
  if (compensationMode !== "unpaid" && compensationMode !== "usdc") {
    throw new Error("Database returned invalid review compensation.");
  }
  const paymentProfile: HumanReviewPaymentProfile = {
    compensationMode,
    feedbackBonusEnabled: profileRow?.feedback_bonus_enabled === true || profileRow?.feedback_bonus_enabled === "t",
  };
  const policyAudience = selectionAudience(selectionRow.audience_policy_json);
  if (profileAudience !== policyAudience) {
    throw new TokenlessServiceError(
      "The request profile owns the reviewer audience; the selection policy must use the same audience.",
      409,
      "human_review_audience_mismatch",
    );
  }
  if (input.publishingPolicy) {
    const publishing = await client.query(
      `SELECT 1 FROM tokenless_agent_publishing_policies
       WHERE workspace_id = $1 AND policy_id = $2 AND version = $3
         AND enabled = true AND revoked_at IS NULL AND effective_at <= $4
         AND (expires_at IS NULL OR expires_at > $4)
       FOR SHARE`,
      [input.workspaceId, input.publishingPolicy.id, input.publishingPolicy.version, input.now],
    );
    if (publishing.rowCount !== 1) {
      throw new TokenlessServiceError(
        "The exact publishing-policy version is not active in this workspace.",
        409,
        "human_review_publishing_policy_mismatch",
      );
    }
  }
  if (input.authority === "ask_automatically") {
    if (rowString(profileRow, "configuration_status") !== "ready" || rowString(profileRow, "approved_at") === null) {
      throw new TokenlessServiceError(
        "Automatic asks require an approved, ready request profile.",
        409,
        "human_review_profile_not_ready",
      );
    }
    if (
      !input.publishingPolicy ||
      !(await exactAutomaticDelegation(client, {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        agentVersionId: input.agentVersionId,
        publishingPolicy: input.publishingPolicy,
        paymentProfile,
        now: input.now,
      }))
    ) {
      throw new TokenlessServiceError(
        "Automatic asks require an active owner-approved integration for the exact publishing-policy version.",
        409,
        "human_review_delegation_required",
      );
    }
  }
  return { profileHash };
}

function configurationFromRow(row: Row): HumanReviewConfiguration {
  const bindingId = rowString(row, "binding_id");
  const workspaceId = rowString(row, "workspace_id");
  const agentId = rowString(row, "agent_id");
  const agentVersionId = rowString(row, "agent_version_id");
  const selectionPolicyId = rowString(row, "selection_policy_id");
  const requestProfileId = rowString(row, "request_profile_id");
  const requestProfileHash = rowString(row, "request_profile_hash");
  const authority = rowString(row, "authority") as HumanReviewAuthorityLevel | null;
  const canonicalHash = rowString(row, "canonical_hash");
  const createdBy = rowString(row, "created_by");
  const approvedBy = rowString(row, "approved_by");
  if (
    !bindingId ||
    !workspaceId ||
    !agentId ||
    !agentVersionId ||
    !selectionPolicyId ||
    !requestProfileId ||
    !requestProfileHash ||
    !authority ||
    !canonicalHash ||
    !createdBy ||
    !approvedBy ||
    !HUMAN_REVIEW_AUTHORITY_LEVELS.includes(authority) ||
    !HASH_PATTERN.test(requestProfileHash) ||
    !HASH_PATTERN.test(canonicalHash)
  ) {
    throw new Error("Database returned an invalid human-review configuration.");
  }
  const publishingPolicyId = rowString(row, "publishing_policy_id");
  return {
    bindingId,
    version: rowInteger(row, "version"),
    workspaceId,
    agentId,
    agentVersionId,
    selectionPolicy: { id: selectionPolicyId, version: rowInteger(row, "selection_policy_version") },
    requestProfile: {
      id: requestProfileId,
      version: rowInteger(row, "request_profile_version"),
      hash: requestProfileHash,
    },
    publishingPolicy:
      publishingPolicyId === null
        ? null
        : { id: publishingPolicyId, version: rowInteger(row, "publishing_policy_version") },
    authority,
    enabled: row.enabled === true || row.enabled === "t" || row.enabled === 1,
    canonicalHash,
    createdBy,
    createdAt: iso(row.created_at, "binding creation timestamp"),
    approvedBy,
    approvedAt: iso(row.approved_at, "binding approval timestamp"),
    supersededAt: row.superseded_at ? iso(row.superseded_at, "binding supersession timestamp") : null,
  };
}

async function saveHumanReviewConfigurationInternal(
  input: SaveHumanReviewConfigurationInput,
  transaction?: { client: PoolClient; actor: string; now?: Date },
): Promise<HumanReviewConfiguration> {
  const actor = transaction?.actor ?? (await requireManagement(input.accountAddress, input.workspaceId));
  if (
    input.expectedBindingVersion !== null &&
    (!Number.isSafeInteger(input.expectedBindingVersion) || input.expectedBindingVersion < 1)
  ) {
    configurationError("expectedBindingVersion must be null or a positive integer.");
  }
  if (input.authority !== undefined && !HUMAN_REVIEW_AUTHORITY_LEVELS.includes(input.authority)) {
    configurationError("Human-review authority is invalid.");
  }
  const requestedSelection = input.selectionPolicy ? reference(input.selectionPolicy, "selectionPolicy") : undefined;
  const requestedProfile = input.requestProfile ? reference(input.requestProfile, "requestProfile") : undefined;
  const requestedPublishing =
    input.publishingPolicy === undefined || input.publishingPolicy === null
      ? input.publishingPolicy
      : reference(input.publishingPolicy, "publishingPolicy");
  const now = transaction?.now ?? new Date();
  const client = transaction?.client ?? (await dbPool.connect());
  const ownsTransaction = transaction === undefined;
  let bindingId = "";
  let nextVersion = 0;
  try {
    if (ownsTransaction) await client.query("BEGIN");
    const currentResult = await client.query(
      `SELECT * FROM tokenless_agent_human_review_bindings
       WHERE workspace_id = $1 AND agent_id = $2 AND agent_version_id = $3
         AND enabled = true AND superseded_at IS NULL
       FOR UPDATE`,
      [input.workspaceId, input.agentId, input.agentVersionId],
    );
    const current = currentResult.rows[0] ? configurationFromRow(currentResult.rows[0] as Row) : null;
    if (
      (current === null && input.expectedBindingVersion !== null) ||
      (current !== null && input.expectedBindingVersion !== current.version)
    ) {
      throw new TokenlessServiceError(
        "Human-review configuration changed. Reload it and try again.",
        409,
        "human_review_configuration_conflict",
      );
    }
    const selectionPolicy = requestedSelection ?? current?.selectionPolicy;
    const requestProfile = requestedProfile ?? current?.requestProfile;
    const publishingPolicy =
      requestedPublishing === undefined ? (current?.publishingPolicy ?? null) : requestedPublishing;
    const authority = input.authority ?? current?.authority;
    if (!selectionPolicy || !requestProfile || !authority) {
      configurationError("The first human-review configuration needs selection, request, and authority choices.");
    }
    const { profileHash } = await validateExactObjects(client, {
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      selectionPolicy,
      requestProfile,
      publishingPolicy,
      authority,
      now,
    });
    const requestProfileWithHash = { ...requestProfile, hash: profileHash };
    const canonicalHash = hashHumanReviewConfiguration({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      selectionPolicy,
      requestProfile: requestProfileWithHash,
      publishingPolicy,
      authority,
    });
    if (canonicalHash === current?.canonicalHash) {
      throw new TokenlessServiceError(
        "Human-review configuration has no semantic changes.",
        409,
        "human_review_configuration_unchanged",
      );
    }
    bindingId = current?.bindingId ?? `hrb_${randomUUID().replaceAll("-", "")}`;
    nextVersion = (current?.version ?? 0) + 1;
    if (current) {
      const superseded = await client.query(
        `UPDATE tokenless_agent_human_review_bindings
         SET enabled = false, superseded_at = $1
         WHERE workspace_id = $2 AND binding_id = $3 AND version = $4
           AND enabled = true AND superseded_at IS NULL`,
        [now, input.workspaceId, bindingId, current.version],
      );
      if (superseded.rowCount !== 1) {
        throw new TokenlessServiceError(
          "Human-review configuration changed. Reload it and try again.",
          409,
          "human_review_configuration_conflict",
        );
      }
    }
    await client.query(
      `INSERT INTO tokenless_agent_human_review_bindings
       (binding_id, version, workspace_id, agent_id, agent_version_id,
        selection_policy_id, selection_policy_version,
        request_profile_id, request_profile_version, request_profile_hash,
        publishing_policy_id, publishing_policy_version, authority, enabled, canonical_hash,
        created_by, created_at, approved_by, approved_at, superseded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$15,$16,$15,$16,NULL)`,
      [
        bindingId,
        nextVersion,
        input.workspaceId,
        input.agentId,
        input.agentVersionId,
        selectionPolicy.id,
        selectionPolicy.version,
        requestProfile.id,
        requestProfile.version,
        profileHash,
        publishingPolicy?.id ?? null,
        publishingPolicy?.version ?? null,
        authority,
        canonicalHash,
        actor,
        now,
      ],
    );
    await client.query(
      `UPDATE tokenless_agent_integrations
       SET human_review_binding_id = $1, human_review_binding_version = $2, updated_at = $3
       WHERE workspace_id = $4 AND agent_id = $5 AND agent_version_id = $6 AND status = 'active'`,
      [bindingId, nextVersion, now, input.workspaceId, input.agentId, input.agentVersionId],
    );
    await client.query(
      `UPDATE tokenless_workspace_agent_setups
       SET human_review_binding_id = $1, human_review_binding_version = $2, updated_at = $3
       WHERE workspace_id = $4`,
      [bindingId, nextVersion, now, input.workspaceId],
    );
    const details = {
      previousBindingVersion: current?.version ?? null,
      selectionPolicy,
      requestProfile: requestProfileWithHash,
      publishingPolicy,
      authority,
      canonicalHash,
    };
    const eventType = current ? "configuration_changed" : "created";
    const eventId = `hrbe_${randomUUID().replaceAll("-", "")}`;
    const eventHash = sha256(
      stableJson({
        schemaVersion: "rateloop.human-review-binding-event.v1",
        eventId,
        workspaceId: input.workspaceId,
        bindingId,
        bindingVersion: nextVersion,
        eventType,
        actor,
        details,
        createdAt: now.toISOString(),
      }),
    );
    await client.query(
      `INSERT INTO tokenless_agent_human_review_binding_events
       (event_id, workspace_id, binding_id, binding_version, event_type, actor_type,
        actor_reference, details_json, event_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,'account',$6,$7,$8,$9)`,
      [eventId, input.workspaceId, bindingId, nextVersion, eventType, actor, stableJson(details), eventHash, now],
    );
    if (ownsTransaction) await client.query("COMMIT");
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
  const result = transaction
    ? await client.query(
        `SELECT * FROM tokenless_agent_human_review_bindings
         WHERE workspace_id = $1 AND binding_id = $2 AND version = $3`,
        [input.workspaceId, bindingId, nextVersion],
      )
    : await dbClient.execute({
        sql: `SELECT * FROM tokenless_agent_human_review_bindings
              WHERE workspace_id = ? AND binding_id = ? AND version = ?`,
        args: [input.workspaceId, bindingId, nextVersion],
      });
  if (result.rowCount !== 1) throw new Error("Saved human-review configuration could not be loaded.");
  return configurationFromRow(result.rows[0] as Row);
}

export async function saveHumanReviewConfiguration(
  input: SaveHumanReviewConfigurationInput,
): Promise<HumanReviewConfiguration> {
  return saveHumanReviewConfigurationInternal(input);
}

export async function saveHumanReviewConfigurationInTransaction(
  client: PoolClient,
  input: Omit<SaveHumanReviewConfigurationInput, "accountAddress"> & { actor: string; now?: Date },
): Promise<HumanReviewConfiguration> {
  let actor: string;
  try {
    actor = normalizeAccountSubject(input.actor);
  } catch {
    throw new TokenlessServiceError("Account identity is invalid.", 400, "invalid_account");
  }
  return saveHumanReviewConfigurationInternal({ ...input, accountAddress: actor }, { client, actor, now: input.now });
}

function objectWithAllowedKeys(value: unknown, field: string, allowed: ReadonlySet<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    configurationError(`${field} must be an object.`, "invalid_human_review_owner_request");
  }
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some(key => !allowed.has(key))) {
    configurationError(`${field} contains unsupported fields.`, "invalid_human_review_owner_request");
  }
  return object;
}

function normalizeOwnerMutation(value: unknown) {
  const body = objectWithAllowedKeys(value, "Human-review configuration", OWNER_BODY_KEYS);
  if (!("expectedBindingVersion" in body)) {
    configurationError("expectedBindingVersion is required.", "invalid_human_review_owner_request");
  }
  const expectedBindingVersion = body.expectedBindingVersion;
  if (
    expectedBindingVersion !== null &&
    (!Number.isSafeInteger(expectedBindingVersion) || Number(expectedBindingVersion) < 1)
  ) {
    configurationError(
      "expectedBindingVersion must be null or a positive integer.",
      "invalid_human_review_owner_request",
    );
  }
  const selection = objectWithAllowedKeys(body.selection, "selection", OWNER_SELECTION_KEYS);
  const requestProfile = objectWithAllowedKeys(body.requestProfile, "requestProfile", OWNER_PROFILE_KEYS);
  if (!("questionAuthority" in requestProfile)) {
    configurationError("requestProfile.questionAuthority is required.", "invalid_human_review_owner_request");
  }
  if (requestProfile.questionAuthority !== "owner_fixed" && requestProfile.questionAuthority !== "agent_per_request") {
    configurationError(
      "requestProfile.questionAuthority must be owner_fixed or agent_per_request.",
      "invalid_human_review_owner_request",
    );
  }
  if (requestProfile.questionAuthority === "agent_per_request") {
    if (["criterion", "positiveLabel", "negativeLabel"].some(key => key in requestProfile)) {
      configurationError(
        "Agent-written question profiles must omit the fixed criterion and answer labels.",
        "invalid_human_review_owner_request",
      );
    }
    if (requestProfile.audience !== "public_network" || requestProfile.contentBoundary !== "public_or_test") {
      configurationError(
        "Agent-written questions currently require the public reviewer network and public or test material.",
        "invalid_human_review_owner_request",
      );
    }
    if (selection.mode === "adaptive") {
      configurationError(
        "Adaptive review requires one owner-fixed question; choose another review frequency for agent-written questions.",
        "invalid_human_review_owner_request",
      );
    }
  }
  const authority = body.authority as HumanReviewAuthorityLevel;
  if (!HUMAN_REVIEW_AUTHORITY_LEVELS.includes(authority)) {
    configurationError("Human-review authority is invalid.", "invalid_human_review_owner_request");
  }
  let publishingGrant: undefined | null | ExactOwnerPublishingGrant | ProvisionedOwnerPublishingGrant;
  if ("publishingGrant" in body) {
    if (body.publishingGrant === null) publishingGrant = null;
    else {
      const grant = objectWithAllowedKeys(body.publishingGrant, "publishingGrant", OWNER_GRANT_KEYS);
      const provision = grant.provision;
      if (
        typeof grant.integrationId !== "string" ||
        !grant.integrationId.trim() ||
        !Array.isArray(grant.allowedWorkflowKeys) ||
        grant.allowedWorkflowKeys.length < 1 ||
        grant.allowedWorkflowKeys.length > 32
      ) {
        configurationError(
          "publishingGrant must identify one exact integration, policy version, and workflow set.",
          "invalid_human_review_owner_request",
        );
      }
      const allowedWorkflowKeys = [
        ...new Set(grant.allowedWorkflowKeys.map(entry => (typeof entry === "string" ? entry.trim() : ""))),
      ].sort();
      if (allowedWorkflowKeys.some(entry => !WORKFLOW_PATTERN.test(entry))) {
        configurationError("publishingGrant workflows are invalid.", "invalid_human_review_owner_request");
      }
      if (provision === "private_invited_unpaid") {
        if (grant.publishingPolicyId !== undefined || grant.publishingPolicyVersion !== undefined) {
          configurationError(
            "A provisioned publishing grant cannot select a browser-supplied policy.",
            "invalid_human_review_owner_request",
          );
        }
        publishingGrant = {
          integrationId: grant.integrationId.trim(),
          provision,
          allowedWorkflowKeys,
        };
      } else {
        if (
          provision !== undefined ||
          typeof grant.publishingPolicyId !== "string" ||
          !grant.publishingPolicyId.trim() ||
          !Number.isSafeInteger(grant.publishingPolicyVersion) ||
          Number(grant.publishingPolicyVersion) < 1
        ) {
          configurationError(
            "publishingGrant must identify one exact integration, policy version, and workflow set.",
            "invalid_human_review_owner_request",
          );
        }
        publishingGrant = {
          integrationId: grant.integrationId.trim(),
          publishingPolicyId: grant.publishingPolicyId.trim(),
          publishingPolicyVersion: Number(grant.publishingPolicyVersion),
          allowedWorkflowKeys,
        };
      }
    }
  }
  if (publishingGrant && authority !== "ask_automatically" && selection.mode !== "manual") {
    configurationError(
      "A publishing grant may be activated only for automatic review asks.",
      "human_review_publishing_grant_requires_automatic",
    );
  }
  const manual = selection.mode === "manual";
  return {
    authority: manual ? ("check_only" as const) : authority,
    expectedBindingVersion: expectedBindingVersion === null ? null : Number(expectedBindingVersion),
    publishingGrant: manual ? null : publishingGrant,
    requestProfile,
    selection: manual ? { ...selection, enforcementMode: "advisory" } : selection,
  };
}

function parseJsonObject(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function nullableInteger(row: Row | undefined, key: string) {
  return row?.[key] === null || row?.[key] === undefined ? null : rowInteger(row, key);
}

function nullableIso(value: unknown, field: string) {
  return value === null || value === undefined ? null : iso(value, field);
}

function ownerSelectionFromRow(row: Row) {
  const rules = parseJsonObject(row.rules_json, "review rules");
  const storedAudience = parseJsonObject(row.audience_policy_json, "review audience").reviewerSource;
  const audience =
    storedAudience === "customer_invited"
      ? "private_invited"
      : storedAudience === "rateloop_network"
        ? "public_network"
        : storedAudience;
  return normalizeManagedReviewPolicyInput({
    agentId: rowString(row, "agent_id"),
    agentVersionId: rowString(row, "agent_version_id"),
    mode: rowString(row, "mode"),
    enforcementMode: rules.enforcementMode,
    agreementThresholdBps: rowBasisPoints(row, "agreement_threshold_bps"),
    productionFloorBps: rowBasisPoints(row, "production_floor_bps"),
    fixedRateBps: nullableInteger(row, "fixed_rate_bps"),
    maximumUnreviewedGap: rowInteger(row, "maximum_unreviewed_gap"),
    requiredRiskTiers: rules.requiredRiskTiers,
    criticalRiskTiers: rules.criticalRiskTiers,
    minimumConfidenceBps: rules.minimumConfidenceBps,
    maximumLatencyMs: rules.maximumLatencyMs,
    audience,
    publishingPolicyId: rowString(row, "publishing_policy_id"),
  });
}

function ownerProfileFromRow(row: Row) {
  const configurationStatus = rowString(row, "configuration_status");
  if (configurationStatus !== "ready" && configurationStatus !== "action_required") {
    throw new Error("Database returned an invalid review request profile status.");
  }
  return {
    agentId: rowString(row, "agent_id")!,
    agentVersionId: rowString(row, "agent_version_id")!,
    questionAuthority: rowString(row, "question_authority")!,
    resultSemantics: rowString(row, "result_semantics")!,
    criterion: rowString(row, "criterion"),
    positiveLabel: rowString(row, "positive_label"),
    negativeLabel: rowString(row, "negative_label"),
    rationaleMode: rowString(row, "rationale_mode")!,
    audience: rowString(row, "audience")!,
    contentBoundary: rowString(row, "content_boundary")!,
    privateSensitivity: rowString(row, "private_sensitivity"),
    privateGroupId: rowString(row, "private_group_id"),
    privateGroupPolicyVersion: nullableInteger(row, "private_group_policy_version"),
    privateGroupPolicyHash: rowString(row, "private_group_policy_hash"),
    semanticSchemaVersion: rowInteger(row, "semantic_schema_version"),
    requiredExpertiseKeys: JSON.parse(rowString(row, "required_expertise_keys_json") ?? "[]") as string[],
    expertiseRequirements: JSON.parse(rowString(row, "expertise_requirements_json") ?? "[]") as unknown[],
    responseWindowSeconds: nullableInteger(row, "response_window_seconds"),
    panelSize: nullableInteger(row, "panel_size"),
    compensationMode: rowString(row, "compensation_mode")!,
    bountyPerSeatAtomic: rowString(row, "bounty_per_seat_atomic"),
    feedbackBonusEnabled: row.feedback_bonus_enabled === true || row.feedback_bonus_enabled === "t",
    feedbackBonusPoolAtomic: rowString(row, "feedback_bonus_pool_atomic"),
    feedbackBonusAwarderKind: rowString(row, "feedback_bonus_awarder_kind")!,
    feedbackBonusAwarderAccount: rowString(row, "feedback_bonus_awarder_account"),
    feedbackBonusAwardWindowSeconds: nullableInteger(row, "feedback_bonus_award_window_seconds"),
    configurationStatus,
  };
}

async function currentAgentVersion(client: PoolClient, workspaceId: string, agentId: string, lock: boolean) {
  const result = await client.query(
    `SELECT a.agent_id, v.version_id, v.display_name
     FROM tokenless_agents a
     JOIN tokenless_agent_versions v ON v.workspace_id = a.workspace_id AND v.agent_id = a.agent_id
     WHERE a.workspace_id = $1 AND a.agent_id = $2 AND a.status = 'active'
     ORDER BY v.version_number DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [workspaceId, agentId],
  );
  const row = result.rows[0] as Row | undefined;
  const agentVersionId = rowString(row, "version_id");
  if (!agentVersionId) throw new TokenlessServiceError("Agent not found.", 404, "agent_not_found");
  return { agentVersionId, displayName: rowString(row, "display_name")! };
}

type PreparedPublishingGrant = {
  integrationId: string;
  publishingPolicy: HumanReviewVersionReference;
  allowedWorkflowKeys: string[];
  grantedScopes: string[];
  policyCaps: {
    maxPanelAtomic: string;
    maxDailyAtomic: string;
    maxMonthlyAtomic: string;
    maxPanelSize: number;
    maxBountyAtomic: string;
    maxFeeBps: number;
    maxAttemptReserveAtomic: string;
  };
  previousGrant: {
    activationMode: string;
    reviewPolicy: HumanReviewVersionReference;
    publishingPolicy: HumanReviewVersionReference | null;
    allowedWorkflowKeys: string[];
    grantedScopes: string[];
  };
};

function sameStringSet(left: string[], right: readonly string[]) {
  return stableJson([...new Set(left)].sort()) === stableJson([...new Set(right)].sort());
}

async function prepareExactPublishingGrant(
  client: PoolClient,
  input: {
    workspaceId: string;
    agentId: string;
    agentVersionId: string;
    integrationId: string;
    publishingPolicyId: string;
    publishingPolicyVersion: number;
    allowedWorkflowKeys: string[];
    paymentProfile: HumanReviewPaymentProfile;
    now: Date;
  },
): Promise<PreparedPublishingGrant> {
  const integrationResult = await client.query(
    `SELECT i.* FROM tokenless_agent_integrations i
     WHERE i.workspace_id = $1 AND i.agent_id = $2 AND i.agent_version_id = $3
       AND i.integration_id = $4 AND i.status = 'active' AND i.revoked_at IS NULL
     FOR UPDATE`,
    [input.workspaceId, input.agentId, input.agentVersionId, input.integrationId],
  );
  const integration = integrationResult.rows[0] as Row | undefined;
  if (!integration) {
    throw new TokenlessServiceError(
      "The publishing grant does not belong to this workspace and agent version.",
      409,
      "human_review_publishing_grant_mismatch",
    );
  }
  const connectionIntentId = rowString(integration, "connection_intent_id");
  const tokenFamilyId = rowString(integration, "token_family_id");
  if (!connectionIntentId || !tokenFamilyId) {
    throw new TokenlessServiceError(
      "Automatic review asks require an active, connected OAuth agent integration.",
      409,
      "human_review_publishing_grant_not_supported",
    );
  }
  const credentialResult = await client.query(
    `SELECT c.status AS connection_status, f.status AS token_family_status,
            f.revoked_at AS token_family_revoked_at, f.absolute_expires_at AS token_family_expires_at
     FROM tokenless_agent_connection_intents c
     JOIN tokenless_agent_oauth_token_families f ON f.token_family_id = $2
     WHERE c.intent_id = $1
     FOR SHARE`,
    [connectionIntentId, tokenFamilyId],
  );
  const credential = credentialResult.rows[0] as Row | undefined;
  const familyExpiresAt = new Date(String(credential?.token_family_expires_at));
  if (
    !rowString(integration, "oauth_client_id") ||
    !rowString(integration, "oauth_subject_principal_id") ||
    rowString(credential, "connection_status") !== "connected" ||
    !["preauthorized_safe", "owner_approved"].includes(rowString(integration, "activation_mode") ?? "") ||
    rowString(credential, "token_family_status") !== "active" ||
    rowString(credential, "token_family_revoked_at") !== null ||
    !Number.isFinite(familyExpiresAt.getTime()) ||
    familyExpiresAt <= input.now
  ) {
    throw new TokenlessServiceError(
      "Automatic review asks require an active, connected OAuth agent integration.",
      409,
      "human_review_publishing_grant_not_supported",
    );
  }
  const policyResult = await client.query(
    `SELECT policy_id, version, max_panel_atomic, max_daily_atomic, max_monthly_atomic,
            max_panel_size, max_bounty_atomic, max_fee_bps, max_attempt_reserve_atomic
     FROM tokenless_agent_publishing_policies
     WHERE workspace_id = $1 AND policy_id = $2 AND version = $3
       AND enabled = true AND revoked_at IS NULL AND effective_at <= $4
       AND (expires_at IS NULL OR expires_at > $4)
     FOR SHARE`,
    [input.workspaceId, input.publishingPolicyId, input.publishingPolicyVersion, input.now],
  );
  const policy = policyResult.rows[0] as Row | undefined;
  if (!policy) {
    throw new TokenlessServiceError(
      "The exact publishing-policy version is not active in this workspace.",
      409,
      "human_review_publishing_policy_mismatch",
    );
  }
  const previousPolicyId = rowString(integration, "publishing_policy_id");
  return {
    integrationId: input.integrationId,
    publishingPolicy: { id: input.publishingPolicyId, version: input.publishingPolicyVersion },
    allowedWorkflowKeys: input.allowedWorkflowKeys,
    grantedScopes: automaticHumanReviewGrantScopes(input.paymentProfile),
    policyCaps: {
      maxPanelAtomic: rowString(policy, "max_panel_atomic")!,
      maxDailyAtomic: rowString(policy, "max_daily_atomic")!,
      maxMonthlyAtomic: rowString(policy, "max_monthly_atomic")!,
      maxPanelSize: rowInteger(policy, "max_panel_size"),
      maxBountyAtomic: rowString(policy, "max_bounty_atomic")!,
      maxFeeBps: rowBasisPoints(policy, "max_fee_bps"),
      maxAttemptReserveAtomic: rowString(policy, "max_attempt_reserve_atomic")!,
    },
    previousGrant: {
      activationMode: rowString(integration, "activation_mode")!,
      reviewPolicy: {
        id: rowString(integration, "review_policy_id")!,
        version: rowInteger(integration, "review_policy_version"),
      },
      publishingPolicy:
        previousPolicyId === null
          ? null
          : { id: previousPolicyId, version: rowInteger(integration, "publishing_policy_version") },
      allowedWorkflowKeys: parseStringArray(integration.allowed_workflow_keys_json, "allowed workflows"),
      grantedScopes: parseStringArray(integration.granted_scopes_json, "publishing grant scopes"),
    },
  };
}

async function activatePreparedPublishingGrant(
  client: PoolClient,
  input: {
    workspaceId: string;
    agentId: string;
    agentVersionId: string;
    selectionPolicy: HumanReviewVersionReference;
    grant: PreparedPublishingGrant;
    now: Date;
  },
) {
  const previous = input.grant.previousGrant;
  const unchanged =
    previous.activationMode === "owner_approved" &&
    previous.reviewPolicy.id === input.selectionPolicy.id &&
    previous.reviewPolicy.version === input.selectionPolicy.version &&
    previous.publishingPolicy?.id === input.grant.publishingPolicy.id &&
    previous.publishingPolicy?.version === input.grant.publishingPolicy.version &&
    sameStringSet(previous.allowedWorkflowKeys, input.grant.allowedWorkflowKeys) &&
    sameStringSet(previous.grantedScopes, input.grant.grantedScopes);
  if (unchanged) return false;
  const updated = await client.query(
    `UPDATE tokenless_agent_integrations
     SET review_policy_id = $1, review_policy_version = $2,
         publishing_policy_id = $3, publishing_policy_version = $4,
         allowed_workflow_keys_json = $5, activation_mode = 'owner_approved',
         granted_scopes_json = $6, updated_at = $7
     WHERE workspace_id = $8 AND agent_id = $9 AND agent_version_id = $10
       AND integration_id = $11 AND status = 'active' AND revoked_at IS NULL`,
    [
      input.selectionPolicy.id,
      input.selectionPolicy.version,
      input.grant.publishingPolicy.id,
      input.grant.publishingPolicy.version,
      stableJson(input.grant.allowedWorkflowKeys),
      stableJson(input.grant.grantedScopes),
      input.now,
      input.workspaceId,
      input.agentId,
      input.agentVersionId,
      input.grant.integrationId,
    ],
  );
  if (updated.rowCount !== 1) {
    throw new TokenlessServiceError(
      "The publishing integration changed while the grant was being activated.",
      409,
      "human_review_publishing_grant_mismatch",
    );
  }
  return true;
}

async function downgradePublishingGrants(
  client: PoolClient,
  input: {
    workspaceId: string;
    agentId: string;
    agentVersionId: string;
    selectionPolicy: HumanReviewVersionReference;
    actor: string;
    now: Date;
  },
) {
  const result = await client.query(
    `UPDATE tokenless_agent_integrations
     SET review_policy_id = $1, review_policy_version = $2,
         publishing_policy_id = NULL, publishing_policy_version = NULL,
         activation_mode = 'preauthorized_safe', granted_scopes_json = $3, updated_at = $4
     WHERE workspace_id = $5 AND agent_id = $6 AND agent_version_id = $7
       AND status = 'active' AND revoked_at IS NULL
       AND (activation_mode = 'owner_approved' OR publishing_policy_id IS NOT NULL)
     RETURNING integration_id`,
    [
      input.selectionPolicy.id,
      input.selectionPolicy.version,
      stableJson(SAFE_AGENT_CONNECTION_SCOPES),
      input.now,
      input.workspaceId,
      input.agentId,
      input.agentVersionId,
    ],
  );
  const integrationIds = result.rows.map(row => rowString(row as Row, "integration_id")!).filter(Boolean);
  for (const integrationId of integrationIds) {
    await client.query(
      `INSERT INTO tokenless_agent_integration_events
       (event_id,integration_id,workspace_id,event_type,actor_type,actor_reference,details_json,created_at)
       VALUES ($1,$2,$3,'scope_downgraded','account',$4,$5,$6)`,
      [
        `agie_${randomUUID().replaceAll("-", "")}`,
        integrationId,
        input.workspaceId,
        input.actor,
        stableJson({
          source: "browser_owner_human_review_configuration",
          explicitBrowserConsent: true,
          activeSelectionPolicy: input.selectionPolicy,
          grantedScopes: SAFE_AGENT_CONNECTION_SCOPES,
        }),
        input.now,
      ],
    );
  }
  return integrationIds;
}

async function resolvePrivateGroupTuple(
  client: PoolClient,
  input: { workspaceId: string; audience: unknown; privateGroupId: unknown },
) {
  if (input.audience === "public_network") {
    if (input.privateGroupId !== null && input.privateGroupId !== undefined) {
      configurationError(
        "Public-network review cannot bind a private reviewer group.",
        "invalid_human_review_owner_request",
      );
    }
    return { id: null, version: null, hash: null, maximumSensitivity: null };
  }
  if (input.audience !== "private_invited" && input.audience !== "hybrid") {
    return { id: null, version: null, hash: null, maximumSensitivity: null };
  }
  if (typeof input.privateGroupId !== "string" || !input.privateGroupId.trim()) {
    configurationError("This audience requires a private reviewer group.", "invalid_human_review_owner_request");
  }
  const result = await client.query(
    `SELECT g.group_id, g.current_policy_version, p.policy_hash, p.max_private_sensitivity
     FROM tokenless_private_groups g
     JOIN tokenless_private_group_policy_versions p
       ON p.group_id = g.group_id AND p.version = g.current_policy_version
     WHERE g.workspace_id = $1 AND g.group_id = $2 AND g.status = 'active'
     FOR SHARE`,
    [input.workspaceId, input.privateGroupId.trim()],
  );
  const row = result.rows[0] as Row | undefined;
  const id = rowString(row, "group_id");
  const hash = rowString(row, "policy_hash");
  if (!id || !hash || !HASH_PATTERN.test(hash)) {
    throw new TokenlessServiceError("Private group not found.", 404, "private_group_not_found");
  }
  return {
    id,
    version: rowInteger(row, "current_policy_version"),
    hash,
    maximumSensitivity: rowString(row, "max_private_sensitivity"),
  };
}

async function provisionPrivateInvitedUnpaidPublishingPolicy(
  client: PoolClient,
  input: {
    actor: string;
    workspaceId: string;
    agentId: string;
    requestProfile: ReturnType<typeof normalizeReviewRequestProfileInput>;
    group: Awaited<ReturnType<typeof resolvePrivateGroupTuple>>;
    now: Date;
  },
): Promise<HumanReviewVersionReference> {
  const profile = input.requestProfile;
  if (
    profile.audience !== "private_invited" ||
    profile.contentBoundary !== "private_workspace" ||
    profile.compensationMode !== "unpaid" ||
    profile.feedbackBonusEnabled ||
    profile.privateSensitivity === null ||
    profile.panelSize === null ||
    !input.group.id ||
    !input.group.hash ||
    !HASH_PATTERN.test(input.group.hash)
  ) {
    throw new TokenlessServiceError(
      "Setup can provision automatic publishing only for unpaid invited review without a feedback bonus.",
      409,
      "human_review_automatic_provisioning_not_supported",
    );
  }
  const policyId = `agpol_${randomUUID().replaceAll("-", "")}`;
  const inertAtomicCap = "1";
  await client.query(
    `INSERT INTO tokenless_agent_publishing_policies
     (policy_id,workspace_id,name,version,enabled,effective_at,expires_at,
      allowed_payment_modes_json,payer_address,max_panel_atomic,max_daily_atomic,max_monthly_atomic,
      max_panel_size,max_bounty_atomic,max_fee_bps,max_attempt_reserve_atomic,
      allowed_project_ids_json,allowed_reviewer_sources_json,allowed_admission_policy_hashes_json,
      allowed_data_classifications_json,max_retention_days,allow_public_urls,
      allowed_webhook_endpoint_ids_json,allowed_prompt_templates_json,on_policy_miss,
      created_by,created_at,updated_at)
     VALUES ($1,$2,$3,1,true,$4,NULL,$5,NULL,$6,$6,$6,$7,$6,0,$6,$8,$9,$10,$11,30,false,$8,$8,'deny',$12,$4,$4)`,
    [
      policyId,
      input.workspaceId,
      `Automatic private review · ${input.agentId.slice(-12)}`,
      input.now,
      stableJson(["prepaid"]),
      inertAtomicCap,
      Math.max(3, profile.panelSize),
      stableJson([]),
      stableJson(["customer_invited"]),
      stableJson([`0x${input.group.hash.slice("sha256:".length)}`]),
      stableJson([profile.privateSensitivity]),
      input.actor,
    ],
  );
  return { id: policyId, version: 1 };
}

function assertPrivateSensitivityAllowed(requested: string | null, maximum: string | null) {
  if (requested === null) return;
  const requestedRank = REVIEW_REQUEST_PRIVATE_SENSITIVITIES.indexOf(requested as never);
  const maximumRank = REVIEW_REQUEST_PRIVATE_SENSITIVITIES.indexOf(maximum as never);
  if (requestedRank < 0 || maximumRank < 0) {
    throw new TokenlessServiceError(
      "The private-group sensitivity policy is invalid.",
      500,
      "private_group_policy_invalid",
    );
  }
  if (requestedRank > maximumRank) {
    throw new TokenlessServiceError(
      "The private reviewer group does not permit material at the requested sensitivity.",
      400,
      "private_group_sensitivity_exceeded",
    );
  }
}

async function versionOwnerSelection(
  client: PoolClient,
  input: {
    workspaceId: string;
    actor: string;
    policy: ReturnType<typeof normalizeManagedReviewPolicyInput>;
    profile: ReturnType<typeof normalizeReviewRequestProfileInput>;
    requestProfile: HumanReviewVersionReference & { hash: string };
    now: Date;
  },
) {
  const currentResult = await client.query(
    `SELECT * FROM tokenless_agent_review_policies
     WHERE workspace_id = $1 AND agent_id = $2 AND agent_version_id = $3
       AND enabled = true AND superseded_at IS NULL
     ORDER BY version DESC LIMIT 1 FOR UPDATE`,
    [input.workspaceId, input.policy.agentId, input.policy.agentVersionId],
  );
  const currentRow = currentResult.rows[0] as Row | undefined;
  const policyId = currentRow ? rowString(currentRow, "policy_id")! : `rpol_${randomUUID().replaceAll("-", "")}`;
  const currentVersion = currentRow ? rowInteger(currentRow, "version") : null;
  const admissionPolicyJson = (version: number) => {
    const profile = input.profile;
    const reviewerSource =
      profile.audience === "private_invited"
        ? ("customer_invited" as const)
        : profile.audience === "public_network"
          ? ("rateloop_network" as const)
          : ("hybrid" as const);
    const compensation =
      profile.compensationMode === "usdc"
        ? ("paid" as const)
        : profile.feedbackBonusEnabled
          ? ("mixed" as const)
          : ("unpaid" as const);
    const requiredQualifications = [
      ...expertiseQualificationRules(profile.requiredExpertiseKeys),
      ...profile.expertiseRequirements.map(requirement => ({
        key: exactReviewerExpertiseDefinitionKey(requirement),
        operator: "attested" as const,
        value: true,
      })),
    ];
    const privateRouting =
      profile.privateGroupId === null
        ? null
        : workspacePrivateReviewRoutingIds({
            workspaceId: input.workspaceId,
            profileId: input.requestProfile.id,
            profileVersion: input.requestProfile.version,
            profileHash: input.requestProfile.hash,
            privateGroupId: profile.privateGroupId,
          });
    const networkSupply = reviewerSource !== "customer_invited";
    const disabledIntegrityManifest = sha256(
      stableJson({
        schemaVersion: "rateloop.disabled-network-integrity.v1",
        policyId,
        version,
      }),
    );
    return freezeAdmissionPolicy({
      schemaVersion: "rateloop.human-assurance.v2",
      policyId,
      version,
      reviewerSource,
      compensation,
      cohorts:
        privateRouting === null
          ? []
          : [
              {
                cohortId: privateRouting.cohortId,
                minimumReviewers: profile.panelSize,
                maximumReviewers: profile.panelSize,
              },
            ],
      selection: reviewerSource === "customer_invited" ? "customer_named" : "randomized",
      fallbacks: { allowed: false, sources: [] },
      requiredQualifications,
      assurance: {
        requirements: [
          ...(reviewerSource === "customer_invited" || reviewerSource === "hybrid"
            ? [
                {
                  capability: "customer_invitation" as const,
                  reviewerSources: ["customer_invited" as const],
                  allowedProviders: ["rateloop:invitation"],
                },
              ]
            : []),
          ...(networkSupply
            ? [
                {
                  capability: "unique_human" as const,
                  reviewerSources: ["rateloop_network" as const],
                  allowedProviders: ["world:poh"],
                },
              ]
            : []),
        ],
      },
      ...(networkSupply
        ? {
            integrity: {
              schemaVersion: "rateloop.integrity-assignment.v1",
              epochId: `unavailable:${policyId}:${version}`,
              epochManifestHash: disabledIntegrityManifest,
              maxClusterShareBps: 2_000,
              allowedRiskBands: ["low"],
              recentCoassignmentWindowSeconds: 86_400,
              maxRecentCoassignments: 1,
              maxPerCustomer: 3,
              onePerProviderSubject: true,
            },
          }
        : {}),
      buyerPrivacy: {
        visibleFields: ["reviewer_source"],
        minimumAggregationSize: profile.panelSize,
        suppressSmallCells: true,
      },
      legalEligibilityRequired: compensation !== "unpaid",
    }).policyJson;
  };
  if (
    currentRow &&
    stableJson(ownerSelectionFromRow(currentRow)) === stableJson(input.policy) &&
    String(currentRow.audience_policy_json) === admissionPolicyJson(currentVersion!)
  ) {
    return { id: policyId, version: currentVersion! };
  }
  const version = currentVersion === null ? 1 : currentVersion + 1;
  if (currentRow) {
    const superseded = await client.query(
      `UPDATE tokenless_agent_review_policies SET enabled = false, superseded_at = $1
       WHERE workspace_id = $2 AND policy_id = $3 AND version = $4
         AND enabled = true AND superseded_at IS NULL`,
      [input.now, input.workspaceId, policyId, version - 1],
    );
    if (superseded.rowCount !== 1) {
      throw new TokenlessServiceError(
        "Human-review configuration changed. Reload it and try again.",
        409,
        "human_review_configuration_conflict",
      );
    }
  }
  await client.query(
    `INSERT INTO tokenless_agent_review_policies
     (policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled,
      agreement_threshold_bps, production_floor_bps, fixed_rate_bps, maximum_unreviewed_gap,
      rules_json, audience_policy_json, publishing_policy_id, created_by, approved_by, created_at, superseded_at)
     VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,NULL)`,
    [
      policyId,
      version,
      input.workspaceId,
      input.policy.agentId,
      input.policy.agentVersionId,
      input.policy.mode,
      input.policy.agreementThresholdBps,
      input.policy.productionFloorBps,
      input.policy.fixedRateBps,
      input.policy.maximumUnreviewedGap,
      stableJson({
        enforcementMode: input.policy.enforcementMode,
        requiredRiskTiers: input.policy.requiredRiskTiers,
        criticalRiskTiers: input.policy.criticalRiskTiers,
        minimumConfidenceBps: input.policy.minimumConfidenceBps,
        maximumLatencyMs: input.policy.maximumLatencyMs,
      }),
      admissionPolicyJson(version),
      input.policy.publishingPolicyId,
      input.actor,
      input.now,
    ],
  );
  return { id: policyId, version };
}

async function versionOwnerProfile(
  client: PoolClient,
  input: {
    workspaceId: string;
    actor: string;
    profile: ReturnType<typeof normalizeReviewRequestProfileInput>;
    now: Date;
  },
) {
  const profileHash = hashReviewRequestProfile(input.profile);
  const currentResult = await client.query(
    `SELECT profile_id, version, profile_hash FROM tokenless_agent_review_request_profiles
     WHERE workspace_id = $1 AND agent_id = $2 AND agent_version_id = $3 AND superseded_at IS NULL
     ORDER BY version DESC LIMIT 1 FOR UPDATE`,
    [input.workspaceId, input.profile.agentId, input.profile.agentVersionId],
  );
  const currentRow = currentResult.rows[0] as Row | undefined;
  if (currentRow && rowString(currentRow, "profile_hash") === profileHash) {
    return { id: rowString(currentRow, "profile_id")!, version: rowInteger(currentRow, "version"), hash: profileHash };
  }
  const profileId = currentRow ? rowString(currentRow, "profile_id")! : `rrp_${randomUUID().replaceAll("-", "")}`;
  const version = currentRow ? rowInteger(currentRow, "version") + 1 : 1;
  if (currentRow) {
    const superseded = await client.query(
      `UPDATE tokenless_agent_review_request_profiles SET superseded_at = $1
       WHERE workspace_id = $2 AND profile_id = $3 AND version = $4 AND superseded_at IS NULL`,
      [input.now, input.workspaceId, profileId, version - 1],
    );
    if (superseded.rowCount !== 1) {
      throw new TokenlessServiceError(
        "Human-review configuration changed. Reload it and try again.",
        409,
        "human_review_configuration_conflict",
      );
    }
  }
  await client.query(
    `INSERT INTO tokenless_agent_review_request_profiles
     (profile_id, version, workspace_id, agent_id, agent_version_id, question_authority, result_semantics,
      criterion, positive_label, negative_label,
      rationale_mode, audience, content_boundary, private_sensitivity, private_group_id,
      private_group_policy_version, private_group_policy_hash, semantic_schema_version,
      required_expertise_keys_json, expertise_requirements_json,
      response_window_seconds, panel_size,
      compensation_mode, bounty_per_seat_atomic, feedback_bonus_enabled, feedback_bonus_pool_atomic,
      feedback_bonus_awarder_kind, feedback_bonus_awarder_account, feedback_bonus_award_window_seconds,
      configuration_status, profile_hash, created_by,
      created_at, approved_by, approved_at, superseded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,'ready',$30,$31,$32,$31,$32,NULL)`,
    [
      profileId,
      version,
      input.workspaceId,
      input.profile.agentId,
      input.profile.agentVersionId,
      input.profile.questionAuthority,
      input.profile.resultSemantics,
      input.profile.criterion,
      input.profile.positiveLabel,
      input.profile.negativeLabel,
      input.profile.rationaleMode,
      input.profile.audience,
      input.profile.contentBoundary,
      input.profile.privateSensitivity,
      input.profile.privateGroupId,
      input.profile.privateGroupPolicyVersion,
      input.profile.privateGroupPolicyHash,
      input.profile.semanticSchemaVersion,
      stableJson(input.profile.requiredExpertiseKeys),
      stableJson(input.profile.expertiseRequirements),
      input.profile.responseWindowSeconds,
      input.profile.panelSize,
      input.profile.compensationMode,
      input.profile.bountyPerSeatAtomic,
      input.profile.feedbackBonusEnabled,
      input.profile.feedbackBonusPoolAtomic,
      input.profile.feedbackBonusAwarderKind,
      input.profile.feedbackBonusAwarderAccount,
      input.profile.feedbackBonusAwardWindowSeconds,
      profileHash,
      input.actor,
      input.now,
    ],
  );
  return { id: profileId, version, hash: profileHash };
}

export async function putHumanReviewConfigurationForOwner(input: PutHumanReviewConfigurationInput) {
  const actor = await requireManagement(input.accountAddress, input.workspaceId);
  const body = normalizeOwnerMutation(input.body);
  const now = new Date();
  const client = await dbPool.connect();
  let saved: HumanReviewConfiguration | undefined;
  let activatedGrant: PreparedPublishingGrant | undefined;
  let downgradedIntegrationIds: string[] = [];
  try {
    await client.query("BEGIN");
    const agent = await currentAgentVersion(client, input.workspaceId, input.agentId, true);
    const currentBindingResult = await client.query(
      `SELECT *
       FROM tokenless_agent_human_review_bindings
       WHERE workspace_id = $1 AND agent_id = $2 AND agent_version_id = $3
         AND enabled = true AND superseded_at IS NULL
       FOR UPDATE`,
      [input.workspaceId, input.agentId, agent.agentVersionId],
    );
    const currentBinding = currentBindingResult.rows[0] as Row | undefined;
    const currentBindingVersion = currentBinding ? rowInteger(currentBinding, "version") : null;
    if (body.expectedBindingVersion !== currentBindingVersion) {
      throw new TokenlessServiceError(
        "Human-review configuration changed. Reload it and try again.",
        409,
        "human_review_configuration_conflict",
      );
    }
    let publishingPolicy: HumanReviewVersionReference | null = currentBinding
      ? rowString(currentBinding, "publishing_policy_id")
        ? {
            id: rowString(currentBinding, "publishing_policy_id")!,
            version: rowInteger(currentBinding, "publishing_policy_version"),
          }
        : null
      : null;
    let preparedGrant: PreparedPublishingGrant | undefined;
    let exactPublishingGrant: ExactOwnerPublishingGrant | undefined;
    if (body.publishingGrant === null) publishingPolicy = null;
    else if (body.publishingGrant && !("provision" in body.publishingGrant)) {
      exactPublishingGrant = body.publishingGrant;
      publishingPolicy = {
        id: body.publishingGrant.publishingPolicyId,
        version: body.publishingGrant.publishingPolicyVersion,
      };
    }
    const group = await resolvePrivateGroupTuple(client, {
      workspaceId: input.workspaceId,
      audience: body.requestProfile.audience,
      privateGroupId: body.requestProfile.privateGroupId,
    });
    const profile = normalizeReviewRequestProfileInput({
      ...body.requestProfile,
      agentId: input.agentId,
      agentVersionId: agent.agentVersionId,
      privateGroupId: group.id,
      privateGroupPolicyVersion: group.version,
      privateGroupPolicyHash: group.hash,
    });
    await validateReviewerExpertiseRequirementsWithClient(client, {
      workspaceId: input.workspaceId,
      audience: profile.audience,
      panelSize: profile.panelSize,
      requirements: profile.expertiseRequirements,
    });
    assertPrivateSensitivityAllowed(profile.privateSensitivity, group.maximumSensitivity);
    if (body.publishingGrant && "provision" in body.publishingGrant) {
      publishingPolicy = await provisionPrivateInvitedUnpaidPublishingPolicy(client, {
        actor,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        requestProfile: profile,
        group,
        now,
      });
      exactPublishingGrant = {
        integrationId: body.publishingGrant.integrationId,
        publishingPolicyId: publishingPolicy.id,
        publishingPolicyVersion: publishingPolicy.version,
        allowedWorkflowKeys: body.publishingGrant.allowedWorkflowKeys,
      };
    }
    if (exactPublishingGrant) {
      preparedGrant = await prepareExactPublishingGrant(client, {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        agentVersionId: agent.agentVersionId,
        ...exactPublishingGrant,
        paymentProfile: profile,
        now,
      });
      publishingPolicy = preparedGrant.publishingPolicy;
    }
    const selection = normalizeManagedReviewPolicyInput({
      ...body.selection,
      agentId: input.agentId,
      agentVersionId: agent.agentVersionId,
      audience: profile.audience,
      publishingPolicyId: publishingPolicy?.id ?? null,
    });
    if (profile.questionAuthority === "agent_per_request") {
      if (profile.resultSemantics !== "feedback") {
        configurationError(
          "Agent-written questions must use feedback result semantics.",
          "invalid_human_review_owner_request",
        );
      }
      if (profile.audience !== "public_network" || profile.contentBoundary !== "public_or_test") {
        configurationError(
          "Agent-written questions currently require the public reviewer network and public or test material.",
          "invalid_human_review_owner_request",
        );
      }
      if (selection.mode === "adaptive") {
        configurationError(
          "Adaptive review requires one owner-fixed question; choose another review frequency for agent-written questions.",
          "invalid_human_review_owner_request",
        );
      }
    } else if (profile.resultSemantics !== "assurance") {
      configurationError(
        "Owner-fixed questions must use assurance result semantics.",
        "invalid_human_review_owner_request",
      );
    }
    const requestProfile = await versionOwnerProfile(client, {
      workspaceId: input.workspaceId,
      actor,
      profile,
      now,
    });
    const selectionPolicy = await versionOwnerSelection(client, {
      workspaceId: input.workspaceId,
      actor,
      policy: selection,
      profile,
      requestProfile,
      now,
    });
    if (body.publishingGrant === null) {
      downgradedIntegrationIds = await downgradePublishingGrants(client, {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        agentVersionId: agent.agentVersionId,
        selectionPolicy,
        actor,
        now,
      });
    }
    if (preparedGrant) {
      const changed = await activatePreparedPublishingGrant(client, {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        agentVersionId: agent.agentVersionId,
        selectionPolicy,
        grant: preparedGrant,
        now,
      });
      if (changed) activatedGrant = preparedGrant;
    }
    if (currentBinding) {
      const current = configurationFromRow(currentBinding);
      const unchanged =
        current.selectionPolicy.id === selectionPolicy.id &&
        current.selectionPolicy.version === selectionPolicy.version &&
        current.requestProfile.id === requestProfile.id &&
        current.requestProfile.version === requestProfile.version &&
        current.publishingPolicy?.id === publishingPolicy?.id &&
        current.publishingPolicy?.version === publishingPolicy?.version &&
        current.authority === body.authority;
      if (unchanged) {
        saved = current;
      }
    }
    if (!saved) {
      saved = await saveHumanReviewConfigurationInTransaction(client, {
        actor,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        agentVersionId: agent.agentVersionId,
        expectedBindingVersion: body.expectedBindingVersion,
        selectionPolicy,
        requestProfile: { id: requestProfile.id, version: requestProfile.version },
        publishingPolicy,
        authority: body.authority,
        now,
      });
    }
    if (activatedGrant) {
      const details = {
        source: "browser_owner_human_review_configuration",
        explicitBrowserConsent: true,
        previousGrant: activatedGrant.previousGrant,
        activeGrant: {
          agentId: input.agentId,
          agentVersionId: agent.agentVersionId,
          selectionPolicy,
          humanReviewBinding: { id: saved.bindingId, version: saved.version },
          publishingPolicy: activatedGrant.publishingPolicy,
          publishingPolicyCaps: activatedGrant.policyCaps,
          allowedWorkflowKeys: activatedGrant.allowedWorkflowKeys,
          grantedScopes: activatedGrant.grantedScopes,
        },
      };
      await client.query(
        `INSERT INTO tokenless_agent_integration_events
         (event_id,integration_id,workspace_id,event_type,actor_type,actor_reference,details_json,created_at)
         VALUES ($1,$2,$3,'scope_upgraded','account',$4,$5,$6)`,
        [
          `agie_${randomUUID().replaceAll("-", "")}`,
          activatedGrant.integrationId,
          input.workspaceId,
          actor,
          stableJson(details),
          now,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (!saved) throw new Error("Human-review configuration save did not complete.");
  if (activatedGrant) {
    await appendAuditEvent({
      action: "agent.integration_scope_upgraded",
      actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
      actorReference: actor,
      assuranceMethod: "rateloop_session",
      metadata: {
        agentId: input.agentId,
        agentVersionId: saved.agentVersionId,
        humanReviewBindingId: saved.bindingId,
        humanReviewBindingVersion: saved.version,
        publishingPolicyId: activatedGrant.publishingPolicy.id,
        publishingPolicyVersion: activatedGrant.publishingPolicy.version,
        allowedWorkflowKeys: activatedGrant.allowedWorkflowKeys,
        grantedScopes: activatedGrant.grantedScopes,
        explicitBrowserConsent: true,
      },
      purpose: "automatic_human_review_publishing_grant",
      reason: "workspace_administrator_human_review_consent",
      result: "success",
      targetId: activatedGrant.integrationId,
      targetKind: "agent_integration",
      workspaceId: input.workspaceId,
    });
  }
  await Promise.all(
    downgradedIntegrationIds.map(integrationId =>
      appendAuditEvent({
        action: "agent.integration_scope_downgraded",
        actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
        actorReference: actor,
        assuranceMethod: "rateloop_session",
        metadata: {
          agentId: input.agentId,
          agentVersionId: saved!.agentVersionId,
          humanReviewBindingId: saved!.bindingId,
          humanReviewBindingVersion: saved!.version,
          grantedScopes: SAFE_AGENT_CONNECTION_SCOPES,
          explicitBrowserConsent: true,
        },
        purpose: "human_review_publishing_grant_removal",
        reason: "workspace_administrator_human_review_consent",
        result: "success",
        targetId: integrationId,
        targetKind: "agent_integration",
        workspaceId: input.workspaceId,
      }),
    ),
  );
  let privateReviewRouting: WorkspacePrivateReviewRoutingReadiness | null = null;
  let privateReviewRoutingReconciliationFailed = false;
  if (body.requestProfile.audience === "private_invited") {
    try {
      privateReviewRouting = await provisionWorkspacePrivateReviewRouting({
        accountAddress: actor,
        workspaceId: input.workspaceId,
        profileId: saved.requestProfile.id,
        profileVersion: saved.requestProfile.version,
        profileHash: saved.requestProfile.hash,
      });
    } catch {
      privateReviewRoutingReconciliationFailed = true;
    }
  }
  return { configuration: saved, privateReviewRouting, privateReviewRoutingReconciliationFailed };
}

function connectionFromRow(row: Row) {
  const scopes = parseStringArray(row.granted_scopes_json, "connection scopes");
  return {
    integrationId: rowString(row, "integration_id")!,
    status: rowString(row, "status")!,
    connectionStatus: rowString(row, "connection_status"),
    activationMode: rowString(row, "activation_mode")!,
    enforcementMode: rowString(row, "enforcement_mode"),
    reportedLane: connectionLaneFromClientCapabilitiesJson(row.client_capabilities_json),
    publishingPolicyId: rowString(row, "publishing_policy_id"),
    publishingPolicyVersion: nullableInteger(row, "publishing_policy_version"),
    safeAccess: {
      canCheckReviewRequirement: SAFE_EVALUATION_SCOPES.every(scope => scopes.includes(scope)),
      canPublish: scopes.includes("panel:publish"),
      canSpend: scopes.includes("payment:submit"),
      canReadPrivateArtifacts: scopes.includes("artifact:read_private"),
      canAdministerWorkspace: false,
    },
    activity: {
      lastInitializedAt: nullableIso(row.last_initialize_at, "connection initialization timestamp"),
      lastContextAt: nullableIso(row.last_context_at, "connection context timestamp"),
      lastConnectionTestAt: nullableIso(row.last_connection_test_at, "connection test timestamp"),
      lastSeenAt: nullableIso(row.last_seen_at, "connection activity timestamp"),
      lastDecisionAt: nullableIso(row.last_decision_at, "review decision timestamp"),
      lastRequestAt: nullableIso(row.last_request_at, "review request timestamp"),
      lastResultAt: nullableIso(row.last_result_at, "review result timestamp"),
    },
    diagnostic: rowString(row, "last_diagnostic_code")
      ? {
          code: rowString(row, "last_diagnostic_code")!,
          at: nullableIso(row.last_diagnostic_at, "connection diagnostic timestamp"),
          recoveryAction: rowString(row, "recovery_action"),
        }
      : null,
    scopes,
    allowedWorkflowKeys: parseStringArray(row.allowed_workflow_keys_json, "allowed workflows"),
  };
}

export async function getHumanReviewConfigurationForOwner(input: {
  accountAddress: string;
  workspaceId: string;
  agentId: string;
}) {
  await requireManagement(input.accountAddress, input.workspaceId);
  const client = await dbPool.connect();
  try {
    const agent = await currentAgentVersion(client, input.workspaceId, input.agentId, false);
    const [bindingResult, connectionResult] = await Promise.all([
      client.query(
        `SELECT b.*, p.mode, p.agreement_threshold_bps, p.production_floor_bps, p.fixed_rate_bps,
                p.maximum_unreviewed_gap, p.rules_json, p.audience_policy_json,
                p.publishing_policy_id AS selection_publishing_policy_id,
                r.question_authority, r.result_semantics,
                r.criterion, r.positive_label, r.negative_label, r.rationale_mode, r.audience,
                r.content_boundary, r.private_sensitivity, r.private_group_id, r.private_group_policy_version,
                r.private_group_policy_hash, r.response_window_seconds, r.panel_size,
                r.semantic_schema_version, r.required_expertise_keys_json, r.expertise_requirements_json,
                r.compensation_mode, r.bounty_per_seat_atomic, r.feedback_bonus_enabled,
                r.feedback_bonus_pool_atomic, r.feedback_bonus_awarder_kind,
                r.feedback_bonus_awarder_account, r.feedback_bonus_award_window_seconds,
                r.configuration_status
         FROM tokenless_agent_human_review_bindings b
         JOIN tokenless_agent_review_policies p
           ON p.workspace_id = b.workspace_id AND p.policy_id = b.selection_policy_id
          AND p.version = b.selection_policy_version
         JOIN tokenless_agent_review_request_profiles r
           ON r.workspace_id = b.workspace_id AND r.profile_id = b.request_profile_id
          AND r.version = b.request_profile_version AND r.profile_hash = b.request_profile_hash
         WHERE b.workspace_id = $1 AND b.agent_id = $2 AND b.agent_version_id = $3
           AND b.enabled = true AND b.superseded_at IS NULL
         LIMIT 1`,
        [input.workspaceId, input.agentId, agent.agentVersionId],
      ),
      client.query(
        `SELECT i.*, c.status AS connection_status, c.client_capabilities_json
         FROM tokenless_agent_integrations i
         LEFT JOIN tokenless_agent_connection_intents c ON c.intent_id = i.connection_intent_id
         WHERE i.workspace_id = $1 AND i.agent_id = $2 AND i.agent_version_id = $3
         ORDER BY CASE WHEN i.status = 'active' THEN 0 ELSE 1 END, i.updated_at DESC`,
        [input.workspaceId, input.agentId, agent.agentVersionId],
      ),
    ]);
    const connections = connectionResult.rows.map(value => connectionFromRow(value as Row));
    const connection =
      connections.find(candidate => candidate.status === "active" && candidate.connectionStatus === "connected") ??
      connections.find(candidate => candidate.status === "active") ??
      connections[0] ??
      null;
    const bindingRow = bindingResult.rows[0] as Row | undefined;
    if (!bindingRow) {
      return {
        agent: { agentId: input.agentId, agentVersionId: agent.agentVersionId, displayName: agent.displayName },
        bindingRevision: null,
        configuration: null,
        capability: null,
        blockingReason: {
          code: "human_review_configuration_required",
          message: "Complete the human-review configuration for this agent version.",
        },
        connection,
      };
    }
    const selection = ownerSelectionFromRow({
      ...bindingRow,
      publishing_policy_id: bindingRow.selection_publishing_policy_id,
    });
    const requestProfile = ownerProfileFromRow(bindingRow);
    const publishingPolicyId = rowString(bindingRow, "publishing_policy_id");
    const publishingPolicy = publishingPolicyId
      ? { id: publishingPolicyId, version: rowInteger(bindingRow, "publishing_policy_version") }
      : null;
    const paymentRequired = humanReviewRequiresPayment({
      compensationMode: requestProfile.compensationMode as "unpaid" | "usdc",
      feedbackBonusEnabled: requestProfile.feedbackBonusEnabled,
    });
    const delegationConnection = publishingPolicy
      ? (connections.find(
          candidate =>
            candidate.activationMode === "owner_approved" &&
            candidate.status === "active" &&
            candidate.connectionStatus === "connected" &&
            candidate.publishingPolicyId === publishingPolicy.id &&
            candidate.publishingPolicyVersion === publishingPolicy.version &&
            candidate.safeAccess.canPublish &&
            (!paymentRequired || candidate.safeAccess.canSpend),
        ) ?? null)
      : null;
    const authority = rowString(bindingRow, "authority") as HumanReviewAuthorityLevel;
    const readiness = deployedHumanReviewReadiness({
      evaluation: Boolean(
        connection?.safeAccess.canCheckReviewRequirement && connection.connectionStatus === "connected",
      ),
      autonomousPublishing: Boolean(delegationConnection),
    });
    const capability = resolveHumanReviewCapability(
      {
        audience: requestProfile.audience as Parameters<typeof resolveHumanReviewCapability>[0]["audience"],
        compensationMode: requestProfile.compensationMode as Parameters<
          typeof resolveHumanReviewCapability
        >[0]["compensationMode"],
        contentBoundary: requestProfile.contentBoundary as Parameters<
          typeof resolveHumanReviewCapability
        >[0]["contentBoundary"],
        authority,
      },
      readiness,
    );
    return {
      agent: { agentId: input.agentId, agentVersionId: agent.agentVersionId, displayName: agent.displayName },
      bindingRevision: rowInteger(bindingRow, "version"),
      configuration: {
        binding: {
          id: rowString(bindingRow, "binding_id")!,
          version: rowInteger(bindingRow, "version"),
          canonicalHash: rowString(bindingRow, "canonical_hash")!,
          approvedAt: iso(bindingRow.approved_at, "binding approval timestamp"),
        },
        selection: {
          id: rowString(bindingRow, "selection_policy_id")!,
          version: rowInteger(bindingRow, "selection_policy_version"),
          value: selection,
        },
        requestProfile: {
          id: rowString(bindingRow, "request_profile_id")!,
          version: rowInteger(bindingRow, "request_profile_version"),
          hash: rowString(bindingRow, "request_profile_hash")!,
          value: requestProfile,
        },
        authority,
        delegation: publishingPolicy
          ? {
              publishingPolicy,
              integrationId: delegationConnection?.integrationId ?? null,
              allowedWorkflowKeys: delegationConnection?.allowedWorkflowKeys ?? [],
            }
          : null,
      },
      capability,
      blockingReason: capability.available ? null : { code: capability.code, message: capability.message },
      connection,
    };
  } finally {
    client.release();
  }
}

export const __humanReviewConfigurationTestUtils = { semanticDocument, stableJson };
