import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const INVITATION_PATTERN = /^rlri_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/u;
const EMAIL_PATTERN = /^[^\s@]+@([^\s@]+)$/u;
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const DEFAULT_INVITATION_TTL_MS = 7 * 86_400_000;
const MAX_INVITATION_TTL_MS = 30 * 86_400_000;
const MAX_ACCESS_TTL_MS = 2 * 365 * 86_400_000;
const SENSITIVITIES = ["internal", "confidential", "restricted", "regulated"] as const;

type Row = Record<string, unknown>;
type Sensitivity = (typeof SENSITIVITIES)[number];

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function count(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function date(row: Row | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Database returned an invalid ${key}.`);
  return parsed;
}

function boolean(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === true || value === "t" || value === 1;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
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

function hashJson(value: unknown) {
  return `sha256:${digest(canonicalJson(value))}`;
}

function normalizePrincipal(value: string, field = "accountAddress") {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError(`${field} must be a valid account.`, 400, "invalid_workspace_reviewer");
  }
}

function normalizeEmail(value: string) {
  const normalized = value.trim().toLowerCase();
  const match = EMAIL_PATTERN.exec(normalized);
  if (!match || normalized.length > 320 || !DOMAIN_PATTERN.test(match[1]!)) {
    throw new TokenlessServiceError("Reviewer email is invalid.", 400, "invalid_workspace_reviewer");
  }
  return normalized;
}

function normalizeDomain(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!DOMAIN_PATTERN.test(normalized)) {
    throw new TokenlessServiceError("Reviewer email domain is invalid.", 400, "invalid_workspace_reviewer");
  }
  return normalized;
}

function sensitivity(value: string): Sensitivity {
  if (!SENSITIVITIES.includes(value as Sensitivity)) {
    throw new TokenlessServiceError("Private-material sensitivity is unsupported.", 400, "invalid_workspace_reviewer");
  }
  return value as Sensitivity;
}

function projectIds(values: string[] | undefined) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 100 || values.some(value => typeof value !== "string")) {
    throw new TokenlessServiceError(
      "projectIds must contain at most 100 project IDs.",
      400,
      "invalid_workspace_reviewer",
    );
  }
  const normalized = [...new Set(values.map(value => value.trim()).filter(Boolean))].sort();
  if (normalized.some(value => value.length > 160)) {
    throw new TokenlessServiceError("A project ID is too long.", 400, "invalid_workspace_reviewer");
  }
  return normalized;
}

function integer(value: number, field: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TokenlessServiceError(`${field} must be ${minimum}-${maximum}.`, 400, "invalid_workspace_reviewer");
  }
  return value;
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

async function requireManager(accountAddress: string, workspaceId: string) {
  const manager = normalizePrincipal(accountAddress);
  const result = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id
          WHERE m.workspace_id=? AND m.account_address=? AND m.role IN ('owner','admin')
            AND w.status='active' LIMIT 1`,
    args: [workspaceId, manager],
  });
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError("Workspace reviewers were not found.", 404, "workspace_reviewers_not_found");
  }
  return manager;
}

async function requireManagerInTransaction(client: PoolClient, accountAddress: string, workspaceId: string) {
  const manager = normalizePrincipal(accountAddress);
  const result = await client.query(
    `SELECT 1 FROM tokenless_workspace_members m
     JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id
     WHERE m.workspace_id=$1 AND m.account_address=$2 AND m.role IN ('owner','admin')
       AND w.status='active' LIMIT 1 FOR SHARE`,
    [workspaceId, manager],
  );
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError("Workspace reviewers were not found.", 404, "workspace_reviewers_not_found");
  }
  return manager;
}

