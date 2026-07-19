import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { assertCanCreatePrivateGroup } from "~~/lib/billing/entitlements";
import { dbClient, dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const INVITATION_TOKEN_PATTERN = /^rlgi_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/u;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DEFAULT_INVITATION_TTL_MS = 7 * 86_400_000;
const MAX_INVITATION_TTL_MS = 30 * 86_400_000;
const DEFAULT_EXPERTISE_TTL_MS = 365 * 86_400_000;
const MAX_EXPERTISE_TTL_MS = 2 * 365 * 86_400_000;
const EXPERTISE_DEFINITION_ID_PATTERN = /^expd_[a-z0-9_]{3,120}$/u;
const EMAIL_PATTERN = /^[^\s@]+@([^\s@]+)$/u;
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const DATA_CLASSIFICATIONS = new Set(["internal", "confidential", "restricted", "regulated"]);
const PRIVATE_SENSITIVITY_ORDER = ["internal", "confidential", "restricted", "regulated"] as const;

type Row = Record<string, unknown>;
type Client = PoolClient;

export type PrivateGroupPolicyInput = {
  defaultCompensation?: "unpaid" | "paid";
  worldIdRequired?: boolean;
  allowedProjectIds?: string[];
  dataClassifications?: string[];
  exportAllowed?: boolean;
  assignmentNotifications?: boolean;
};

export type CreatePrivateGroupInput = {
  accountAddress: string;
  workspaceId: string;
  name: string;
  purpose: string;
  policy?: PrivateGroupPolicyInput;
};

export type CreatePrivateGroupInvitationInput = {
  accountAddress: string;
  workspaceId: string;
  groupId: string;
  expiresAt?: Date;
  maximumRedemptions?: number;
  membershipExpiresAt?: Date | null;
  allowedProjectIds?: string[];
  intendedAccountAddress?: string | null;
  intendedEmail?: string | null;
  intendedEmailDomain?: string | null;
  expertiseDefinitions?: unknown;
  expertiseExpiresAt?: Date | null;
  now?: Date;
};

type InvitationExpertiseDefinition = {
  definitionId: string;
  definitionVersion: number;
  definitionHash: string;
};

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowDate(row: Row | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function rowNumber(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  return Number.isSafeInteger(value) ? value : null;
}

function rowBoolean(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === true || value === "t" || value === 1;
}

function normalizeAddress(value: string, field = "accountAddress") {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError(`${field} must be a valid account address.`, 400, "invalid_private_group");
  }
}

function requiredText(value: string, field: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new TokenlessServiceError(`${field} must contain 1-${maximum} characters.`, 400, "invalid_private_group");
  }
  return normalized;
}

function integer(value: number, field: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TokenlessServiceError(
      `${field} must be an integer from ${minimum} to ${maximum}.`,
      400,
      "invalid_private_group",
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function policyHash(value: unknown) {
  return `sha256:${digest(canonicalJson(value))}`;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error("Private-group data is invalid.");
  }
}

function normalizedIds(values: string[] | undefined, field: string) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 100) {
    throw new TokenlessServiceError(`${field} must contain at most 100 project IDs.`, 400, "invalid_private_group");
  }
  const result = [...new Set(values.map(value => requiredText(value, field, 160)))].sort();
  return result;
}

function normalizedClassifications(values: string[] | undefined) {
  const result = values ?? ["internal", "confidential"];
  if (
    !Array.isArray(result) ||
    result.length === 0 ||
    result.some(value => !DATA_CLASSIFICATIONS.has(value)) ||
    new Set(result).size !== result.length
  ) {
    throw new TokenlessServiceError("dataClassifications is invalid.", 400, "invalid_private_group");
  }
  return [...result].sort();
}

function maximumPrivateSensitivity(dataClassifications: string[]) {
  for (let index = PRIVATE_SENSITIVITY_ORDER.length - 1; index >= 0; index -= 1) {
    const sensitivity = PRIVATE_SENSITIVITY_ORDER[index]!;
    if (dataClassifications.includes(sensitivity)) return sensitivity;
  }
  throw new TokenlessServiceError("dataClassifications is invalid.", 400, "invalid_private_group");
}

function normalizeEmail(value: string) {
  const normalized = value.trim().toLowerCase();
  const match = EMAIL_PATTERN.exec(normalized);
  if (!match || normalized.length > 320 || !DOMAIN_PATTERN.test(match[1]!)) {
    throw new TokenlessServiceError("intendedEmail is invalid.", 400, "invalid_private_group_invitation");
  }
  return normalized;
}

function normalizeDomain(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\.$/u, "");
  if (!DOMAIN_PATTERN.test(normalized)) {
    throw new TokenlessServiceError("intendedEmailDomain is invalid.", 400, "invalid_private_group_invitation");
  }
  return normalized;
}

function normalizeInvitationExpertiseDefinitions(value: unknown): InvitationExpertiseDefinition[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 8) {
    throw new TokenlessServiceError(
      "Invitation specialist areas must contain at most eight definitions.",
      400,
      "invalid_private_group_invitation",
    );
  }
  const definitions = value.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TokenlessServiceError(
        "Invitation specialist area is invalid.",
        400,
        "invalid_private_group_invitation",
      );
    }
    const body = entry as Record<string, unknown>;
    if (
      Object.keys(body).some(key => !["definitionId", "definitionVersion", "definitionHash"].includes(key)) ||
      typeof body.definitionId !== "string" ||
      !EXPERTISE_DEFINITION_ID_PATTERN.test(body.definitionId) ||
      !Number.isSafeInteger(body.definitionVersion) ||
      Number(body.definitionVersion) < 1 ||
      typeof body.definitionHash !== "string" ||
      !HASH_PATTERN.test(body.definitionHash)
    ) {
      throw new TokenlessServiceError(
        "Invitation specialist area is invalid.",
        400,
        "invalid_private_group_invitation",
      );
    }
    return {
      definitionId: body.definitionId,
      definitionVersion: Number(body.definitionVersion),
      definitionHash: body.definitionHash,
    };
  });
  definitions.sort(
    (left, right) =>
      left.definitionId.localeCompare(right.definitionId) || left.definitionVersion - right.definitionVersion,
  );
  if (
    definitions.some(
      (definition, index) => index > 0 && definitions[index - 1]!.definitionId === definition.definitionId,
    )
  ) {
    throw new TokenlessServiceError(
      "Each invitation specialist area can be selected only once.",
      400,
      "invalid_private_group_invitation",
    );
  }
  return definitions;
}

