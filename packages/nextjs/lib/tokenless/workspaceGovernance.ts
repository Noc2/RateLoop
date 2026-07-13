import { createHash, randomBytes, randomUUID } from "node:crypto";
import "server-only";
import { getAddress } from "viem";
import { dbClient, dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const WORKSPACE_GOVERNANCE_ROLES = ["consultant", "end_client", "decision_owner", "billing"] as const;
export type WorkspaceGovernanceRole = (typeof WORKSPACE_GOVERNANCE_ROLES)[number];

export const WORKSPACE_INVITE_ACCESS_ROLES = ["admin", "member", "billing"] as const;
export type WorkspaceInviteAccessRole = (typeof WORKSPACE_INVITE_ACCESS_ROLES)[number];

export const WORKSPACE_DPA_STATUSES = ["not_started", "pending", "signed", "not_required"] as const;
export type WorkspaceDpaStatus = (typeof WORKSPACE_DPA_STATUSES)[number];

export const WORKSPACE_TRADER_STATUSES = ["unverified", "verified", "not_applicable"] as const;
export type WorkspaceTraderStatus = (typeof WORKSPACE_TRADER_STATUSES)[number];

const GOVERNANCE_ROLE_SET = new Set<string>(WORKSPACE_GOVERNANCE_ROLES);
const INVITE_ACCESS_ROLE_SET = new Set<string>(WORKSPACE_INVITE_ACCESS_ROLES);
const DPA_STATUS_SET = new Set<string>(WORKSPACE_DPA_STATUSES);
const TRADER_STATUS_SET = new Set<string>(WORKSPACE_TRADER_STATUSES);
const INVITE_TOKEN_PATTERN = /^rli_[a-f0-9]{16}_[A-Za-z0-9_-]{40,64}$/;
const COST_CENTER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3_650;
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_INVITE_TTL_MS = 30 * 24 * 60 * 60_000;

type QueryRow = Record<string, unknown>;
type ExistingWorkspaceAccessRole = "owner" | "admin" | "member" | "billing";

export type WorkspaceGovernanceProfile = {
  workspaceId: string;
  defaultRetentionDays: number;
  traderStatus: WorkspaceTraderStatus;
  traderLegalName: string | null;
  traderRegistrationNumber: string | null;
  traderRegisteredAddress: string | null;
  vatCountryCode: string | null;
  vatId: string | null;
};

export type WorkspaceClient = {
  clientId: string;
  workspaceId: string;
  name: string;
  dpaStatus: WorkspaceDpaStatus;
  dpaReference: string | null;
  dpaEffectiveAt: string | null;
  configuredRetentionDays: number | null;
  effectiveRetentionDays: number;
};

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowNumber(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Database returned an invalid ${key}.`);
  return parsed;
}

function rowDate(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`Database returned an invalid ${key}.`);
  return date;
}

function normalizeAddress(value: string, field: string) {
  try {
    return getAddress(value).toLowerCase();
  } catch {
    throw new TokenlessServiceError(`${field} must be a valid Base Account address.`, 400, "invalid_account");
  }
}

function requiredText(value: string, field: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TokenlessServiceError(`${field} must be 1-${maxLength} characters.`, 400, "invalid_governance");
  }
  return normalized;
}

function optionalText(value: string | null | undefined, field: string, maxLength: number) {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new TokenlessServiceError(`${field} must be at most ${maxLength} characters.`, 400, "invalid_governance");
  }
  return normalized;
}

function retentionDays(value: number | null | undefined, field: string) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RETENTION_DAYS) {
    throw new TokenlessServiceError(
      `${field} must be an integer from 1 to ${MAX_RETENTION_DAYS}.`,
      400,
      "invalid_retention",
    );
  }
  return value;
}

function dpaFields(input: {
  dpaStatus: WorkspaceDpaStatus;
  dpaReference?: string | null;
  dpaEffectiveAt?: Date | null;
}) {
  if (!DPA_STATUS_SET.has(input.dpaStatus)) {
    throw new TokenlessServiceError("dpaStatus is unsupported.", 400, "invalid_governance");
  }
  const reference = optionalText(input.dpaReference, "dpaReference", 240);
  const effectiveAt = input.dpaEffectiveAt ?? null;
  if (effectiveAt && Number.isNaN(effectiveAt.getTime())) {
    throw new TokenlessServiceError("dpaEffectiveAt must be a valid date.", 400, "invalid_governance");
  }
  if (input.dpaStatus === "signed" && (!reference || !effectiveAt)) {
    throw new TokenlessServiceError(
      "Signed DPA status requires a reference and effective date.",
      400,
      "invalid_governance",
    );
  }
  return { reference, effectiveAt };
}

async function requireWorkspaceMember(accountAddress: string, workspaceId: string) {
  const address = normalizeAddress(accountAddress, "accountAddress");
  const result = await dbClient.execute({
    sql: `SELECT m.role, g.governance_role
          FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          LEFT JOIN tokenless_workspace_member_governance g
            ON g.workspace_id = m.workspace_id AND g.account_address = m.account_address
          WHERE m.workspace_id = ? AND m.account_address = ? AND w.status = 'active'
          LIMIT 1`,
    args: [workspaceId, address],
  });
  const row = result.rows[0] as QueryRow | undefined;
  const accessRole = rowString(row, "role") as ExistingWorkspaceAccessRole | null;
  if (!accessRole) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
  return {
    accountAddress: address,
    accessRole,
    governanceRole: rowString(row, "governance_role") as WorkspaceGovernanceRole | null,
  };
}

async function requireWorkspaceManagement(accountAddress: string, workspaceId: string) {
  const member = await requireWorkspaceMember(accountAddress, workspaceId);
  if (member.accessRole !== "owner" && member.accessRole !== "admin") {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
  return member;
}

async function requireClientInWorkspace(workspaceId: string, clientId: string) {
  const result = await dbClient.execute({
    sql: `SELECT client_id FROM tokenless_workspace_clients
          WHERE workspace_id = ? AND client_id = ? AND status = 'active' LIMIT 1`,
    args: [workspaceId, clientId],
  });
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError("Client not found.", 404, "client_not_found");
  }
}

function governanceProfileFromRow(row: QueryRow | undefined): WorkspaceGovernanceProfile {
  const workspaceId = rowString(row, "workspace_id");
  const defaultDays = rowNumber(row, "default_retention_days");
  const traderStatus = rowString(row, "trader_status") as WorkspaceTraderStatus | null;
  if (!workspaceId || defaultDays === null || !traderStatus) {
    throw new Error("Database returned an invalid workspace governance profile.");
  }
  return {
    workspaceId,
    defaultRetentionDays: defaultDays,
    traderStatus,
    traderLegalName: rowString(row, "trader_legal_name"),
    traderRegistrationNumber: rowString(row, "trader_registration_number"),
    traderRegisteredAddress: rowString(row, "trader_registered_address"),
    vatCountryCode: rowString(row, "vat_country_code"),
    vatId: rowString(row, "vat_id"),
  };
}

function clientFromRow(row: QueryRow): WorkspaceClient {
  const clientId = rowString(row, "client_id");
  const workspaceId = rowString(row, "workspace_id");
  const name = rowString(row, "name");
  const dpaStatus = rowString(row, "dpa_status") as WorkspaceDpaStatus | null;
  const effectiveRetentionDays = rowNumber(row, "effective_retention_days");
  if (!clientId || !workspaceId || !name || !dpaStatus || effectiveRetentionDays === null) {
    throw new Error("Database returned an invalid workspace client.");
  }
  return {
    clientId,
    workspaceId,
    name,
    dpaStatus,
    dpaReference: rowString(row, "dpa_reference"),
    dpaEffectiveAt: rowDate(row, "dpa_effective_at")?.toISOString() ?? null,
    configuredRetentionDays: rowNumber(row, "retention_days"),
    effectiveRetentionDays,
  };
}

async function ensureGovernanceDefaults(workspaceId: string, updatedBy: string) {
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_governance
          (workspace_id, default_retention_days, trader_status, updated_by, created_at, updated_at)
          VALUES (?, ?, 'unverified', ?, ?, ?)
          ON CONFLICT (workspace_id) DO NOTHING`,
    args: [workspaceId, DEFAULT_RETENTION_DAYS, updatedBy, now, now],
  });
}

