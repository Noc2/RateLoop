import { createHash, randomBytes, randomUUID } from "node:crypto";
import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import {
  AGENT_OAUTH_DEVICE_GRANT_TYPE,
  AGENT_OAUTH_SAFE_SCOPES,
  AgentOAuthError,
  type AgentOAuthScope,
  getAgentOAuthOrigin,
  getCanonicalAgentMcpResource,
  issueAgentOAuthDeviceTokenFamily,
} from "~~/lib/tokenless/agentOAuth";

type Row = Record<string, unknown>;

const DEVICE_AUTHORIZATION_TTL_MS = 10 * 60_000;
const INITIAL_POLL_INTERVAL_SECONDS = 5;
const SLOW_DOWN_INCREMENT_SECONDS = 5;
const MAX_POLL_INTERVAL_SECONDS = 60;
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEVICE_CODE_PATTERN = /^rlo_dc_[A-Za-z0-9_-]{43}$/;

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function date(row: Row | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Database returned invalid ${key}.`);
  return parsed;
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Database returned invalid ${key}.`);
  return value;
}

function parseStringList(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string")) throw new Error();
    return parsed;
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function canonicalScopes(value: unknown, defaultSafe = false): AgentOAuthScope[] {
  const raw =
    typeof value === "string"
      ? value.split(/\s+/).filter(Boolean)
      : Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [];
  const scopes = [...new Set(raw)];
  if (scopes.length === 0 && defaultSafe) return [...AGENT_OAUTH_SAFE_SCOPES];
  if (scopes.length === 0 || scopes.some(scope => !AGENT_OAUTH_SAFE_SCOPES.includes(scope as AgentOAuthScope))) {
    throw new AgentOAuthError("invalid_scope", "Only RateLoop's safe agent-connection scopes may be requested.");
  }
  return AGENT_OAUTH_SAFE_SCOPES.filter(scope => scopes.includes(scope));
}

function stableJson(values: string[]) {
  return JSON.stringify([...new Set(values)].sort());
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function makeUserCode() {
  const bytes = randomBytes(8);
  const raw = [...bytes].map(byte => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normalizeAgentOAuthUserCode(value: unknown) {
  if (typeof value !== "string" || value.length > 32) {
    throw new AgentOAuthError("invalid_request", "Enter the eight-character verification code.");
  }
  const normalized = value.toUpperCase().replace(/[\s-]/g, "");
  if (normalized.length !== 8 || [...normalized].some(character => !USER_CODE_ALPHABET.includes(character))) {
    throw new AgentOAuthError("invalid_request", "Enter the eight-character verification code.");
  }
  return normalized;
}

function formatUserCode(normalized: string) {
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export type AgentOAuthDeviceApproval = {
  userCode: string;
  clientName: string;
  scopes: AgentOAuthScope[];
  status: "pending" | "approved" | "denied" | "consumed" | "expired";
  expiresAt: Date;
};

export async function createAgentOAuthDeviceAuthorization(
  input: { clientId: string; resource: string; scope?: string | null },
  now = new Date(),
) {
  if (!input.clientId || input.clientId.length > 512) {
    throw new AgentOAuthError("invalid_client", "A valid public client_id is required.", 401);
  }
  if (input.resource !== getCanonicalAgentMcpResource()) {
    throw new AgentOAuthError("invalid_request", "The exact RateLoop workspace MCP resource is required.");
  }
  const scopes = canonicalScopes(input.scope, true);
  if (!scopes.includes("connection:claim")) {
    throw new AgentOAuthError("invalid_scope", "connection:claim is required for an unbound agent grant.");
  }
  const clientResult = await dbClient.execute({
    sql: `SELECT client_name, grant_types_json, allowed_scopes_json
          FROM tokenless_agent_oauth_clients
          WHERE client_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`,
    args: [input.clientId, now],
  });
  const client = clientResult.rows[0] as Row | undefined;
  if (!client) throw new AgentOAuthError("invalid_client", "The OAuth client is unknown or inactive.", 401);
  const grantTypes = parseStringList(client.grant_types_json, "grant types");
  if (!grantTypes.includes(AGENT_OAUTH_DEVICE_GRANT_TYPE)) {
    throw new AgentOAuthError("unauthorized_client", "The OAuth client is not registered for device authorization.");
  }
  const allowedScopes = parseStringList(client.allowed_scopes_json, "allowed scopes");
  if (scopes.some(scope => !allowedScopes.includes(scope))) {
    throw new AgentOAuthError("invalid_scope", "The client is not registered for every requested scope.");
  }

  const expiresAt = new Date(now.getTime() + DEVICE_AUTHORIZATION_TTL_MS);
  let deviceCode = "";
  let userCode = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    deviceCode = `rlo_dc_${randomBytes(32).toString("base64url")}`;
    userCode = makeUserCode();
    try {
      await dbClient.execute({
        sql: `INSERT INTO tokenless_agent_oauth_device_authorizations
              (device_authorization_id, device_code_hash, user_code_hash, client_id, audience, resource,
               requested_scopes_json, status, interval_seconds, poll_count, created_at, expires_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?)`,
        args: [
          `ado_${randomUUID().replaceAll("-", "")}`,
          digest(deviceCode),
          digest(normalizeAgentOAuthUserCode(userCode)),
          input.clientId,
          input.resource,
          input.resource,
          stableJson(scopes),
          INITIAL_POLL_INTERVAL_SECONDS,
          now,
          expiresAt,
          now,
        ],
      });
      break;
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 4) throw error;
    }
  }
  if (!deviceCode || !userCode) throw new AgentOAuthError("server_error", "Device authorization could not start.", 500);
  const verificationUri = `${getAgentOAuthOrigin()}/agent/oauth/device`;
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
    expires_in: Math.floor(DEVICE_AUTHORIZATION_TTL_MS / 1_000),
    interval: INITIAL_POLL_INTERVAL_SECONDS,
  };
}

async function expireDeviceAuthorization(row: Row, now: Date) {
  const status = text(row, "status");
  if (!["pending", "approved"].includes(status ?? "") || date(row, "expires_at")!.getTime() > now.getTime()) {
    return status;
  }
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_oauth_device_authorizations
          SET status = 'expired', updated_at = ?
          WHERE device_authorization_id = ? AND status IN ('pending','approved')`,
    args: [now, text(row, "device_authorization_id")],
  });
  return "expired";
}

export async function getAgentOAuthDeviceApproval(
  userCode: unknown,
  now = new Date(),
): Promise<AgentOAuthDeviceApproval> {
  const normalized = normalizeAgentOAuthUserCode(userCode);
  const result = await dbClient.execute({
    sql: `SELECT d.device_authorization_id, d.status, d.requested_scopes_json, d.expires_at, c.client_name
          FROM tokenless_agent_oauth_device_authorizations d
          JOIN tokenless_agent_oauth_clients c ON c.client_id = d.client_id
          WHERE d.user_code_hash = ? LIMIT 1`,
    args: [digest(normalized)],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new AgentOAuthError("invalid_request", "That verification code is invalid or expired.");
  const status = await expireDeviceAuthorization(row, now);
  return {
    userCode: formatUserCode(normalized),
    clientName: text(row, "client_name")!,
    scopes: canonicalScopes(parseStringList(row.requested_scopes_json, "requested scopes")),
    status: status as AgentOAuthDeviceApproval["status"],
    expiresAt: date(row, "expires_at")!,
  };
}

export async function decideAgentOAuthDeviceAuthorization(input: {
  userCode: unknown;
  subjectPrincipalId: string;
  decision: "approve" | "deny";
  now?: Date;
}) {
  const normalized = normalizeAgentOAuthUserCode(input.userCode);
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  let finished = false;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT d.*, c.client_name
       FROM tokenless_agent_oauth_device_authorizations d
       JOIN tokenless_agent_oauth_clients c ON c.client_id = d.client_id
       WHERE d.user_code_hash = $1 FOR UPDATE`,
      [digest(normalized)],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) throw new AgentOAuthError("invalid_request", "That verification code is invalid or expired.");
    const status = text(row, "status");
    if (date(row, "expires_at")!.getTime() <= now.getTime() && ["pending", "approved"].includes(status ?? "")) {
      await client.query(
        `UPDATE tokenless_agent_oauth_device_authorizations SET status = 'expired', updated_at = $2
         WHERE device_authorization_id = $1`,
        [text(row, "device_authorization_id"), now],
      );
      await client.query("COMMIT");
      finished = true;
      throw new AgentOAuthError("expired_token", "That verification code has expired.");
    }
    if (status === "approved" && text(row, "approved_by_principal_id") === input.subjectPrincipalId) {
      await client.query("COMMIT");
      finished = true;
      return { status, clientName: text(row, "client_name")!, userCode: formatUserCode(normalized) };
    }
    if (status === "denied" && input.decision === "deny") {
      await client.query("COMMIT");
      finished = true;
      return { status, clientName: text(row, "client_name")!, userCode: formatUserCode(normalized) };
    }
    if (status !== "pending") {
      throw new AgentOAuthError("access_denied", "This device authorization has already been decided or used.", 403);
    }
    const principal = await client.query(
      `SELECT principal_id FROM tokenless_principals WHERE principal_id = $1 AND status = 'active' LIMIT 1`,
      [input.subjectPrincipalId],
    );
    if (principal.rowCount !== 1) {
      throw new AgentOAuthError("access_denied", "The RateLoop principal is inactive.", 403);
    }
    if (input.decision === "approve") {
      await client.query(
        `UPDATE tokenless_agent_oauth_device_authorizations
         SET status = 'approved', approved_by_principal_id = $2, approved_at = $3, updated_at = $3
         WHERE device_authorization_id = $1 AND status = 'pending'`,
        [text(row, "device_authorization_id"), input.subjectPrincipalId, now],
      );
    } else {
      await client.query(
        `UPDATE tokenless_agent_oauth_device_authorizations
         SET status = 'denied', denied_at = $2, updated_at = $2
         WHERE device_authorization_id = $1 AND status = 'pending'`,
        [text(row, "device_authorization_id"), now],
      );
    }
    await client.query("COMMIT");
    finished = true;
    return {
      status: input.decision === "approve" ? ("approved" as const) : ("denied" as const),
      clientName: text(row, "client_name")!,
      userCode: formatUserCode(normalized),
    };
  } catch (error) {
    if (!finished) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function exchangeAgentOAuthDeviceCode(
  input: { clientId: string; deviceCode: string; resource: string },
  now = new Date(),
) {
  if (!DEVICE_CODE_PATTERN.test(input.deviceCode)) {
    throw new AgentOAuthError("invalid_grant", "The device code is invalid or expired.");
  }
  if (input.resource !== getCanonicalAgentMcpResource()) {
    throw new AgentOAuthError("invalid_grant", "The exact RateLoop workspace MCP resource is required.");
  }
  const client = await dbPool.connect();
  let finished = false;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT d.*, c.status AS client_status, c.expires_at AS client_expires_at
       FROM tokenless_agent_oauth_device_authorizations d
       JOIN tokenless_agent_oauth_clients c ON c.client_id = d.client_id
       WHERE d.device_code_hash = $1 FOR UPDATE`,
      [digest(input.deviceCode)],
    );
    const row = result.rows[0] as Row | undefined;
    if (
      !row ||
      text(row, "client_id") !== input.clientId ||
      text(row, "resource") !== input.resource ||
      text(row, "audience") !== input.resource ||
      text(row, "client_status") !== "active" ||
      (date(row, "client_expires_at")?.getTime() ?? Number.POSITIVE_INFINITY) <= now.getTime()
    ) {
      throw new AgentOAuthError("invalid_grant", "The device code is invalid, expired, or misbound.");
    }
    const authorizationId = text(row, "device_authorization_id")!;
    const status = text(row, "status");
    if (date(row, "expires_at")!.getTime() <= now.getTime() && ["pending", "approved"].includes(status ?? "")) {
      await client.query(
        `UPDATE tokenless_agent_oauth_device_authorizations SET status = 'expired', updated_at = $2
         WHERE device_authorization_id = $1`,
        [authorizationId, now],
      );
      await client.query("COMMIT");
      finished = true;
      throw new AgentOAuthError("expired_token", "The device code has expired.");
    }
    if (status === "pending") {
      const intervalSeconds = integer(row, "interval_seconds");
      const lastPolledAt = date(row, "last_polled_at");
      const tooFast = lastPolledAt && now.getTime() - lastPolledAt.getTime() < intervalSeconds * 1_000;
      const nextInterval = tooFast
        ? Math.min(MAX_POLL_INTERVAL_SECONDS, intervalSeconds + SLOW_DOWN_INCREMENT_SECONDS)
        : intervalSeconds;
      await client.query(
        `UPDATE tokenless_agent_oauth_device_authorizations
         SET last_polled_at = $2, poll_count = poll_count + 1, interval_seconds = $3, updated_at = $2
         WHERE device_authorization_id = $1`,
        [authorizationId, now, nextInterval],
      );
      await client.query("COMMIT");
      finished = true;
      throw new AgentOAuthError(
        tooFast ? "slow_down" : "authorization_pending",
        tooFast ? "Polling is too frequent; increase the interval by five seconds." : "The owner has not approved yet.",
      );
    }
    if (status === "denied") {
      await client.query("COMMIT");
      finished = true;
      throw new AgentOAuthError("access_denied", "The resource owner denied the device authorization.");
    }
    if (status === "expired") {
      await client.query("COMMIT");
      finished = true;
      throw new AgentOAuthError("expired_token", "The device code has expired.");
    }
    if (status !== "approved") {
      throw new AgentOAuthError("invalid_grant", "The device code has already been consumed.");
    }
    const subjectPrincipalId = text(row, "approved_by_principal_id");
    if (!subjectPrincipalId) throw new AgentOAuthError("access_denied", "The approval is not bound to a principal.");
    const scopes = canonicalScopes(parseStringList(row.requested_scopes_json, "requested scopes"));
    const issued = await issueAgentOAuthDeviceTokenFamily({
      client,
      clientId: input.clientId,
      subjectPrincipalId,
      resource: input.resource,
      scopes,
      now,
    });
    const consumed = await client.query(
      `UPDATE tokenless_agent_oauth_device_authorizations
       SET status = 'consumed', consumed_at = $2, token_family_id = $3, updated_at = $2
       WHERE device_authorization_id = $1 AND status = 'approved' RETURNING device_authorization_id`,
      [authorizationId, now, issued.tokenFamilyId],
    );
    if (consumed.rowCount !== 1) throw new AgentOAuthError("invalid_grant", "The device code was replayed.");
    await client.query("COMMIT");
    finished = true;
    return issued.response;
  } catch (error) {
    if (!finished) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