async function validateProjects(client: Pick<Client, "query">, workspaceId: string, projectIds: string[]) {
  for (const projectId of projectIds) {
    const result = await client.query(
      `SELECT project_id FROM tokenless_assurance_projects
       WHERE project_id = $1 AND workspace_id = $2 AND status = 'active' LIMIT 1`,
      [projectId, workspaceId],
    );
    if (result.rowCount !== 1) {
      throw new TokenlessServiceError("An allowed project is unavailable.", 400, "invalid_private_group_project");
    }
  }
}

async function appendEvent(
  client: Pick<Client, "query">,
  input: {
    workspaceId: string;
    groupId: string;
    invitationId?: string | null;
    principalAddress?: string | null;
    eventType:
      | "group_created"
      | "policy_version_created"
      | "invitation_created"
      | "invitation_redeemed"
      | "invitation_revoked"
      | "membership_removed"
      | "membership_left";
    actorReference: string;
    details?: Record<string, unknown>;
    now: Date;
  },
) {
  await client.query(
    `INSERT INTO tokenless_private_group_events
     (event_id, workspace_id, group_id, invitation_id, principal_address,
      event_type, actor_reference, details_json, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      `pge_${randomUUID().replaceAll("-", "")}`,
      input.workspaceId,
      input.groupId,
      input.invitationId ?? null,
      input.principalAddress ?? null,
      input.eventType,
      input.actorReference,
      canonicalJson(input.details ?? {}),
      input.now,
    ],
  );
}

export async function requirePrivateGroupManager(input: {
  accountAddress: string;
  workspaceId: string;
  groupId?: string;
}) {
  const accountAddress = normalizeAddress(input.accountAddress);
  const result = await dbClient.execute({
    sql: `SELECT m.role, g.group_id, g.status
          FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id AND w.status = 'active'
          LEFT JOIN tokenless_private_groups g ON g.workspace_id = m.workspace_id
            ${input.groupId ? "AND g.group_id = ?" : ""}
          WHERE m.workspace_id = ? AND m.account_address = ? AND m.role IN ('owner','admin')
          LIMIT 1`,
    args: input.groupId ? [input.groupId, input.workspaceId, accountAddress] : [input.workspaceId, accountAddress],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row || (input.groupId && (!rowString(row, "group_id") || rowString(row, "status") !== "active"))) {
    throw new TokenlessServiceError("Private group not found.", 404, "private_group_not_found");
  }
  return accountAddress;
}

export async function requireActivePrivateGroupMembership(input: {
  accountAddress: string;
  groupId: string;
  workspaceId?: string;
  now?: Date;
}) {
  const accountAddress = normalizeAddress(input.accountAddress);
  const now = input.now ?? new Date();
  const result = await dbClient.execute({
    sql: `SELECT g.group_id, g.workspace_id, m.role, m.allowed_project_ids_json, m.membership_expires_at
          FROM tokenless_private_group_memberships m
          JOIN tokenless_private_groups g ON g.group_id = m.group_id AND g.status = 'active'
          JOIN tokenless_workspaces w ON w.workspace_id = g.workspace_id AND w.status = 'active'
          WHERE m.group_id = ? AND m.principal_address = ? AND m.status = 'active'
            AND (m.membership_expires_at IS NULL OR m.membership_expires_at > ?)
            ${input.workspaceId ? "AND g.workspace_id = ?" : ""}
          LIMIT 1`,
    args: input.workspaceId
      ? [input.groupId, accountAddress, now, input.workspaceId]
      : [input.groupId, accountAddress, now],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new TokenlessServiceError("Private group not found.", 404, "private_group_not_found");
  return {
    groupId: rowString(row, "group_id")!,
    workspaceId: rowString(row, "workspace_id")!,
    role: rowString(row, "role")!,
    allowedProjectIds: parseJson<string[]>(row.allowed_project_ids_json, []),
    membershipExpiresAt: rowDate(row, "membership_expires_at")?.toISOString() ?? null,
  };
}

function normalizePolicy(input: PrivateGroupPolicyInput = {}) {
  const compensation = input.defaultCompensation ?? "unpaid";
  if (compensation !== "unpaid" && compensation !== "paid") {
    throw new TokenlessServiceError("defaultCompensation is invalid.", 400, "invalid_private_group");
  }
  return {
    schemaVersion: "rateloop.private-group-policy.v2" as const,
    defaultCompensation: compensation,
    worldIdRequired: input.worldIdRequired ?? false,
    allowedProjectIds: normalizedIds(input.allowedProjectIds, "allowedProjectIds"),
    dataClassifications: normalizedClassifications(input.dataClassifications),
    exportAllowed: input.exportAllowed ?? false,
    notificationDefaults: { assignmentAvailable: input.assignmentNotifications ?? true },
  };
}

export async function createPrivateGroup(input: CreatePrivateGroupInput) {
  const manager = await requirePrivateGroupManager(input);
  const name = requiredText(input.name, "name", 120);
  const purpose = requiredText(input.purpose, "purpose", 500);
  const policy = normalizePolicy(input.policy);
  const groupId = `pgrp_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await assertCanCreatePrivateGroup(client, input.workspaceId, now);
    await validateProjects(client, input.workspaceId, policy.allowedProjectIds);
    await client.query(
      `INSERT INTO tokenless_private_groups
       (group_id, workspace_id, name, purpose, status, current_policy_version, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'active',1,$5,$6,$6)`,
      [groupId, input.workspaceId, name, purpose, manager, now],
    );
    const frozenPolicy = { ...policy, groupId, version: 1 };
    const frozenPolicyJson = canonicalJson(frozenPolicy);
    const frozenPolicyHash = policyHash(frozenPolicy);
    await client.query(
      `INSERT INTO tokenless_private_group_policy_versions
       (group_id, version, default_compensation, world_id_required, allowed_project_ids_json,
        data_classifications_json, max_private_sensitivity, export_allowed, notification_defaults_json,
        policy_hash, policy_json, created_by, created_at)
       VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        groupId,
        policy.defaultCompensation,
        policy.worldIdRequired,
        canonicalJson(policy.allowedProjectIds),
        canonicalJson(policy.dataClassifications),
        maximumPrivateSensitivity(policy.dataClassifications),
        policy.exportAllowed,
        canonicalJson(policy.notificationDefaults),
        frozenPolicyHash,
        frozenPolicyJson,
        manager,
        now,
      ],
    );
    await appendEvent(client, {
      workspaceId: input.workspaceId,
      groupId,
      eventType: "group_created",
      actorReference: manager,
      details: { policyHash: frozenPolicyHash, policyVersion: 1 },
      now,
    });
    await client.query("COMMIT");
    return {
      groupId,
      workspaceId: input.workspaceId,
      name,
      purpose,
      status: "active" as const,
      policy: frozenPolicy,
      policyHash: frozenPolicyHash,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new TokenlessServiceError("A private group with this name already exists.", 409, "private_group_conflict");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function createPrivateGroupPolicyVersion(input: {
  accountAddress: string;
  workspaceId: string;
  groupId: string;
  policy: PrivateGroupPolicyInput;
}) {
  const manager = await requirePrivateGroupManager(input);
  const policy = normalizePolicy(input.policy);
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const groupResult = await client.query(
      `SELECT current_policy_version FROM tokenless_private_groups
       WHERE group_id = $1 AND workspace_id = $2 AND status = 'active' LIMIT 1 FOR UPDATE`,
      [input.groupId, input.workspaceId],
    );
    const group = groupResult.rows[0] as Row | undefined;
    if (!group) throw new TokenlessServiceError("Private group not found.", 404, "private_group_not_found");
    const version = (rowNumber(group, "current_policy_version") ?? 0) + 1;
    await validateProjects(client, input.workspaceId, policy.allowedProjectIds);
    const frozenPolicy = { ...policy, groupId: input.groupId, version };
    const frozenPolicyJson = canonicalJson(frozenPolicy);
    const frozenPolicyHash = policyHash(frozenPolicy);
    await client.query(
      `INSERT INTO tokenless_private_group_policy_versions
       (group_id, version, default_compensation, world_id_required, allowed_project_ids_json,
        data_classifications_json, max_private_sensitivity, export_allowed, notification_defaults_json,
        policy_hash, policy_json, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        input.groupId,
        version,
        policy.defaultCompensation,
        policy.worldIdRequired,
        canonicalJson(policy.allowedProjectIds),
        canonicalJson(policy.dataClassifications),
        maximumPrivateSensitivity(policy.dataClassifications),
        policy.exportAllowed,
        canonicalJson(policy.notificationDefaults),
        frozenPolicyHash,
        frozenPolicyJson,
        manager,
        now,
      ],
    );
    await client.query(
      `UPDATE tokenless_private_groups SET current_policy_version = $1, updated_at = $2
       WHERE group_id = $3 AND workspace_id = $4`,
      [version, now, input.groupId, input.workspaceId],
    );
    await appendEvent(client, {
      workspaceId: input.workspaceId,
      groupId: input.groupId,
      eventType: "policy_version_created",
      actorReference: manager,
      details: { policyHash: frozenPolicyHash, policyVersion: version },
      now,
    });
    await client.query("COMMIT");
    return { groupId: input.groupId, version, policy: frozenPolicy, policyHash: frozenPolicyHash };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function groupFromRow(row: Row) {
  return {
    groupId: rowString(row, "group_id"),
    workspaceId: rowString(row, "workspace_id"),
    name: rowString(row, "name"),
    purpose: rowString(row, "purpose"),
    status: rowString(row, "status"),
    currentPolicyVersion: rowNumber(row, "current_policy_version"),
    memberCount: rowNumber(row, "member_count") ?? 0,
    policy: parseJson<Record<string, unknown>>(row.policy_json, {}),
    policyHash: rowString(row, "policy_hash"),
    createdAt: rowDate(row, "created_at")?.toISOString() ?? null,
    updatedAt: rowDate(row, "updated_at")?.toISOString() ?? null,
  };
}

export async function listPrivateGroups(input: { accountAddress: string; workspaceId: string }) {
  await requirePrivateGroupManager(input);
  const result = await dbClient.execute({
    sql: `SELECT g.*, p.policy_hash, p.policy_json,
                 COUNT(CASE WHEN m.status = 'active' AND (m.membership_expires_at IS NULL OR m.membership_expires_at > ?) THEN 1 END) AS member_count
          FROM tokenless_private_groups g
          JOIN tokenless_private_group_policy_versions p
            ON p.group_id = g.group_id AND p.version = g.current_policy_version
          LEFT JOIN tokenless_private_group_memberships m ON m.group_id = g.group_id
          WHERE g.workspace_id = ?
          GROUP BY g.group_id, p.policy_hash, p.policy_json
          ORDER BY g.created_at ASC`,
    args: [new Date(), input.workspaceId],
  });
  return result.rows.map(value => groupFromRow(value as Row));
}

export async function getPrivateGroup(input: { accountAddress: string; workspaceId: string; groupId: string }) {
  await requirePrivateGroupManager(input);
  const result = await dbClient.execute({
    sql: `SELECT g.*, p.policy_hash, p.policy_json,
                 COUNT(CASE WHEN m.status = 'active' AND (m.membership_expires_at IS NULL OR m.membership_expires_at > ?) THEN 1 END) AS member_count
          FROM tokenless_private_groups g
          JOIN tokenless_private_group_policy_versions p
            ON p.group_id = g.group_id AND p.version = g.current_policy_version
          LEFT JOIN tokenless_private_group_memberships m ON m.group_id = g.group_id
          WHERE g.workspace_id = ? AND g.group_id = ?
          GROUP BY g.group_id, p.policy_hash, p.policy_json LIMIT 1`,
    args: [new Date(), input.workspaceId, input.groupId],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new TokenlessServiceError("Private group not found.", 404, "private_group_not_found");
  const members = await dbClient.execute({
    sql: `SELECT principal_address, role, status, allowed_project_ids_json, source_invitation_id,
                 membership_expires_at, joined_at, ended_at, end_reason, updated_at
          FROM tokenless_private_group_memberships WHERE group_id = ? ORDER BY joined_at ASC`,
    args: [input.groupId],
  });
  return {
    ...groupFromRow(row),
    members: members.rows.map(value => {
      const member = value as Row;
      return {
        principalAddress: rowString(member, "principal_address"),
        role: rowString(member, "role"),
        status: rowString(member, "status"),
        allowedProjectIds: parseJson<string[]>(member.allowed_project_ids_json, []),
        sourceInvitationId: rowString(member, "source_invitation_id"),
        membershipExpiresAt: rowDate(member, "membership_expires_at")?.toISOString() ?? null,
        joinedAt: rowDate(member, "joined_at")?.toISOString() ?? null,
        endedAt: rowDate(member, "ended_at")?.toISOString() ?? null,
        endReason: rowString(member, "end_reason"),
      };
    }),
  };
}

function validateInvitationToken(token: string) {
  const normalized = token.trim();
  const match = INVITATION_TOKEN_PATTERN.exec(normalized);
  if (!match) throw new TokenlessServiceError("Invitation not found.", 404, "private_group_invitation_not_found");
  return { token: normalized, prefix: match[1]!, hash: digest(normalized) };
}

export async function createPrivateGroupInvitationInTransaction(
  client: Pick<Client, "query">,
  input: Omit<CreatePrivateGroupInvitationInput, "accountAddress"> & { actorAddress: string; token?: string },
) {
  const manager = normalizeAddress(input.actorAddress);
  const now = input.now ?? new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + DEFAULT_INVITATION_TTL_MS);
  const ttl = expiresAt.getTime() - now.getTime();
  if (!Number.isFinite(expiresAt.getTime()) || ttl < 60_000 || ttl > MAX_INVITATION_TTL_MS) {
    throw new TokenlessServiceError(
      "Invitation expiry must be between one minute and 30 days.",
      400,
      "invalid_private_group_invitation",
    );
  }
  const membershipExpiresAt = input.membershipExpiresAt ?? null;
  if (
    membershipExpiresAt &&
    (!Number.isFinite(membershipExpiresAt.getTime()) || membershipExpiresAt.getTime() <= now.getTime())
  ) {
    throw new TokenlessServiceError(
      "membershipExpiresAt must be in the future.",
      400,
      "invalid_private_group_invitation",
    );
  }
  const maximumRedemptions = integer(input.maximumRedemptions ?? 1, "maximumRedemptions", 1, 1000);
  const allowedProjectIds = normalizedIds(input.allowedProjectIds, "allowedProjectIds");
  const intendedAccount = input.intendedAccountAddress
    ? normalizeAddress(input.intendedAccountAddress, "intendedAccountAddress")
    : null;
  const intendedEmail = input.intendedEmail ? normalizeEmail(input.intendedEmail) : null;
  const intendedDomain = input.intendedEmailDomain ? normalizeDomain(input.intendedEmailDomain) : null;
  const expertiseDefinitions = normalizeInvitationExpertiseDefinitions(input.expertiseDefinitions);
  const expertiseExpiresAt = expertiseDefinitions.length
    ? (input.expertiseExpiresAt ?? new Date(now.getTime() + DEFAULT_EXPERTISE_TTL_MS))
    : null;
  if (
    expertiseExpiresAt &&
    (!Number.isFinite(expertiseExpiresAt.getTime()) ||
      expertiseExpiresAt <= now ||
      expertiseExpiresAt.getTime() - now.getTime() > MAX_EXPERTISE_TTL_MS ||
      (membershipExpiresAt !== null && expertiseExpiresAt > membershipExpiresAt))
  ) {
    throw new TokenlessServiceError(
      "Specialist confirmation expiry must be within two years and no later than membership expiry.",
      400,
      "invalid_private_group_invitation",
    );
  }
  if (
    expertiseDefinitions.length > 0 &&
    (maximumRedemptions !== 1 || (!intendedAccount && !intendedEmail) || intendedDomain !== null)
  ) {
    throw new TokenlessServiceError(
      "An invitation with intended specialist areas must be one-use and bound to one account or email.",
      400,
      "invalid_private_group_invitation",
    );
  }
  const tokenCandidate =
    input.token ?? `rlgi_${randomBytes(8).toString("hex")}_${randomBytes(32).toString("base64url")}`;
  const validatedToken = validateInvitationToken(tokenCandidate);
  const token = validatedToken.token;
  const prefix = validatedToken.prefix;
  const invitationId = `pgi_${randomUUID().replaceAll("-", "")}`;
  const managedGroup = await client.query(
    `SELECT g.group_id
     FROM tokenless_private_groups g
     JOIN tokenless_workspaces w ON w.workspace_id=g.workspace_id AND w.status='active'
     JOIN tokenless_workspace_members m
       ON m.workspace_id=g.workspace_id AND m.account_address=$3 AND m.role IN ('owner','admin')
     WHERE g.workspace_id=$1 AND g.group_id=$2 AND g.status='active'
     LIMIT 1 FOR SHARE`,
    [input.workspaceId, input.groupId, manager],
  );
  if (managedGroup.rowCount !== 1) {
    throw new TokenlessServiceError("Private group not found.", 404, "private_group_not_found");
  }
  await validateProjects(client, input.workspaceId, allowedProjectIds);
  for (const definition of expertiseDefinitions) {
    const available = await client.query(
      `SELECT 1 FROM tokenless_reviewer_expertise_definitions
       WHERE definition_id=$1 AND version=$2 AND definition_hash=$3
         AND status='active' AND superseded_at IS NULL
         AND (scope='global' OR workspace_id=$4)
       LIMIT 1 FOR SHARE`,
      [definition.definitionId, definition.definitionVersion, definition.definitionHash, input.workspaceId],
    );
    if (available.rowCount !== 1) {
      throw new TokenlessServiceError(
        "An intended specialist area is unavailable.",
        409,
        "reviewer_expertise_definition_unavailable",
      );
    }
  }
  await client.query(
    `INSERT INTO tokenless_private_group_invitations
     (invitation_id, workspace_id, group_id, token_hash, token_prefix, role,
      allowed_project_ids_json, intended_account_address, intended_email_hash, intended_email_domain,
      membership_expires_at, expires_at, maximum_redemptions, redemption_count, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,'reviewer',$6,$7,$8,$9,$10,$11,$12,0,$13,$14)`,
    [
      invitationId,
      input.workspaceId,
      input.groupId,
      validatedToken.hash,
      prefix,
      canonicalJson(allowedProjectIds),
      intendedAccount,
      intendedEmail ? digest(`${token}\0${intendedEmail}`) : null,
      intendedDomain,
      membershipExpiresAt,
      expiresAt,
      maximumRedemptions,
      manager,
      now,
    ],
  );
  for (const definition of expertiseDefinitions) {
    const evidenceReferenceHash = policyHash({
      schemaVersion: "rateloop.private-group-invitation-expertise.v1",
      invitationId,
      workspaceId: input.workspaceId,
      groupId: input.groupId,
      definition,
      assertedBy: manager,
      assertedAt: now.toISOString(),
      expiresAt: expertiseExpiresAt!.toISOString(),
    });
    await client.query(
      `INSERT INTO tokenless_private_group_invitation_expertise_attestations
       (attestation_id,invitation_id,expertise_definition_id,expertise_definition_version,
        expertise_definition_hash,asserted_by,asserted_at,expires_at,evidence_reference_hash,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
      [
        `pgiea_${randomUUID().replaceAll("-", "")}`,
        invitationId,
        definition.definitionId,
        definition.definitionVersion,
        definition.definitionHash,
        manager,
        now,
        expertiseExpiresAt,
        evidenceReferenceHash,
      ],
    );
  }
  await appendEvent(client, {
    workspaceId: input.workspaceId,
    groupId: input.groupId,
    invitationId,
    eventType: "invitation_created",
    actorReference: manager,
    details: {
      maximumRedemptions,
      hasAccountBinding: Boolean(intendedAccount),
      hasEmailBinding: Boolean(intendedEmail),
      hasDomainBinding: Boolean(intendedDomain),
      intendedSpecialistAreaCount: expertiseDefinitions.length,
    },
    now,
  });
  return {
    invitationId,
    token,
    tokenPrefix: prefix,
    expiresAt: expiresAt.toISOString(),
    membershipExpiresAt: membershipExpiresAt?.toISOString() ?? null,
    maximumRedemptions,
    expertiseDefinitions,
    expertiseExpiresAt: expertiseExpiresAt?.toISOString() ?? null,
  };
}

export async function createPrivateGroupInvitation(input: CreatePrivateGroupInvitationInput) {
  const manager = await requirePrivateGroupManager(input);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const invitation = await createPrivateGroupInvitationInTransaction(client, {
      ...input,
      actorAddress: manager,
    });
    await client.query("COMMIT");
    return invitation;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listPrivateGroupInvitations(input: {
  accountAddress: string;
  workspaceId: string;
  groupId: string;
}) {
  await requirePrivateGroupManager(input);
  const result = await dbClient.execute({
    sql: `SELECT invitation_id, token_prefix, role, allowed_project_ids_json,
                 intended_account_address, intended_email_hash, intended_email_domain,
                 membership_expires_at, expires_at, maximum_redemptions, redemption_count,
                 last_used_at, revoked_at, created_by, created_at
          FROM tokenless_private_group_invitations
          WHERE workspace_id = ? AND group_id = ? ORDER BY created_at DESC`,
    args: [input.workspaceId, input.groupId],
  });
  const expertise = await dbClient.execute({
    sql: `SELECT a.invitation_id,a.expertise_definition_id,a.expertise_definition_version,
                 a.expertise_definition_hash,a.expires_at,a.status,d.label,d.description
          FROM tokenless_private_group_invitation_expertise_attestations a
          JOIN tokenless_private_group_invitations i ON i.invitation_id=a.invitation_id
          JOIN tokenless_reviewer_expertise_definitions d
            ON d.definition_id=a.expertise_definition_id
           AND d.version=a.expertise_definition_version
           AND d.definition_hash=a.expertise_definition_hash
          WHERE i.workspace_id=? AND i.group_id=?
          ORDER BY a.invitation_id,d.label,a.expertise_definition_id`,
    args: [input.workspaceId, input.groupId],
  });
  const expertiseByInvitation = new Map<string, Array<Record<string, unknown>>>();
  for (const value of expertise.rows as Row[]) {
    const invitationId = rowString(value, "invitation_id");
    if (!invitationId) continue;
    const entries = expertiseByInvitation.get(invitationId) ?? [];
    entries.push({
      definitionId: rowString(value, "expertise_definition_id"),
      definitionVersion: rowNumber(value, "expertise_definition_version"),
      definitionHash: rowString(value, "expertise_definition_hash"),
      label: rowString(value, "label"),
      description: rowString(value, "description"),
      expiresAt: rowDate(value, "expires_at")?.toISOString() ?? null,
      status: rowString(value, "status"),
    });
    expertiseByInvitation.set(invitationId, entries);
  }
  return result.rows.map(value => {
    const row = value as Row;
    return {
      invitationId: rowString(row, "invitation_id"),
      tokenPrefix: rowString(row, "token_prefix"),
      role: rowString(row, "role"),
      allowedProjectIds: parseJson<string[]>(row.allowed_project_ids_json, []),
      hasAccountBinding: Boolean(rowString(row, "intended_account_address")),
      hasEmailBinding: Boolean(rowString(row, "intended_email_hash")),
      intendedEmailDomain: rowString(row, "intended_email_domain"),
      membershipExpiresAt: rowDate(row, "membership_expires_at")?.toISOString() ?? null,
      expiresAt: rowDate(row, "expires_at")?.toISOString() ?? null,
      maximumRedemptions: rowNumber(row, "maximum_redemptions"),
      redemptionCount: rowNumber(row, "redemption_count"),
      lastUsedAt: rowDate(row, "last_used_at")?.toISOString() ?? null,
      revokedAt: rowDate(row, "revoked_at")?.toISOString() ?? null,
      createdBy: rowString(row, "created_by"),
      createdAt: rowDate(row, "created_at")?.toISOString() ?? null,
      intendedExpertise: expertiseByInvitation.get(rowString(row, "invitation_id") ?? "") ?? [],
    };
  });
}

async function boundInvitation(
  client: Pick<Client, "query">,
  input: {
    accountAddress: string;
    token: string;
    tokenHash: string;
    now: Date;
    lock: boolean;
    allowExhausted?: boolean;
  },
) {
  const invitationResult = await client.query(
    `SELECT i.*, g.name AS group_name, g.purpose AS group_purpose, g.status AS group_status,
            w.name AS workspace_name, w.status AS workspace_status
     FROM tokenless_private_group_invitations i
     JOIN tokenless_private_groups g ON g.group_id = i.group_id AND g.workspace_id = i.workspace_id
     JOIN tokenless_workspaces w ON w.workspace_id = i.workspace_id
     WHERE i.token_hash = $1 LIMIT 1${input.lock ? " FOR UPDATE" : ""}`,
    [input.tokenHash],
  );
  const invitation = invitationResult.rows[0] as Row | undefined;
  if (!invitation) {
    throw new TokenlessServiceError("Invitation not found.", 404, "private_group_invitation_not_found");
  }
  if (
    rowString(invitation, "group_status") !== "active" ||
    rowString(invitation, "workspace_status") !== "active" ||
    rowDate(invitation, "revoked_at") ||
    (rowDate(invitation, "expires_at")?.getTime() ?? 0) <= input.now.getTime() ||
    (rowDate(invitation, "membership_expires_at")?.getTime() ?? Number.POSITIVE_INFINITY) <= input.now.getTime() ||
    (!input.allowExhausted &&
      (rowNumber(invitation, "redemption_count") ?? 0) >= (rowNumber(invitation, "maximum_redemptions") ?? 0))
  ) {
    throw new TokenlessServiceError("Invitation is no longer available.", 410, "private_group_invitation_unavailable");
  }
  const identityResult = await client.query(
    `SELECT primary_email, email_verified FROM tokenless_browser_identities
     WHERE principal_address = $1 LIMIT 1${input.lock ? " FOR SHARE" : ""}`,
    [input.accountAddress],
  );
  const identity = identityResult.rows[0] as Row | undefined;
  if (!identity) throw new TokenlessServiceError("Invitation not found.", 404, "private_group_invitation_not_found");
  if (
    rowString(invitation, "intended_account_address") &&
    rowString(invitation, "intended_account_address") !== input.accountAddress
  ) {
    throw new TokenlessServiceError(
      "Invitation is not available to this account.",
      403,
      "private_group_invitation_binding",
    );
  }
  const expectedEmailHash = rowString(invitation, "intended_email_hash");
  const expectedDomain = rowString(invitation, "intended_email_domain");
  if (expectedEmailHash || expectedDomain) {
    const email = rowString(identity, "primary_email")?.trim().toLowerCase() ?? "";
    const domain = email.includes("@") ? email.slice(email.lastIndexOf("@") + 1) : "";
    if (
      !rowBoolean(identity, "email_verified") ||
      (expectedEmailHash && digest(`${input.token}\0${email}`) !== expectedEmailHash) ||
      (expectedDomain && domain !== expectedDomain)
    ) {
      throw new TokenlessServiceError(
        "Invitation is not available to this account.",
        403,
        "private_group_invitation_binding",
      );
    }
  }
  return invitation;
}

export async function previewPrivateGroupInvitation(input: { accountAddress: string; token: string; now?: Date }) {
  const accountAddress = normalizeAddress(input.accountAddress);
  const token = validateInvitationToken(input.token);
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    const invitation = await boundInvitation(client, {
      accountAddress,
      token: token.token,
      tokenHash: token.hash,
      now,
      lock: false,
    });
    if (rowString(invitation, "token_prefix") !== token.prefix) {
      throw new TokenlessServiceError("Invitation not found.", 404, "private_group_invitation_not_found");
    }
    return {
      invitationId: rowString(invitation, "invitation_id"),
      groupId: rowString(invitation, "group_id"),
      groupName: rowString(invitation, "group_name"),
      groupPurpose: rowString(invitation, "group_purpose"),
      workspaceName: rowString(invitation, "workspace_name"),
      role: rowString(invitation, "role"),
      allowedProjectIds: parseJson<string[]>(invitation.allowed_project_ids_json, []),
      expiresAt: rowDate(invitation, "expires_at")?.toISOString() ?? null,
      membershipExpiresAt: rowDate(invitation, "membership_expires_at")?.toISOString() ?? null,
      remainingRedemptions:
        (rowNumber(invitation, "maximum_redemptions") ?? 0) - (rowNumber(invitation, "redemption_count") ?? 0),
    };
  } finally {
    client.release();
  }
}

export async function redeemPrivateGroupInvitation(input: { accountAddress: string; token: string; now?: Date }) {
  const accountAddress = normalizeAddress(input.accountAddress);
  const token = validateInvitationToken(input.token);
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const invitation = await boundInvitation(client, {
      accountAddress,
      token: token.token,
      tokenHash: token.hash,
      now,
      lock: true,
      allowExhausted: true,
    });
    if (rowString(invitation, "token_prefix") !== token.prefix) {
      throw new TokenlessServiceError("Invitation not found.", 404, "private_group_invitation_not_found");
    }
    const invitationId = rowString(invitation, "invitation_id")!;
    const groupId = rowString(invitation, "group_id")!;
    const workspaceId = rowString(invitation, "workspace_id")!;
    const priorRedemption = await client.query(
      `SELECT redeemed_at FROM tokenless_private_group_invitation_redemptions
       WHERE invitation_id = $1 AND principal_address = $2 LIMIT 1`,
      [invitationId, accountAddress],
    );
    if (priorRedemption.rowCount) {
      const active = await client.query(
        `SELECT status, membership_expires_at FROM tokenless_private_group_memberships
         WHERE group_id = $1 AND principal_address = $2 LIMIT 1`,
        [groupId, accountAddress],
      );
      const membership = active.rows[0] as Row | undefined;
      if (
        rowString(membership, "status") === "active" &&
        (!rowDate(membership, "membership_expires_at") || rowDate(membership, "membership_expires_at")! > now)
      ) {
        await client.query("COMMIT");
        return { invitationId, groupId, workspaceId, principalAddress: accountAddress, replay: true };
      }
      throw new TokenlessServiceError(
        "This invitation was already redeemed by this account.",
        409,
        "private_group_invitation_redeemed",
      );
    }
    if ((rowNumber(invitation, "redemption_count") ?? 0) >= (rowNumber(invitation, "maximum_redemptions") ?? 0)) {
      throw new TokenlessServiceError(
        "Invitation is no longer available.",
        410,
        "private_group_invitation_unavailable",
      );
    }
    const existingMembership = await client.query(
      `SELECT status, membership_expires_at FROM tokenless_private_group_memberships
       WHERE group_id = $1 AND principal_address = $2 LIMIT 1 FOR UPDATE`,
      [groupId, accountAddress],
    );
    const existing = existingMembership.rows[0] as Row | undefined;
    if (
      rowString(existing, "status") === "active" &&
      (!rowDate(existing, "membership_expires_at") || rowDate(existing, "membership_expires_at")! > now)
    ) {
      throw new TokenlessServiceError(
        "This account is already a group member.",
        409,
        "private_group_membership_exists",
      );
    }
    const consumed = await client.query(
      `UPDATE tokenless_private_group_invitations
       SET redemption_count = redemption_count + 1, last_used_at = $1
       WHERE invitation_id = $2 AND revoked_at IS NULL AND expires_at > $1
         AND redemption_count < maximum_redemptions`,
      [now, invitationId],
    );
    if (consumed.rowCount !== 1) {
      throw new TokenlessServiceError(
        "Invitation is no longer available.",
        410,
        "private_group_invitation_unavailable",
      );
    }
    await client.query(
      `INSERT INTO tokenless_private_group_memberships
       (group_id, principal_address, role, status, allowed_project_ids_json, source_invitation_id,
        membership_expires_at, joined_at, ended_at, end_reason, created_by, updated_at)
       VALUES ($1,$2,'reviewer','active',$3,$4,$5,$6,NULL,NULL,$7,$6)
       ON CONFLICT (group_id, principal_address) DO UPDATE SET
         role = EXCLUDED.role, status = 'active', allowed_project_ids_json = EXCLUDED.allowed_project_ids_json,
         source_invitation_id = EXCLUDED.source_invitation_id,
         membership_expires_at = EXCLUDED.membership_expires_at, joined_at = EXCLUDED.joined_at,
         ended_at = NULL, end_reason = NULL, created_by = EXCLUDED.created_by, updated_at = EXCLUDED.updated_at`,
      [
        groupId,
        accountAddress,
        rowString(invitation, "allowed_project_ids_json"),
        invitationId,
        rowDate(invitation, "membership_expires_at"),
        now,
        rowString(invitation, "created_by"),
      ],
    );
    await client.query(
      `INSERT INTO tokenless_private_group_invitation_redemptions
       (invitation_id, principal_address, group_id, redeemed_at) VALUES ($1,$2,$3,$4)`,
      [invitationId, accountAddress, groupId, now],
    );
    await appendEvent(client, {
      workspaceId,
      groupId,
      invitationId,
      principalAddress: accountAddress,
      eventType: "invitation_redeemed",
      actorReference: accountAddress,
      details: {},
      now,
    });
    await client.query("COMMIT");
    return { invitationId, groupId, workspaceId, principalAddress: accountAddress, replay: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokePrivateGroupInvitation(input: {
  accountAddress: string;
  workspaceId: string;
  groupId: string;
  invitationId: string;
}) {
  const manager = await requirePrivateGroupManager(input);
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE tokenless_private_group_invitations
       SET revoked_at = $1, revoked_by = $2
       WHERE invitation_id = $3 AND workspace_id = $4 AND group_id = $5 AND revoked_at IS NULL`,
      [now, manager, input.invitationId, input.workspaceId, input.groupId],
    );
    if (result.rowCount !== 1) {
      throw new TokenlessServiceError("Invitation not found.", 404, "private_group_invitation_not_found");
    }
    await client.query(
      `UPDATE tokenless_private_group_invitation_expertise_attestations
       SET status='revoked',revoked_at=$1,revoked_by=$2
       WHERE invitation_id=$3 AND status='pending'`,
      [now, manager, input.invitationId],
    );
    await appendEvent(client, {
      workspaceId: input.workspaceId,
      groupId: input.groupId,
      invitationId: input.invitationId,
      eventType: "invitation_revoked",
      actorReference: manager,
      details: {},
      now,
    });
    await client.query("COMMIT");
    return { revoked: true as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listPrivateGroupMemberships(input: { accountAddress: string; now?: Date }) {
  const accountAddress = normalizeAddress(input.accountAddress);
  const now = input.now ?? new Date();
  const result = await dbClient.execute({
    sql: `SELECT g.group_id, g.name, g.purpose, g.workspace_id, w.name AS workspace_name,
                 m.role, m.status, m.allowed_project_ids_json, m.membership_expires_at,
                 m.joined_at, m.ended_at, m.end_reason,
                 p.policy_hash, p.policy_json
          FROM tokenless_private_group_memberships m
          JOIN tokenless_private_groups g ON g.group_id = m.group_id
          JOIN tokenless_workspaces w ON w.workspace_id = g.workspace_id
          JOIN tokenless_private_group_policy_versions p
            ON p.group_id = g.group_id AND p.version = g.current_policy_version
          WHERE m.principal_address = ?
          ORDER BY m.joined_at DESC`,
    args: [accountAddress],
  });
  return result.rows.map(value => {
    const row = value as Row;
    const expiresAt = rowDate(row, "membership_expires_at");
    const storedStatus = rowString(row, "status")!;
    return {
      groupId: rowString(row, "group_id"),
      groupName: rowString(row, "name"),
      groupPurpose: rowString(row, "purpose"),
      workspaceId: rowString(row, "workspace_id"),
      workspaceName: rowString(row, "workspace_name"),
      role: rowString(row, "role"),
      status: storedStatus === "active" && expiresAt && expiresAt <= now ? "expired" : storedStatus,
      allowedProjectIds: parseJson<string[]>(row.allowed_project_ids_json, []),
      membershipExpiresAt: expiresAt?.toISOString() ?? null,
      joinedAt: rowDate(row, "joined_at")?.toISOString() ?? null,
      endedAt: rowDate(row, "ended_at")?.toISOString() ?? null,
      endReason: rowString(row, "end_reason"),
      policy: parseJson<Record<string, unknown>>(row.policy_json, {}),
      policyHash: rowString(row, "policy_hash"),
    };
  });
}

async function endMembership(input: {
  actorAddress: string;
  principalAddress: string;
  workspaceId: string;
  groupId: string;
  status: "removed" | "left";
  reason: string;
}) {
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const group = await client.query(
      `SELECT group_id FROM tokenless_private_groups
       WHERE group_id = $1 AND workspace_id = $2 AND status = 'active' LIMIT 1`,
      [input.groupId, input.workspaceId],
    );
    if (group.rowCount !== 1) {
      throw new TokenlessServiceError("Private-group membership not found.", 404, "private_group_membership_not_found");
    }
    const result = await client.query(
      `UPDATE tokenless_private_group_memberships
       SET status = $1, ended_at = $2, end_reason = $3, updated_at = $2
       WHERE group_id = $4 AND principal_address = $5 AND status = 'active'`,
      [input.status, now, input.reason, input.groupId, input.principalAddress],
    );
    if (result.rowCount !== 1) {
      throw new TokenlessServiceError("Private-group membership not found.", 404, "private_group_membership_not_found");
    }
    const released = await client.query(
      `UPDATE tokenless_assurance_assignments
       SET status = 'released', lease_state = 'expired', updated_at = $1
       WHERE private_group_id = $2 AND reviewer_account_address = $3 AND status = 'reserved'
       RETURNING subpanel_id, project_id, cohort_id`,
      [now, input.groupId, input.principalAddress],
    );
    for (const value of released.rows) {
      const assignment = value as Row;
      await client.query(
        `UPDATE tokenless_assurance_run_subpanels SET active_reservations = active_reservations - 1
         WHERE subpanel_id = $1 AND active_reservations > 0`,
        [rowString(assignment, "subpanel_id")],
      );
      await client.query(
        `UPDATE tokenless_assurance_cohorts SET active_reservations = active_reservations - 1
         WHERE project_id = $1 AND cohort_id = $2 AND active_reservations > 0`,
        [rowString(assignment, "project_id"), rowString(assignment, "cohort_id")],
      );
      await client.query(
        `UPDATE tokenless_assurance_cohort_reviewers SET active_reservations = active_reservations - 1
         WHERE project_id = $1 AND cohort_id = $2 AND reviewer_account_address = $3
           AND active_reservations > 0`,
        [rowString(assignment, "project_id"), rowString(assignment, "cohort_id"), input.principalAddress],
      );
    }
    await appendEvent(client, {
      workspaceId: input.workspaceId,
      groupId: input.groupId,
      principalAddress: input.principalAddress,
      eventType: input.status === "removed" ? "membership_removed" : "membership_left",
      actorReference: input.actorAddress,
      details: { reason: input.reason, releasedReservationCount: released.rowCount },
      now,
    });
    await client.query("COMMIT");
    return { ended: true as const, status: input.status };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function removePrivateGroupMember(input: {
  accountAddress: string;
  workspaceId: string;
  groupId: string;
  principalAddress: string;
  reason?: string;
}) {
  const manager = await requirePrivateGroupManager(input);
  return endMembership({
    actorAddress: manager,
    principalAddress: normalizeAddress(input.principalAddress, "principalAddress"),
    workspaceId: input.workspaceId,
    groupId: input.groupId,
    status: "removed",
    reason: requiredText(input.reason ?? "removed_by_workspace_manager", "reason", 200),
  });
}

export async function leavePrivateGroup(input: { accountAddress: string; groupId: string; reason?: string }) {
  const membership = await requireActivePrivateGroupMembership(input);
  const accountAddress = normalizeAddress(input.accountAddress);
  return endMembership({
    actorAddress: accountAddress,
    principalAddress: accountAddress,
    workspaceId: membership.workspaceId,
    groupId: input.groupId,
    status: "left",
    reason: requiredText(input.reason ?? "left_by_member", "reason", 200),
  });
}

export function isPrivateGroupPolicyHash(value: string) {
  return HASH_PATTERN.test(value);
}
