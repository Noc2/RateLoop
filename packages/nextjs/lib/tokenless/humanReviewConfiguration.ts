import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import { HUMAN_REVIEW_AUTHORITY_LEVELS, type HumanReviewAuthorityLevel } from "~~/lib/tokenless/reviewCapabilities";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

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

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const REQUIRED_AUTOMATIC_SCOPES = ["panel:publish", "payment:submit"] as const;

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
  },
) {
  const result = await client.query(
    `SELECT i.granted_scopes_json
     FROM tokenless_agent_integrations i
     LEFT JOIN tokenless_agent_oauth_token_families f ON f.token_family_id = i.token_family_id
     WHERE i.workspace_id = $1 AND i.agent_id = $2 AND i.agent_version_id = $3
       AND i.publishing_policy_id = $4 AND i.publishing_policy_version = $5
       AND i.status = 'active' AND i.revoked_at IS NULL AND i.activation_mode = 'owner_approved'
       AND (i.token_family_id IS NULL OR (f.status = 'active' AND f.revoked_at IS NULL))
     FOR SHARE`,
    [input.workspaceId, input.agentId, input.agentVersionId, input.publishingPolicy.id, input.publishingPolicy.version],
  );
  return result.rows.some(row => {
    const scopes = parseStringArray((row as Row).granted_scopes_json, "delegation scopes");
    return REQUIRED_AUTOMATIC_SCOPES.every(scope => scopes.includes(scope));
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
    `SELECT audience_policy_json FROM tokenless_agent_review_policies
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
  const profile = await client.query(
    `SELECT audience, configuration_status, profile_hash, approved_at
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
  const policyAudience = selectionAudience((selection.rows[0] as Row).audience_policy_json);
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

export const __humanReviewConfigurationTestUtils = { semanticDocument, stableJson };