export async function updateWorkspaceGovernance(input: {
  accountAddress: string;
  workspaceId: string;
  defaultRetentionDays: number;
  traderStatus: WorkspaceTraderStatus;
  traderLegalName?: string | null;
  traderRegistrationNumber?: string | null;
  traderRegisteredAddress?: string | null;
  vatCountryCode?: string | null;
  vatId?: string | null;
}): Promise<WorkspaceGovernanceProfile> {
  const manager = await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  const defaultDays = retentionDays(input.defaultRetentionDays, "defaultRetentionDays");
  if (defaultDays === null || !TRADER_STATUS_SET.has(input.traderStatus)) {
    throw new TokenlessServiceError("Workspace governance settings are invalid.", 400, "invalid_governance");
  }
  const traderLegalName = optionalText(input.traderLegalName, "traderLegalName", 200);
  const traderRegistrationNumber = optionalText(input.traderRegistrationNumber, "traderRegistrationNumber", 120);
  const traderRegisteredAddress = optionalText(input.traderRegisteredAddress, "traderRegisteredAddress", 500);
  const vatCountryCode = optionalText(input.vatCountryCode, "vatCountryCode", 2)?.toUpperCase() ?? null;
  const vatId = optionalText(input.vatId, "vatId", 64);
  if ((vatCountryCode === null) !== (vatId === null) || (vatCountryCode && !/^[A-Z]{2}$/.test(vatCountryCode))) {
    throw new TokenlessServiceError(
      "VAT country code and VAT ID must be supplied together.",
      400,
      "invalid_governance",
    );
  }
  if (input.traderStatus === "verified" && (!traderLegalName || !traderRegisteredAddress)) {
    throw new TokenlessServiceError(
      "Verified trader status requires a legal name and registered address.",
      400,
      "invalid_governance",
    );
  }
  const now = new Date();
  const result = await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_governance
          (workspace_id, default_retention_days, trader_status, trader_legal_name,
           trader_registration_number, trader_registered_address, vat_country_code, vat_id,
           updated_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (workspace_id) DO UPDATE SET
            default_retention_days = EXCLUDED.default_retention_days,
            trader_status = EXCLUDED.trader_status,
            trader_legal_name = EXCLUDED.trader_legal_name,
            trader_registration_number = EXCLUDED.trader_registration_number,
            trader_registered_address = EXCLUDED.trader_registered_address,
            vat_country_code = EXCLUDED.vat_country_code,
            vat_id = EXCLUDED.vat_id,
            updated_by = EXCLUDED.updated_by,
            updated_at = EXCLUDED.updated_at
          RETURNING *`,
    args: [
      input.workspaceId,
      defaultDays,
      input.traderStatus,
      traderLegalName,
      traderRegistrationNumber,
      traderRegisteredAddress,
      vatCountryCode,
      vatId,
      manager.accountAddress,
      now,
      now,
    ],
  });
  return governanceProfileFromRow(result.rows[0] as QueryRow | undefined);
}

export async function getWorkspaceGovernance(input: {
  accountAddress: string;
  workspaceId: string;
}): Promise<WorkspaceGovernanceProfile> {
  await requireWorkspaceMember(input.accountAddress, input.workspaceId);
  const result = await dbClient.execute({
    sql: `SELECT w.workspace_id,
                 COALESCE(g.default_retention_days, ?) AS default_retention_days,
                 COALESCE(g.trader_status, 'unverified') AS trader_status,
                 g.trader_legal_name, g.trader_registration_number, g.trader_registered_address,
                 g.vat_country_code, g.vat_id
          FROM tokenless_workspaces w
          LEFT JOIN tokenless_workspace_governance g ON g.workspace_id = w.workspace_id
          WHERE w.workspace_id = ? AND w.status = 'active' LIMIT 1`,
    args: [DEFAULT_RETENTION_DAYS, input.workspaceId],
  });
  return governanceProfileFromRow(result.rows[0] as QueryRow | undefined);
}

export async function createWorkspaceClient(input: {
  accountAddress: string;
  workspaceId: string;
  name: string;
  dpaStatus: WorkspaceDpaStatus;
  dpaReference?: string | null;
  dpaEffectiveAt?: Date | null;
  retentionDays?: number | null;
}): Promise<WorkspaceClient> {
  const manager = await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  const name = requiredText(input.name, "name", 160);
  const dpa = dpaFields(input);
  const configuredRetentionDays = retentionDays(input.retentionDays, "retentionDays");
  await ensureGovernanceDefaults(input.workspaceId, manager.accountAddress);
  const clientId = `wcl_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_clients
          (client_id, workspace_id, name, status, dpa_status, dpa_reference, dpa_effective_at,
           retention_days, created_by, created_at, updated_at)
          VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      clientId,
      input.workspaceId,
      name,
      input.dpaStatus,
      dpa.reference,
      dpa.effectiveAt,
      configuredRetentionDays,
      manager.accountAddress,
      now,
      now,
    ],
  });
  return getAccessibleWorkspaceClient({
    accountAddress: manager.accountAddress,
    workspaceId: input.workspaceId,
    clientId,
  });
}