async function appendEvent(
  client: PoolClient,
  input: {
    workspaceId: string;
    principalAddress?: string | null;
    invitationId?: string | null;
    grantId?: string | null;
    eventType:
      | "invitation_created"
      | "invitation_redeemed"
      | "invitation_revoked"
      | "reviewer_removed"
      | "reviewer_left"
      | "grant_revoked"
      | "terms_version_created"
      | "terms_accepted";
    actorReference: string;
    details?: Record<string, unknown>;
    now: Date;
  },
) {
  await client.query(
    `INSERT INTO tokenless_workspace_reviewer_events
     (event_id,workspace_id,principal_address,invitation_id,grant_id,event_type,
      actor_reference,details_json,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      `wre_${randomUUID().replaceAll("-", "")}`,
      input.workspaceId,
      input.principalAddress ?? null,
      input.invitationId ?? null,
      input.grantId ?? null,
      input.eventType,
      input.actorReference,
      JSON.stringify(input.details ?? {}),
      input.now,
    ],
  );
}

export async function listWorkspaceReviewers(input: { accountAddress: string; workspaceId: string; now?: Date }) {
  await requireManager(input.accountAddress, input.workspaceId);
  const now = input.now ?? new Date();
  const [reviewerResult, grantResult, projectResult] = await Promise.all([
    dbClient.execute({
      sql: `SELECT workspace_id,principal_address,status,activated_at,ended_at,end_reason,updated_at
            FROM tokenless_workspace_reviewers WHERE workspace_id=?
            ORDER BY activated_at ASC,principal_address ASC`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT grant_id,principal_address,project_scope,max_private_sensitivity,valid_from,valid_until,
                   grant_hash,revoked_at
            FROM tokenless_workspace_reviewer_access_grants WHERE workspace_id=?
            ORDER BY created_at ASC,grant_id ASC`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT grant_id,project_id FROM tokenless_workspace_reviewer_access_grant_projects
            WHERE workspace_id=? ORDER BY grant_id,project_id`,
      args: [input.workspaceId],
    }),
  ]);
  const projectsByGrant = new Map<string, string[]>();
  for (const value of projectResult.rows) {
    const row = value as Row;
    const grantId = text(row, "grant_id")!;
    projectsByGrant.set(grantId, [...(projectsByGrant.get(grantId) ?? []), text(row, "project_id")!]);
  }
  const grantsByReviewer = new Map<string, Array<Record<string, unknown>>>();
  for (const value of grantResult.rows) {
    const row = value as Row;
    const principalAddress = text(row, "principal_address")!;
    const revokedAt = date(row, "revoked_at");
    const validUntil = date(row, "valid_until");
    const grantId = text(row, "grant_id")!;
    const status = revokedAt ? "revoked" : validUntil && validUntil <= now ? "expired" : "active";
    grantsByReviewer.set(principalAddress, [
      ...(grantsByReviewer.get(principalAddress) ?? []),
      {
        grantId,
        projectScope: text(row, "project_scope"),
        projectIds: projectsByGrant.get(grantId) ?? [],
        maxPrivateSensitivity: text(row, "max_private_sensitivity"),
        validFrom: iso(date(row, "valid_from")),
        validUntil: iso(validUntil),
        grantHash: text(row, "grant_hash"),
        status,
      },
    ]);
  }
  return reviewerResult.rows.map(value => {
    const row = value as Row;
    const principalAddress = text(row, "principal_address")!;
    return {
      workspaceId: text(row, "workspace_id"),
      principalAddress,
      status: text(row, "status"),
      activatedAt: iso(date(row, "activated_at")),
      endedAt: iso(date(row, "ended_at")),
      endReason: text(row, "end_reason"),
      updatedAt: iso(date(row, "updated_at")),
      grants: grantsByReviewer.get(principalAddress) ?? [],
    };
  });
}

export async function listWorkspaceReviewerInvitations(input: { accountAddress: string; workspaceId: string }) {
  await requireManager(input.accountAddress, input.workspaceId);
  const result = await dbClient.execute({
    sql: `SELECT invitation_id,token_prefix,intended_account_address,intended_email_hash,
                 intended_email_domain,access_expires_at,expires_at,maximum_redemptions,
                 redemption_count,revoked_at,created_at
          FROM tokenless_workspace_reviewer_invitations WHERE workspace_id=?
          ORDER BY created_at DESC,invitation_id DESC`,
    args: [input.workspaceId],
  });
  return result.rows.map(value => {
    const row = value as Row;
    return {
      invitationId: text(row, "invitation_id"),
      tokenPrefix: text(row, "token_prefix"),
      hasAccountBinding: text(row, "intended_account_address") !== null,
      hasEmailBinding: text(row, "intended_email_hash") !== null,
      intendedEmailDomain: text(row, "intended_email_domain"),
      accessExpiresAt: iso(date(row, "access_expires_at")),
      expiresAt: iso(date(row, "expires_at")),
      maximumRedemptions: count(row, "maximum_redemptions"),
      redemptionCount: count(row, "redemption_count"),
      revokedAt: iso(date(row, "revoked_at")),
      createdAt: iso(date(row, "created_at")),
    };
  });
}

export async function listMyWorkspaceReviewerAccess(input: { accountAddress: string; now?: Date }) {
  const principalAddress = normalizePrincipal(input.accountAddress);
  const now = input.now ?? new Date();
  const [reviewerResult, grantResult] = await Promise.all([
    dbClient.execute({
      sql: `SELECT r.workspace_id,w.name AS workspace_name,r.status,r.activated_at,r.ended_at,r.end_reason
            FROM tokenless_workspace_reviewers r
            JOIN tokenless_workspaces w ON w.workspace_id=r.workspace_id
            WHERE r.principal_address=?
            ORDER BY r.activated_at ASC,r.workspace_id ASC`,
      args: [principalAddress],
    }),
    dbClient.execute({
      sql: `SELECT workspace_id,grant_id,max_private_sensitivity,valid_until,revoked_at
            FROM tokenless_workspace_reviewer_access_grants
            WHERE principal_address=?
            ORDER BY created_at ASC,grant_id ASC`,
      args: [principalAddress],
    }),
  ]);
  const grantsByWorkspace = new Map<string, Array<Record<string, unknown>>>();
  for (const value of grantResult.rows) {
    const row = value as Row;
    const workspaceId = text(row, "workspace_id")!;
    const validUntil = date(row, "valid_until");
    const revokedAt = date(row, "revoked_at");
    grantsByWorkspace.set(workspaceId, [
      ...(grantsByWorkspace.get(workspaceId) ?? []),
      {
        grantId: text(row, "grant_id"),
        maxPrivateSensitivity: text(row, "max_private_sensitivity"),
        validUntil: iso(validUntil),
        status: revokedAt ? "revoked" : validUntil && validUntil <= now ? "expired" : "active",
      },
    ]);
  }
  return reviewerResult.rows.map(value => {
    const row = value as Row;
    const workspaceId = text(row, "workspace_id")!;
    return {
      workspaceId,
      workspaceName: text(row, "workspace_name"),
      status: text(row, "status"),
      activatedAt: iso(date(row, "activated_at")),
      endedAt: iso(date(row, "ended_at")),
      endReason: text(row, "end_reason"),
      grants: grantsByWorkspace.get(workspaceId) ?? [],
    };
  });
}

type WorkspaceReviewerInvitationCreateInput = {
  workspaceId: string;
  projectIds?: string[];
  maxPrivateSensitivity: Sensitivity;
  intendedAccountAddress?: string | null;
  intendedEmail?: string | null;
  intendedEmailDomain?: string | null;
  expiresAt?: Date;
  accessExpiresAt?: Date | null;
  maximumRedemptions?: number;
  now?: Date;
};

export async function createWorkspaceReviewerInvitationInTransaction(
  client: PoolClient,
  input: WorkspaceReviewerInvitationCreateInput & { actorAddress: string; token?: string },
) {
  const projects = projectIds(input.projectIds);
  const ceiling = sensitivity(input.maxPrivateSensitivity);
  const intendedAccount = input.intendedAccountAddress
    ? normalizePrincipal(input.intendedAccountAddress, "intendedAccountAddress")
    : null;
  const intendedEmail = input.intendedEmail ? normalizeEmail(input.intendedEmail) : null;
  const intendedDomain = input.intendedEmailDomain ? normalizeDomain(input.intendedEmailDomain) : null;
  if ([intendedAccount, intendedEmail, intendedDomain].filter(Boolean).length > 1) {
    throw new TokenlessServiceError(
      "Bind a reviewer invitation to an account, email, or domain, not more than one.",
      400,
      "invalid_workspace_reviewer",
    );
  }
  const maximumRedemptions = integer(input.maximumRedemptions ?? 1, "maximumRedemptions", 1, 1000);
  if ((intendedAccount || intendedEmail) && maximumRedemptions !== 1) {
    throw new TokenlessServiceError(
      "Account- and email-bound reviewer invitations can be used once.",
      400,
      "invalid_workspace_reviewer",
    );
  }
  const now = input.now ?? new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + DEFAULT_INVITATION_TTL_MS);
  const invitationTtl = expiresAt.getTime() - now.getTime();
  if (!Number.isFinite(expiresAt.getTime()) || invitationTtl < 60_000 || invitationTtl > MAX_INVITATION_TTL_MS) {
    throw new TokenlessServiceError(
      "Reviewer invitation expiry must be between one minute and 30 days.",
      400,
      "invalid_workspace_reviewer",
    );
  }
  const accessExpiresAt = input.accessExpiresAt ?? null;
  if (
    accessExpiresAt &&
    (!Number.isFinite(accessExpiresAt.getTime()) ||
      accessExpiresAt <= expiresAt ||
      accessExpiresAt.getTime() - now.getTime() > MAX_ACCESS_TTL_MS)
  ) {
    throw new TokenlessServiceError(
      "Reviewer access must extend beyond the invitation expiry and stay within two years.",
      400,
      "invalid_workspace_reviewer",
    );
  }
  const tokenCandidate =
    input.token ?? `rlri_${randomBytes(8).toString("hex")}_${randomBytes(32).toString("base64url")}`;
  const tokenMatch = INVITATION_PATTERN.exec(tokenCandidate);
  if (!tokenMatch) {
    throw new TokenlessServiceError("Reviewer invitation token is invalid.", 400, "invalid_workspace_reviewer");
  }
  const suffix = tokenMatch[1]!;
  const invitationId = `wri_${suffix}`;
  const token = tokenCandidate;
  const manager = await requireManagerInTransaction(client, input.actorAddress, input.workspaceId);
  if (projects.length) {
    const projectPlaceholders = projects.map((_, index) => `$${index + 2}`).join(",");
    const existing = await client.query(
      `SELECT project_id FROM tokenless_assurance_projects
       WHERE workspace_id=$1 AND project_id IN (${projectPlaceholders}) AND status='active'`,
      [input.workspaceId, ...projects],
    );
    if (existing.rowCount !== projects.length) {
      throw new TokenlessServiceError("A reviewer project was not found.", 404, "workspace_reviewers_not_found");
    }
  }
  await client.query(
    `INSERT INTO tokenless_workspace_reviewer_invitations
     (invitation_id,workspace_id,token_hash,token_prefix,project_scope,max_private_sensitivity,
      intended_account_address,intended_email_hash,intended_email_domain,access_expires_at,expires_at,
      maximum_redemptions,redemption_count,created_by,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13,$14)`,
    [
      invitationId,
      input.workspaceId,
      digest(token),
      suffix,
      projects.length ? "selected" : "all",
      ceiling,
      intendedAccount,
      intendedEmail ? digest(`${token}\0${intendedEmail}`) : null,
      intendedDomain,
      accessExpiresAt,
      expiresAt,
      maximumRedemptions,
      manager,
      now,
    ],
  );
  for (const projectId of projects) {
    await client.query(
      `INSERT INTO tokenless_workspace_reviewer_invitation_projects
       (invitation_id,workspace_id,project_id) VALUES ($1,$2,$3)`,
      [invitationId, input.workspaceId, projectId],
    );
  }
  await appendEvent(client, {
    workspaceId: input.workspaceId,
    invitationId,
    eventType: "invitation_created",
    actorReference: manager,
    details: {
      projectScope: projects.length ? "selected" : "all",
      projectCount: projects.length,
      maxPrivateSensitivity: ceiling,
      maximumRedemptions,
      accountBound: intendedAccount !== null,
      contactBound: intendedEmail !== null,
      domainBound: intendedDomain !== null,
    },
    now,
  });
  return {
    invitationId,
    token,
    tokenPrefix: suffix,
    accessExpiresAt: iso(accessExpiresAt),
    expiresAt: expiresAt.toISOString(),
    maximumRedemptions,
  };
}

export async function createWorkspaceReviewerInvitation(
  input: WorkspaceReviewerInvitationCreateInput & { accountAddress: string },
) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const invitation = await createWorkspaceReviewerInvitationInTransaction(client, {
      ...input,
      actorAddress: input.accountAddress,
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

async function verifiedEmail(client: PoolClient, principalAddress: string) {
  const result = await client.query(
    `SELECT u.email,u.email_verified
     FROM tokenless_identity_bindings b
     JOIN tokenless_better_auth_users u ON u.id=b.provider_subject
     WHERE b.principal_id=$1 AND b.provider='better_auth' AND b.status='active'
     ORDER BY b.last_used_at DESC LIMIT 1 FOR SHARE`,
    [principalAddress],
  );
  const row = result.rows[0] as Row | undefined;
  const email = text(row, "email")?.trim().toLowerCase() ?? null;
  return email && boolean(row, "email_verified") ? email : null;
}

async function validateRecipient(client: PoolClient, row: Row, principalAddress: string, token: string) {
  const intendedAccount = text(row, "intended_account_address");
  if (intendedAccount && intendedAccount !== principalAddress) {
    throw new TokenlessServiceError(
      "Reviewer invitation is bound to another account.",
      403,
      "reviewer_invitation_account_mismatch",
    );
  }
  const intendedEmailHash = text(row, "intended_email_hash");
  const intendedDomain = text(row, "intended_email_domain");
  if (!intendedEmailHash && !intendedDomain) return;
  const email = await verifiedEmail(client, principalAddress);
  if (
    !email ||
    (intendedEmailHash && digest(`${token}\0${email}`) !== intendedEmailHash) ||
    (intendedDomain && email.split("@")[1] !== intendedDomain)
  ) {
    throw new TokenlessServiceError(
      "Reviewer invitation is bound to another verified email.",
      403,
      "reviewer_invitation_email_mismatch",
    );
  }
}

async function invitationByToken(client: PoolClient, token: string, lock: boolean) {
  const match = INVITATION_PATTERN.exec(token);
  if (!match) throw new TokenlessServiceError("Reviewer invitation not found.", 404, "reviewer_invitation_not_found");
  const result = await client.query(
    `SELECT i.*,w.name AS workspace_name,w.status AS workspace_status
     FROM tokenless_workspace_reviewer_invitations i
     JOIN tokenless_workspaces w ON w.workspace_id=i.workspace_id
     WHERE i.token_hash=$1 AND i.token_prefix=$2 LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [digest(token), match[1]],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new TokenlessServiceError("Reviewer invitation not found.", 404, "reviewer_invitation_not_found");
  return row;
}

function assertInvitationAvailable(row: Row, now: Date) {
  if (
    text(row, "workspace_status") !== "active" ||
    date(row, "revoked_at") ||
    date(row, "expires_at")! <= now ||
    (date(row, "access_expires_at") !== null && date(row, "access_expires_at")! <= now) ||
    count(row, "redemption_count") >= count(row, "maximum_redemptions")
  ) {
    throw new TokenlessServiceError(
      "Reviewer invitation is no longer available.",
      410,
      "reviewer_invitation_unavailable",
    );
  }
}

export async function previewWorkspaceReviewerInvitation(input: { accountAddress: string; token: string; now?: Date }) {
  const principalAddress = normalizePrincipal(input.accountAddress);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const row = await invitationByToken(client, input.token, false);
    assertInvitationAvailable(row, input.now ?? new Date());
    await validateRecipient(client, row, principalAddress, input.token);
    await client.query("COMMIT");
    return {
      invitationId: text(row, "invitation_id"),
      workspaceId: text(row, "workspace_id"),
      workspaceName: text(row, "workspace_name"),
      maxPrivateSensitivity: text(row, "max_private_sensitivity"),
      accessExpiresAt: iso(date(row, "access_expires_at")),
      expiresAt: iso(date(row, "expires_at")),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function redeemWorkspaceReviewerInvitation(input: { accountAddress: string; token: string; now?: Date }) {
  const principalAddress = normalizePrincipal(input.accountAddress);
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const row = await invitationByToken(client, input.token, true);
    await validateRecipient(client, row, principalAddress, input.token);
    const invitationId = text(row, "invitation_id")!;
    const workspaceId = text(row, "workspace_id")!;
    const replay = await client.query(
      `SELECT grant_id FROM tokenless_workspace_reviewer_invitation_redemptions
       WHERE invitation_id=$1 AND principal_address=$2 LIMIT 1`,
      [invitationId, principalAddress],
    );
    if (replay.rowCount === 1) {
      await client.query("COMMIT");
      return {
        invitationId,
        workspaceId,
        principalAddress,
        grantId: text(replay.rows[0] as Row, "grant_id"),
        replay: true as const,
      };
    }
    assertInvitationAvailable(row, now);
    const projectResult = await client.query(
      `SELECT project_id FROM tokenless_workspace_reviewer_invitation_projects
       WHERE invitation_id=$1 ORDER BY project_id`,
      [invitationId],
    );
    const projects = projectResult.rows.map(value => text(value as Row, "project_id")!);
    await client.query(
      `INSERT INTO tokenless_workspace_reviewers
       (workspace_id,principal_address,status,activated_at,created_by,updated_at)
       VALUES ($1,$2,'active',$3,$4,$3)
       ON CONFLICT (workspace_id,principal_address) DO UPDATE SET
         status='active',activated_at=EXCLUDED.activated_at,ended_at=NULL,end_reason=NULL,updated_at=EXCLUDED.updated_at`,
      [workspaceId, principalAddress, now, text(row, "created_by")],
    );
    const grantId = `wrg_${randomUUID().replaceAll("-", "")}`;
    const grantSnapshot = {
      grantId,
      workspaceId,
      principalAddress,
      projectScope: text(row, "project_scope"),
      projectIds: projects,
      maxPrivateSensitivity: text(row, "max_private_sensitivity"),
      validFrom: now.toISOString(),
      validUntil: iso(date(row, "access_expires_at")),
      sourceInvitationId: invitationId,
    };
    const grantHash = hashJson(grantSnapshot);
    await client.query(
      `INSERT INTO tokenless_workspace_reviewer_access_grants
       (grant_id,workspace_id,principal_address,project_scope,max_private_sensitivity,valid_from,valid_until,
        source_invitation_id,grant_hash,created_by,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$6)`,
      [
        grantId,
        workspaceId,
        principalAddress,
        text(row, "project_scope"),
        text(row, "max_private_sensitivity"),
        now,
        date(row, "access_expires_at"),
        invitationId,
        grantHash,
        text(row, "created_by"),
      ],
    );
    for (const projectId of projects) {
      await client.query(
        `INSERT INTO tokenless_workspace_reviewer_access_grant_projects
         (grant_id,workspace_id,project_id) VALUES ($1,$2,$3)`,
        [grantId, workspaceId, projectId],
      );
    }
    await client.query(
      `INSERT INTO tokenless_workspace_reviewer_invitation_redemptions
       (invitation_id,workspace_id,principal_address,grant_id,redeemed_at) VALUES ($1,$2,$3,$4,$5)`,
      [invitationId, workspaceId, principalAddress, grantId, now],
    );
    await client.query(
      `UPDATE tokenless_workspace_reviewer_invitations
       SET redemption_count=redemption_count+1,last_used_at=$1
       WHERE invitation_id=$2 AND revoked_at IS NULL AND redemption_count<maximum_redemptions`,
      [now, invitationId],
    );
    await appendEvent(client, {
      workspaceId,
      principalAddress,
      invitationId,
      grantId,
      eventType: "invitation_redeemed",
      actorReference: principalAddress,
      now,
    });
    await client.query("COMMIT");
    return { invitationId, workspaceId, principalAddress, grantId, grantHash, replay: false as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeWorkspaceReviewerInvitation(input: {
  accountAddress: string;
  workspaceId: string;
  invitationId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const manager = await requireManagerInTransaction(client, input.accountAddress, input.workspaceId);
    const result = await client.query(
      `UPDATE tokenless_workspace_reviewer_invitations
       SET revoked_at=$1,revoked_by=$2
       WHERE workspace_id=$3 AND invitation_id=$4 AND revoked_at IS NULL AND redemption_count<maximum_redemptions
       RETURNING invitation_id`,
      [now, manager, input.workspaceId, input.invitationId],
    );
    if (result.rowCount !== 1) {
      throw new TokenlessServiceError("Reviewer invitation not found.", 404, "reviewer_invitation_not_found");
    }
    await appendEvent(client, {
      workspaceId: input.workspaceId,
      invitationId: input.invitationId,
      eventType: "invitation_revoked",
      actorReference: manager,
      now,
    });
    await client.query("COMMIT");
    return { invitationId: input.invitationId, revokedAt: now.toISOString() };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function endWorkspaceReviewer(input: {
  actorAddress: string;
  workspaceId: string;
  principalAddress: string;
  status: "removed" | "left";
  reason: string;
  now: Date;
}) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const principalAddress = normalizePrincipal(input.principalAddress, "principalAddress");
    const actorAddress =
      input.status === "removed"
        ? await requireManagerInTransaction(client, input.actorAddress, input.workspaceId)
        : normalizePrincipal(input.actorAddress);
    if (input.status === "left" && actorAddress !== principalAddress) {
      throw new TokenlessServiceError("Workspace reviewer not found.", 404, "workspace_reviewer_not_found");
    }
    const ended = await client.query(
      `UPDATE tokenless_workspace_reviewers
       SET status=$1,ended_at=$2,end_reason=$3,updated_at=$2
       WHERE workspace_id=$4 AND principal_address=$5 AND status='active'
       RETURNING principal_address`,
      [input.status, input.now, input.reason, input.workspaceId, principalAddress],
    );
    if (ended.rowCount !== 1) {
      throw new TokenlessServiceError("Workspace reviewer not found.", 404, "workspace_reviewer_not_found");
    }
    const revoked = await client.query(
      `UPDATE tokenless_workspace_reviewer_access_grants
       SET revoked_at=$1,revoked_by=$2
       WHERE workspace_id=$3 AND principal_address=$4 AND revoked_at IS NULL
       RETURNING grant_id`,
      [input.now, actorAddress, input.workspaceId, principalAddress],
    );
    await client.query(
      `UPDATE tokenless_private_group_memberships
       SET status=$1,ended_at=$2,end_reason=$3,updated_at=$2
       WHERE group_id IN (
         SELECT group_id FROM tokenless_private_groups WHERE workspace_id=$4
       ) AND principal_address=$5 AND status='active'`,
      [input.status, input.now, input.reason, input.workspaceId, principalAddress],
    );
    const revokedLeases = await client.query(
      `UPDATE tokenless_assurance_artifact_leases
       SET revoked_at=$1
       WHERE workspace_id=$2 AND account_address=$3
         AND assignment_id IS NOT NULL AND revoked_at IS NULL
       RETURNING lease_id`,
      [input.now, input.workspaceId, principalAddress],
    );
    const expiredAccepted = await client.query(
      `UPDATE tokenless_assurance_assignments
       SET lease_state='expired',updated_at=$1
       WHERE workspace_id=$2 AND reviewer_account_address=$3
         AND status='accepted' AND lease_state<>'expired'
       RETURNING assignment_id`,
      [input.now, input.workspaceId, principalAddress],
    );
    const expiredAcceptedDirect = await client.query(
      `UPDATE tokenless_private_unpaid_review_assignments
       SET lease_state='expired',updated_at=$1
       WHERE workspace_id=$2 AND reviewer_account_address=$3
         AND status='accepted' AND lease_state<>'expired'
       RETURNING assignment_id,project_id,cohort_id,reviewer_account_address`,
      [input.now, input.workspaceId, principalAddress],
    );
    for (const value of expiredAcceptedDirect.rows) {
      const row = value as Row;
      await client.query(
        `UPDATE tokenless_assurance_cohorts
         SET active_reservations = active_reservations - 1, updated_at = $1
         WHERE project_id = $2 AND cohort_id = $3 AND active_reservations > 0`,
        [input.now, text(row, "project_id"), text(row, "cohort_id")],
      );
      await client.query(
        `UPDATE tokenless_assurance_cohort_reviewers
         SET active_reservations = active_reservations - 1, updated_at = $1
         WHERE project_id = $2 AND cohort_id = $3 AND reviewer_account_address = $4
           AND active_reservations > 0`,
        [input.now, text(row, "project_id"), text(row, "cohort_id"), text(row, "reviewer_account_address")],
      );
    }
    const released = await client.query(
      `UPDATE tokenless_assurance_assignments
       SET status='released',lease_state='expired',updated_at=$1
       WHERE workspace_id=$2 AND reviewer_account_address=$3 AND status='reserved'
       RETURNING subpanel_id,project_id,cohort_id`,
      [input.now, input.workspaceId, principalAddress],
    );
    for (const value of released.rows) {
      const row = value as Row;
      await client.query(
        `UPDATE tokenless_assurance_run_subpanels SET active_reservations=active_reservations-1
         WHERE subpanel_id=$1 AND active_reservations>0`,
        [text(row, "subpanel_id")],
      );
      await client.query(
        `UPDATE tokenless_assurance_cohorts SET active_reservations=active_reservations-1,updated_at=$1
         WHERE project_id=$2 AND cohort_id=$3 AND active_reservations>0`,
        [input.now, text(row, "project_id"), text(row, "cohort_id")],
      );
      await client.query(
        `UPDATE tokenless_assurance_cohort_reviewers SET active_reservations=active_reservations-1,updated_at=$1
         WHERE project_id=$2 AND cohort_id=$3 AND reviewer_account_address=$4 AND active_reservations>0`,
        [input.now, text(row, "project_id"), text(row, "cohort_id"), principalAddress],
      );
    }
    const expiredDirect = await client.query(
      `UPDATE tokenless_private_unpaid_review_assignments
       SET status='expired',lease_state='expired',updated_at=$1
       WHERE workspace_id=$2 AND reviewer_account_address=$3 AND status='reserved'
       RETURNING project_id,cohort_id`,
      [input.now, input.workspaceId, principalAddress],
    );
    for (const value of expiredDirect.rows) {
      const row = value as Row;
      await client.query(
        `UPDATE tokenless_assurance_cohorts SET active_reservations=active_reservations-1,updated_at=$1
         WHERE project_id=$2 AND cohort_id=$3 AND active_reservations>0`,
        [input.now, text(row, "project_id"), text(row, "cohort_id")],
      );
      await client.query(
        `UPDATE tokenless_assurance_cohort_reviewers SET active_reservations=active_reservations-1,updated_at=$1
         WHERE project_id=$2 AND cohort_id=$3 AND reviewer_account_address=$4 AND active_reservations>0`,
        [input.now, text(row, "project_id"), text(row, "cohort_id"), principalAddress],
      );
    }
    await appendEvent(client, {
      workspaceId: input.workspaceId,
      principalAddress,
      eventType: input.status === "removed" ? "reviewer_removed" : "reviewer_left",
      actorReference: actorAddress,
      details: {
        reason: input.reason,
        revokedGrantCount: revoked.rowCount,
        revokedArtifactLeaseCount: revokedLeases.rowCount,
        expiredAcceptedAssignmentCount: (expiredAccepted.rowCount ?? 0) + (expiredAcceptedDirect.rowCount ?? 0),
        releasedReservationCount: (released.rowCount ?? 0) + (expiredDirect.rowCount ?? 0),
      },
      now: input.now,
    });
    await client.query("COMMIT");
    return { principalAddress, status: input.status, endedAt: input.now.toISOString() };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function removeWorkspaceReviewer(input: {
  accountAddress: string;
  workspaceId: string;
  principalAddress: string;
  reason?: string;
  now?: Date;
}) {
  return endWorkspaceReviewer({
    actorAddress: normalizePrincipal(input.accountAddress),
    workspaceId: input.workspaceId,
    principalAddress: input.principalAddress,
    status: "removed",
    reason: input.reason?.trim() || "workspace_manager_removed_reviewer",
    now: input.now ?? new Date(),
  });
}

export async function leaveWorkspaceReviewer(input: {
  accountAddress: string;
  workspaceId: string;
  reason?: string;
  now?: Date;
}) {
  const principalAddress = normalizePrincipal(input.accountAddress);
  return endWorkspaceReviewer({
    actorAddress: principalAddress,
    workspaceId: input.workspaceId,
    principalAddress,
    status: "left",
    reason: input.reason?.trim() || "reviewer_left_workspace_roster",
    now: input.now ?? new Date(),
  });
}

export async function requireEligibleWorkspaceReviewerGrant(input: {
  workspaceId: string;
  principalAddress: string;
  projectId: string;
  privateSensitivity: Sensitivity;
  responseDeadline: Date;
  now?: Date;
}) {
  const principalAddress = normalizePrincipal(input.principalAddress, "principalAddress");
  const requestedSensitivity = sensitivity(input.privateSensitivity);
  const now = input.now ?? new Date();
  const result = await dbClient.execute({
    sql: `SELECT g.grant_id,g.grant_hash,g.project_scope,g.max_private_sensitivity,g.valid_from,g.valid_until
          FROM tokenless_workspace_reviewer_access_grants g
          JOIN tokenless_workspace_reviewers r
            ON r.workspace_id=g.workspace_id AND r.principal_address=g.principal_address AND r.status='active'
          JOIN tokenless_principals principal
            ON principal.principal_id=g.principal_address AND principal.status='active'
          LEFT JOIN tokenless_workspace_reviewer_access_grant_projects p
            ON p.grant_id=g.grant_id AND p.workspace_id=g.workspace_id AND p.project_id=?
          WHERE g.workspace_id=? AND g.principal_address=? AND g.revoked_at IS NULL
            AND g.valid_from<=? AND (g.valid_until IS NULL OR g.valid_until>=?)
            AND (g.project_scope='all' OR p.project_id IS NOT NULL)
          ORDER BY g.valid_until DESC NULLS FIRST,g.created_at ASC`,
    args: [input.projectId, input.workspaceId, principalAddress, now, input.responseDeadline],
  });
  const eligible = result.rows
    .map(value => value as Row)
    .find(
      row =>
        SENSITIVITIES.indexOf(sensitivity(text(row, "max_private_sensitivity")!)) >=
        SENSITIVITIES.indexOf(requestedSensitivity),
    );
  if (!eligible) {
    throw new TokenlessServiceError(
      "Reviewer access does not cover this assignment through its response deadline.",
      409,
      "workspace_reviewer_ineligible",
    );
  }
  return {
    grantId: text(eligible, "grant_id")!,
    grantHash: text(eligible, "grant_hash")!,
    projectScope: text(eligible, "project_scope")!,
    maxPrivateSensitivity: text(eligible, "max_private_sensitivity") as Sensitivity,
    validFrom: iso(date(eligible, "valid_from"))!,
    validUntil: iso(date(eligible, "valid_until")),
  };
}

export async function createWorkspaceReviewerTermsVersion(input: {
  accountAddress: string;
  workspaceId: string;
  terms: Record<string, unknown>;
  schemaVersion?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const schemaVersion = integer(input.schemaVersion ?? 1, "schemaVersion", 1, 1000);
  const termsJson = canonicalJson(input.terms);
  const termsHash = `sha256:${digest(termsJson)}`;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const manager = await requireManagerInTransaction(client, input.accountAddress, input.workspaceId);
    await client.query(`SELECT workspace_id FROM tokenless_workspaces WHERE workspace_id=$1 FOR UPDATE`, [
      input.workspaceId,
    ]);
    const existing = await client.query(
      `SELECT version FROM tokenless_workspace_reviewer_terms_versions
       WHERE workspace_id=$1 AND terms_hash=$2 LIMIT 1`,
      [input.workspaceId, termsHash],
    );
    if (existing.rowCount === 1) {
      await client.query("COMMIT");
      return { workspaceId: input.workspaceId, version: count(existing.rows[0] as Row, "version"), termsHash };
    }
    const next = await client.query(
      `SELECT COALESCE(MAX(version),0)+1 AS version
       FROM tokenless_workspace_reviewer_terms_versions WHERE workspace_id=$1`,
      [input.workspaceId],
    );
    const version = count(next.rows[0] as Row, "version");
    await client.query(
      `INSERT INTO tokenless_workspace_reviewer_terms_versions
       (workspace_id,version,terms_hash,terms_json,schema_version,created_by,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [input.workspaceId, version, termsHash, termsJson, schemaVersion, manager, now],
    );
    await appendEvent(client, {
      workspaceId: input.workspaceId,
      eventType: "terms_version_created",
      actorReference: manager,
      details: { version, termsHash, schemaVersion },
      now,
    });
    await client.query("COMMIT");
    return { workspaceId: input.workspaceId, version, termsHash };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function hasAcceptedWorkspaceReviewerTerms(input: {
  workspaceId: string;
  termsVersion: number;
  termsHash: string;
  principalAddress: string;
}) {
  const result = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_workspace_reviewer_terms_acceptances
          WHERE workspace_id=? AND terms_version=? AND terms_hash=? AND principal_address=? LIMIT 1`,
    args: [
      input.workspaceId,
      input.termsVersion,
      input.termsHash,
      normalizePrincipal(input.principalAddress, "principalAddress"),
    ],
  });
  return result.rowCount === 1;
}

export async function acceptWorkspaceReviewerTerms(input: {
  workspaceId: string;
  termsVersion: number;
  termsHash: string;
  principalAddress: string;
  acceptedFromAssignmentId: string;
  now?: Date;
}) {
  const principalAddress = normalizePrincipal(input.principalAddress, "principalAddress");
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const reviewer = await client.query(
      `SELECT 1 FROM tokenless_workspace_reviewers
       WHERE workspace_id=$1 AND principal_address=$2 AND status='active' LIMIT 1 FOR SHARE`,
      [input.workspaceId, principalAddress],
    );
    if (reviewer.rowCount !== 1) {
      throw new TokenlessServiceError("Workspace reviewer not found.", 404, "workspace_reviewer_not_found");
    }
    const existing = await client.query(
      `SELECT terms_hash,accepted_at FROM tokenless_workspace_reviewer_terms_acceptances
       WHERE workspace_id=$1 AND terms_version=$2 AND principal_address=$3 LIMIT 1 FOR SHARE`,
      [input.workspaceId, input.termsVersion, principalAddress],
    );
    if (existing.rowCount === 1) {
      if (text(existing.rows[0] as Row, "terms_hash") !== input.termsHash) {
        throw new TokenlessServiceError("Reviewer terms changed.", 409, "reviewer_terms_mismatch");
      }
      await client.query("COMMIT");
      return {
        accepted: true as const,
        acceptedAt: date(existing.rows[0] as Row, "accepted_at")!.toISOString(),
        replayed: true as const,
      };
    }
    const inserted = await client.query(
      `INSERT INTO tokenless_workspace_reviewer_terms_acceptances
       (workspace_id,terms_version,terms_hash,principal_address,accepted_from_assignment_id,accepted_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (workspace_id,terms_version,principal_address) DO NOTHING
       RETURNING accepted_at`,
      [input.workspaceId, input.termsVersion, input.termsHash, principalAddress, input.acceptedFromAssignmentId, now],
    );
    const exact =
      inserted.rowCount === 1
        ? inserted
        : await client.query(
            `SELECT terms_hash,accepted_at FROM tokenless_workspace_reviewer_terms_acceptances
             WHERE workspace_id=$1 AND terms_version=$2 AND principal_address=$3 LIMIT 1`,
            [input.workspaceId, input.termsVersion, principalAddress],
          );
    if (
      exact.rowCount !== 1 ||
      (inserted.rowCount !== 1 && text(exact.rows[0] as Row, "terms_hash") !== input.termsHash)
    ) {
      throw new TokenlessServiceError("Reviewer terms changed.", 409, "reviewer_terms_mismatch");
    }
    if (inserted.rowCount === 1) {
      await appendEvent(client, {
        workspaceId: input.workspaceId,
        principalAddress,
        eventType: "terms_accepted",
        actorReference: principalAddress,
        details: { termsVersion: input.termsVersion, termsHash: input.termsHash },
        now,
      });
    }
    await client.query("COMMIT");
    return {
      accepted: true as const,
      acceptedAt: date(exact.rows[0] as Row, "accepted_at")?.toISOString() ?? now.toISOString(),
      replayed: inserted.rowCount !== 1,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