export async function updateWorkspaceClientGovernance(input: {
  accountAddress: string;
  workspaceId: string;
  clientId: string;
  name: string;
  dpaStatus: WorkspaceDpaStatus;
  dpaReference?: string | null;
  dpaEffectiveAt?: Date | null;
  retentionDays?: number | null;
}): Promise<WorkspaceClient> {
  const manager = await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  await requireClientInWorkspace(input.workspaceId, input.clientId);
  const name = requiredText(input.name, "name", 160);
  const dpa = dpaFields(input);
  const configuredRetentionDays = retentionDays(input.retentionDays, "retentionDays");
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_clients
          SET name = ?, dpa_status = ?, dpa_reference = ?, dpa_effective_at = ?, retention_days = ?, updated_at = ?
          WHERE workspace_id = ? AND client_id = ? AND status = 'active'`,
    args: [
      name,
      input.dpaStatus,
      dpa.reference,
      dpa.effectiveAt,
      configuredRetentionDays,
      new Date(),
      input.workspaceId,
      input.clientId,
    ],
  });
  return getAccessibleWorkspaceClient({
    accountAddress: manager.accountAddress,
    workspaceId: input.workspaceId,
    clientId: input.clientId,
  });
}

export async function createWorkspaceMemberInvite(input: {
  accountAddress: string;
  workspaceId: string;
  clientId?: string | null;
  accessRole: WorkspaceInviteAccessRole;
  governanceRole: WorkspaceGovernanceRole;
  intendedAccountAddress?: string | null;
  expiresAt?: Date;
}) {
  const manager = await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  if (!INVITE_ACCESS_ROLE_SET.has(input.accessRole) || !GOVERNANCE_ROLE_SET.has(input.governanceRole)) {
    throw new TokenlessServiceError("Invitation role is unsupported.", 400, "invalid_invite");
  }
  if ((input.accessRole === "billing") !== (input.governanceRole === "billing")) {
    throw new TokenlessServiceError(
      "Billing access and billing governance roles must be assigned together.",
      400,
      "invalid_invite",
    );
  }
  const clientId = input.clientId ?? null;
  if (clientId) {
    await requireClientInWorkspace(input.workspaceId, clientId);
  } else if (input.accessRole !== "admin") {
    throw new TokenlessServiceError("Non-admin invitations must be bound to one client.", 400, "invalid_invite");
  }
  const intendedAccountAddress = input.intendedAccountAddress
    ? normalizeAddress(input.intendedAccountAddress, "intendedAccountAddress")
    : null;
  const now = new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + INVITE_TTL_MS);
  const ttl = expiresAt.getTime() - now.getTime();
  if (Number.isNaN(expiresAt.getTime()) || ttl < 60_000 || ttl > MAX_INVITE_TTL_MS) {
    throw new TokenlessServiceError("Invitation expiry must be between one minute and 30 days.", 400, "invalid_invite");
  }
  const inviteIdPart = randomBytes(8).toString("hex");
  const inviteId = `win_${inviteIdPart}`;
  const token = `rli_${inviteIdPart}_${randomBytes(32).toString("base64url")}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_member_invites
          (invite_id, workspace_id, client_id, invite_token_hash, intended_account_address,
           access_role, governance_role, expires_at, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      inviteId,
      input.workspaceId,
      clientId,
      hashToken(token),
      intendedAccountAddress,
      input.accessRole,
      input.governanceRole,
      expiresAt,
      manager.accountAddress,
      now,
    ],
  });
  return { inviteId, token, expiresAt: expiresAt.toISOString() };
}

const ACCESS_ROLE_RANK: Record<ExistingWorkspaceAccessRole, number> = {
  billing: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export async function redeemWorkspaceMemberInviteWithBaseAccount(input: { token: string; baseAccountAddress: string }) {
  const accountAddress = normalizeAddress(input.baseAccountAddress, "baseAccountAddress");
  if (!INVITE_TOKEN_PATTERN.test(input.token)) {
    throw new TokenlessServiceError("Invitation not found.", 404, "invite_not_found");
  }
  const tokenHash = hashToken(input.token);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT i.*, w.status AS workspace_status
       FROM tokenless_workspace_member_invites i
       JOIN tokenless_workspaces w ON w.workspace_id = i.workspace_id
       WHERE i.invite_token_hash = $1
       LIMIT 1 FOR UPDATE`,
      [tokenHash],
    );
    const row = result.rows[0] as QueryRow | undefined;
    const inviteId = rowString(row, "invite_id");
    const workspaceId = rowString(row, "workspace_id");
    const clientId = rowString(row, "client_id");
    const intendedAccountAddress = rowString(row, "intended_account_address");
    const accessRole = rowString(row, "access_role") as WorkspaceInviteAccessRole | null;
    const governanceRole = rowString(row, "governance_role") as WorkspaceGovernanceRole | null;
    const expiresAt = rowDate(row, "expires_at");
    if (!inviteId || !workspaceId || !accessRole || !governanceRole || !expiresAt) {
      throw new TokenlessServiceError("Invitation not found.", 404, "invite_not_found");
    }
    if (
      rowString(row, "workspace_status") !== "active" ||
      rowDate(row, "redeemed_at") ||
      rowDate(row, "revoked_at") ||
      expiresAt.getTime() <= Date.now()
    ) {
      throw new TokenlessServiceError("Invitation is no longer available.", 410, "invite_unavailable");
    }
    if (intendedAccountAddress && intendedAccountAddress !== accountAddress) {
      throw new TokenlessServiceError(
        "Invitation is bound to a different Base Account.",
        403,
        "invite_account_mismatch",
      );
    }

    const existingMember = await client.query(
      `SELECT role FROM tokenless_workspace_members
       WHERE workspace_id = $1 AND account_address = $2 LIMIT 1 FOR UPDATE`,
      [workspaceId, accountAddress],
    );
    const existingRole = rowString(
      existingMember.rows[0] as QueryRow | undefined,
      "role",
    ) as ExistingWorkspaceAccessRole | null;
    if (!existingRole) {
      await client.query(
        `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
         VALUES ($1, $2, $3, $4)`,
        [workspaceId, accountAddress, accessRole, new Date()],
      );
    } else if (ACCESS_ROLE_RANK[accessRole] > ACCESS_ROLE_RANK[existingRole]) {
      await client.query(
        `UPDATE tokenless_workspace_members SET role = $1
         WHERE workspace_id = $2 AND account_address = $3`,
        [accessRole, workspaceId, accountAddress],
      );
    }

    const existingGovernance = await client.query(
      `SELECT governance_role FROM tokenless_workspace_member_governance
       WHERE workspace_id = $1 AND account_address = $2 LIMIT 1 FOR UPDATE`,
      [workspaceId, accountAddress],
    );
    const existingGovernanceRole = rowString(existingGovernance.rows[0] as QueryRow | undefined, "governance_role");
    if (existingGovernanceRole && existingGovernanceRole !== governanceRole) {
      throw new TokenlessServiceError(
        "Existing workspace membership has a different governance role.",
        409,
        "membership_role_conflict",
      );
    }
    const now = new Date();
    await client.query(
      `INSERT INTO tokenless_workspace_member_governance
       (workspace_id, account_address, governance_role, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (workspace_id, account_address) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
      [workspaceId, accountAddress, governanceRole, rowString(row, "created_by"), now],
    );
    if (clientId) {
      await client.query(
        `INSERT INTO tokenless_workspace_member_clients
         (workspace_id, client_id, account_address, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (workspace_id, client_id, account_address) DO NOTHING`,
        [workspaceId, clientId, accountAddress, rowString(row, "created_by"), now],
      );
    }
    const redeemed = await client.query(
      `UPDATE tokenless_workspace_member_invites
       SET redeemed_at = $1, redeemed_by_account_address = $2
       WHERE invite_id = $3 AND redeemed_at IS NULL AND revoked_at IS NULL`,
      [now, accountAddress, inviteId],
    );
    if (redeemed.rowCount !== 1) {
      throw new TokenlessServiceError("Invitation is no longer available.", 410, "invite_unavailable");
    }
    await client.query("COMMIT");
    return { workspaceId, clientId, accessRole, governanceRole, accountAddress };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listWorkspaceMembers(input: { accountAddress: string; workspaceId: string }) {
  await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  const [members, assignments] = await Promise.all([
    dbClient.execute({
      sql: `SELECT m.account_address, m.role, g.governance_role
            FROM tokenless_workspace_members m
            LEFT JOIN tokenless_workspace_member_governance g
              ON g.workspace_id = m.workspace_id AND g.account_address = m.account_address
            WHERE m.workspace_id = ? ORDER BY m.created_at ASC`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT account_address, client_id FROM tokenless_workspace_member_clients
            WHERE workspace_id = ? ORDER BY created_at ASC`,
      args: [input.workspaceId],
    }),
  ]);
  const clientIdsByAccount = new Map<string, string[]>();
  for (const value of assignments.rows) {
    const row = value as QueryRow;
    const accountAddress = rowString(row, "account_address");
    const clientId = rowString(row, "client_id");
    if (!accountAddress || !clientId) continue;
    clientIdsByAccount.set(accountAddress, [...(clientIdsByAccount.get(accountAddress) ?? []), clientId]);
  }
  return members.rows.map(value => {
    const row = value as QueryRow;
    const accountAddress = rowString(row, "account_address");
    if (!accountAddress) throw new Error("Database returned an invalid workspace member.");
    return {
      accountAddress,
      accessRole: rowString(row, "role") as ExistingWorkspaceAccessRole,
      governanceRole: rowString(row, "governance_role") as WorkspaceGovernanceRole | null,
      clientIds: clientIdsByAccount.get(accountAddress) ?? [],
    };
  });
}

export async function listAccessibleWorkspaceClients(input: {
  accountAddress: string;
  workspaceId: string;
}): Promise<WorkspaceClient[]> {
  const member = await requireWorkspaceMember(input.accountAddress, input.workspaceId);
  const management = member.accessRole === "owner" || member.accessRole === "admin";
  const result = await dbClient.execute({
    sql: `SELECT c.client_id, c.workspace_id, c.name, c.dpa_status, c.dpa_reference, c.dpa_effective_at,
                 c.retention_days,
                 COALESCE(c.retention_days, g.default_retention_days, ?) AS effective_retention_days
          FROM tokenless_workspace_clients c
          LEFT JOIN tokenless_workspace_governance g ON g.workspace_id = c.workspace_id
          ${
            management
              ? ""
              : `JOIN tokenless_workspace_member_clients mc
                   ON mc.workspace_id = c.workspace_id AND mc.client_id = c.client_id
                  AND mc.account_address = ?`
          }
          WHERE c.workspace_id = ? AND c.status = 'active'
          ORDER BY c.name ASC`,
    args: management
      ? [DEFAULT_RETENTION_DAYS, input.workspaceId]
      : [DEFAULT_RETENTION_DAYS, member.accountAddress, input.workspaceId],
  });
  return result.rows.map(value => clientFromRow(value as QueryRow));
}

export async function getAccessibleWorkspaceClient(input: {
  accountAddress: string;
  workspaceId: string;
  clientId: string;
}): Promise<WorkspaceClient> {
  const clients = await listAccessibleWorkspaceClients(input);
  const client = clients.find(value => value.clientId === input.clientId);
  if (!client) throw new TokenlessServiceError("Client not found.", 404, "client_not_found");
  return client;
}

export async function createWorkspaceCostCenter(input: {
  accountAddress: string;
  workspaceId: string;
  clientId: string;
  code: string;
  name: string;
}) {
  const manager = await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  await requireClientInWorkspace(input.workspaceId, input.clientId);
  const code = input.code.trim().toUpperCase();
  if (!COST_CENTER_CODE_PATTERN.test(code)) {
    throw new TokenlessServiceError("Cost-center code is invalid.", 400, "invalid_cost_center");
  }
  const name = requiredText(input.name, "name", 160);
  const existing = await dbClient.execute({
    sql: "SELECT cost_center_id FROM tokenless_workspace_cost_centers WHERE workspace_id = ? AND code = ? LIMIT 1",
    args: [input.workspaceId, code],
  });
  if (existing.rowCount) {
    throw new TokenlessServiceError("Cost-center code already exists.", 409, "cost_center_conflict");
  }
  const costCenterId = `wcc_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_cost_centers
          (cost_center_id, workspace_id, client_id, code, name, status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    args: [costCenterId, input.workspaceId, input.clientId, code, name, manager.accountAddress, now, now],
  });
  return { costCenterId, workspaceId: input.workspaceId, clientId: input.clientId, code, name };
}

export async function listAccessibleWorkspaceCostCenters(input: {
  accountAddress: string;
  workspaceId: string;
  clientId: string;
}) {
  await getAccessibleWorkspaceClient(input);
  const result = await dbClient.execute({
    sql: `SELECT cost_center_id, workspace_id, client_id, code, name
          FROM tokenless_workspace_cost_centers
          WHERE workspace_id = ? AND client_id = ? AND status = 'active'
          ORDER BY code ASC`,
    args: [input.workspaceId, input.clientId],
  });
  return result.rows.map(value => {
    const row = value as QueryRow;
    return {
      costCenterId: rowString(row, "cost_center_id"),
      workspaceId: rowString(row, "workspace_id"),
      clientId: rowString(row, "client_id"),
      code: rowString(row, "code"),
      name: rowString(row, "name"),
    };
  });
}
