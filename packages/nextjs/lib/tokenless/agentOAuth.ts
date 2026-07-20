import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { getAuthOrigin } from "~~/lib/auth/session";
import { dbClient, dbPool } from "~~/lib/db";

type Row = Record<string, unknown>;

const AUTHORIZATION_CODE_TTL_MS = 5 * 60_000;
const ACCESS_TOKEN_TTL_MS = 15 * 60_000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
const TOKEN_FAMILY_TTL_MS = 90 * 24 * 60 * 60_000;
const DYNAMIC_CLIENT_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_REDIRECT_URIS = 16;
const MAX_SCOPES = 16;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

export const AGENT_OAUTH_SAFE_SCOPES = [
  "connection:claim",
  "context:read",
  "evaluation:read",
  "review:decide",
] as const;

export const AGENT_OAUTH_DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code" as const;

export type AgentOAuthScope = (typeof AGENT_OAUTH_SAFE_SCOPES)[number];

export type AgentOAuthAuthorizationRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  responseType: "code";
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  scopes: AgentOAuthScope[];
  state: string | null;
  registrationSource: "pre_registered" | "client_id_metadata" | "dynamic";
  autoAuthorize: boolean;
};

export type AgentOAuthAccessPrincipal = {
  tokenFamilyId: string;
  clientId: string;
  clientName: string;
  subjectPrincipalId: string;
  audience: string;
  resource: string;
  scopes: AgentOAuthScope[];
  expiresAt: Date;
};

export type AgentOAuthTokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
  resource: string;
};

export class AgentOAuthError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "invalid_client"
      | "unauthorized_client"
      | "invalid_grant"
      | "invalid_scope"
      | "invalid_token"
      | "unsupported_grant_type"
      | "unsupported_response_type"
      | "access_denied"
      | "authorization_pending"
      | "slow_down"
      | "expired_token"
      | "server_error",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AgentOAuthError";
  }
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

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function opaqueToken(prefix: string) {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function stableJson(values: string[]) {
  return JSON.stringify([...new Set(values)].sort());
}

function parseJsonList(value: unknown, field: string): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string")) throw new Error();
    return parsed;
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function requiredString(value: unknown, field: string, max = 1_000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new AgentOAuthError("invalid_request", `${field} is required.`);
  }
  return value.trim();
}

function optionalHttpsUri(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  const raw = requiredString(value, field, 2_048);
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
    return url.href;
  } catch {
    throw new AgentOAuthError("invalid_request", `${field} must be an HTTPS URL without credentials or a fragment.`);
  }
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function validateAgentOAuthRedirectUri(value: unknown) {
  const raw = requiredString(value, "redirect_uri", 2_048);
  try {
    const url = new URL(raw);
    const secure = url.protocol === "https:";
    const loopback = url.protocol === "http:" && isLoopbackHostname(url.hostname);
    if ((!secure && !loopback) || url.username || url.password || url.hash) throw new Error();
    return url.href;
  } catch {
    throw new AgentOAuthError(
      "invalid_request",
      "redirect_uri must use HTTPS, or HTTP on an exact loopback host, and cannot contain credentials or a fragment.",
    );
  }
}

function canonicalScopes(value: unknown, options?: { defaultSafe?: boolean }): AgentOAuthScope[] {
  const raw =
    typeof value === "string"
      ? value.split(/\s+/).filter(Boolean)
      : Array.isArray(value)
        ? value.map(item => (typeof item === "string" ? item : ""))
        : [];
  const scopes = [...new Set(raw)];
  if (scopes.length === 0 && options?.defaultSafe) return [...AGENT_OAUTH_SAFE_SCOPES];
  if (
    scopes.length === 0 ||
    scopes.length > MAX_SCOPES ||
    scopes.some(scope => !AGENT_OAUTH_SAFE_SCOPES.includes(scope as AgentOAuthScope))
  ) {
    throw new AgentOAuthError("invalid_scope", "Only RateLoop's safe agent-connection scopes may be requested.");
  }
  return AGENT_OAUTH_SAFE_SCOPES.filter(scope => scopes.includes(scope));
}

export function getAgentOAuthOrigin() {
  return getAuthOrigin();
}

export function getCanonicalAgentMcpResource(origin = getAgentOAuthOrigin()) {
  return `${new URL(origin).origin}/api/agent/v1/mcp`;
}

export function getAgentOAuthProtectedResourceMetadata(origin = getAgentOAuthOrigin()) {
  const issuer = new URL(origin).origin;
  return {
    resource: getCanonicalAgentMcpResource(issuer),
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [...AGENT_OAUTH_SAFE_SCOPES],
    resource_documentation: `${issuer}/docs/agents`,
  };
}

export function getAgentOAuthAuthorizationServerMetadata(origin = getAgentOAuthOrigin()) {
  const issuer = new URL(origin).origin;
  return {
    issuer,
    authorization_endpoint: `${issuer}/agent/oauth/authorize`,
    token_endpoint: `${issuer}/api/agent/oauth/token`,
    revocation_endpoint: `${issuer}/api/agent/oauth/revoke`,
    registration_endpoint: `${issuer}/api/agent/oauth/register`,
    device_authorization_endpoint: `${issuer}/api/agent/oauth/device`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token", AGENT_OAUTH_DEVICE_GRANT_TYPE],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...AGENT_OAUTH_SAFE_SCOPES],
    service_documentation: `${issuer}/docs/agents`,
  };
}

export async function registerAgentOAuthClient(value: unknown, now = new Date()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentOAuthError("invalid_request", "A client metadata object is required.");
  }
  const input = value as Record<string, unknown>;
  if (input.token_endpoint_auth_method !== undefined && input.token_endpoint_auth_method !== "none") {
    throw new AgentOAuthError("invalid_client", "Dynamic registration is available only to public PKCE clients.");
  }
  const grantTypes = input.grant_types ?? ["authorization_code", "refresh_token"];
  if (
    !Array.isArray(grantTypes) ||
    grantTypes.length === 0 ||
    new Set(grantTypes.map(String)).size !== grantTypes.length ||
    grantTypes.some(
      value => !["authorization_code", "refresh_token", AGENT_OAUTH_DEVICE_GRANT_TYPE].includes(String(value)),
    ) ||
    (!grantTypes.includes("authorization_code") && !grantTypes.includes(AGENT_OAUTH_DEVICE_GRANT_TYPE))
  ) {
    throw new AgentOAuthError(
      "invalid_request",
      "A public client must use authorization_code, the device-code grant, or both; refresh_token is optional.",
    );
  }
  const usesAuthorizationCode = grantTypes.includes("authorization_code");
  const redirectInput = input.redirect_uris ?? [];
  if (
    !Array.isArray(redirectInput) ||
    redirectInput.length > MAX_REDIRECT_URIS ||
    (usesAuthorizationCode && redirectInput.length === 0)
  ) {
    throw new AgentOAuthError(
      "invalid_request",
      "redirect_uris must contain between 1 and 16 exact URLs when authorization_code is enabled.",
    );
  }
  const redirectUris = [...new Set(redirectInput.map(validateAgentOAuthRedirectUri))];
  if (redirectUris.length !== redirectInput.length) {
    throw new AgentOAuthError("invalid_request", "redirect_uris cannot contain duplicates.");
  }
  const responseTypes = input.response_types ?? (usesAuthorizationCode ? ["code"] : []);
  if (
    !Array.isArray(responseTypes) ||
    (usesAuthorizationCode ? responseTypes.length !== 1 || responseTypes[0] !== "code" : responseTypes.length !== 0)
  ) {
    throw new AgentOAuthError(
      "invalid_request",
      "response_types must be [code] for authorization_code clients and empty for device-only clients.",
    );
  }
  const scopes = canonicalScopes(input.scope, { defaultSafe: true });
  const clientName = requiredString(input.client_name, "client_name", 160);
  const clientUri = optionalHttpsUri(input.client_uri, "client_uri");
  const logoUri = optionalHttpsUri(input.logo_uri, "logo_uri");
  const softwareId = input.software_id ? requiredString(input.software_id, "software_id", 160) : null;
  const softwareVersion = input.software_version
    ? requiredString(input.software_version, "software_version", 160)
    : null;
  const clientId = `rlc_${randomUUID().replaceAll("-", "")}`;
  const redirectJson = stableJson(redirectUris);
  const expiresAt = new Date(now.getTime() + DYNAMIC_CLIENT_TTL_MS);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_clients
          (client_id, client_secret_hash, client_name, client_uri, logo_uri, redirect_uris_json,
           redirect_uris_digest, token_endpoint_auth_method, grant_types_json, response_types_json,
           allowed_scopes_json, registration_source, software_id, software_version, status, created_at, updated_at,
           expires_at)
          VALUES (?, NULL, ?, ?, ?, ?, ?, 'none', ?, ?, ?, 'dynamic', ?, ?, 'active', ?, ?, ?)`,
    args: [
      clientId,
      clientName,
      clientUri,
      logoUri,
      redirectJson,
      digest(redirectJson),
      stableJson(grantTypes.map(String)),
      stableJson(responseTypes.map(String)),
      stableJson(scopes),
      softwareId,
      softwareVersion,
      now,
      now,
      expiresAt,
    ],
  });
  return {
    client_id: clientId,
    client_name: clientName,
    client_uri: clientUri ?? undefined,
    logo_uri: logoUri ?? undefined,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none" as const,
    grant_types: grantTypes.map(String),
    response_types: responseTypes.map(String),
    scope: scopes.join(" "),
    client_id_issued_at: Math.floor(now.getTime() / 1_000),
    client_id_expires_at: Math.floor(expiresAt.getTime() / 1_000),
  };
}

export async function validateAgentOAuthAuthorizationRequest(
  value: Record<string, string | string[] | undefined> | URLSearchParams,
  now = new Date(),
): Promise<AgentOAuthAuthorizationRequest> {
  const get = (key: string) => {
    if (value instanceof URLSearchParams) {
      const entries = value.getAll(key);
      if (entries.length > 1) throw new AgentOAuthError("invalid_request", `${key} must not be repeated.`);
      return entries[0] ?? null;
    }
    const entry = value[key];
    if (Array.isArray(entry)) throw new AgentOAuthError("invalid_request", `${key} must not be repeated.`);
    return entry ?? null;
  };
  const clientId = requiredString(get("client_id"), "client_id", 512);
  const responseType = get("response_type");
  if (responseType !== "code") {
    throw new AgentOAuthError("unsupported_response_type", "response_type must be code.");
  }
  const redirectUri = validateAgentOAuthRedirectUri(get("redirect_uri"));
  const codeChallenge = requiredString(get("code_challenge"), "code_challenge", 128);
  if (!CODE_CHALLENGE_PATTERN.test(codeChallenge) || get("code_challenge_method") !== "S256") {
    throw new AgentOAuthError("invalid_request", "S256 PKCE with a valid code_challenge is required.");
  }
  const resource = requiredString(get("resource"), "resource", 2_048);
  if (resource !== getCanonicalAgentMcpResource()) {
    throw new AgentOAuthError("invalid_request", "The exact RateLoop workspace MCP resource is required.");
  }
  const scopes = canonicalScopes(get("scope"), { defaultSafe: true });
  if (!scopes.includes("connection:claim")) {
    throw new AgentOAuthError("invalid_scope", "connection:claim is required for an unbound agent grant.");
  }
  const state = get("state");
  if (state !== null && (state.length === 0 || state.length > 512)) {
    throw new AgentOAuthError("invalid_request", "state is invalid.");
  }
  const result = await dbClient.execute({
    sql: `SELECT client_name, redirect_uris_json, allowed_scopes_json, registration_source
          FROM tokenless_agent_oauth_clients
          WHERE client_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`,
    args: [clientId, now],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new AgentOAuthError("invalid_client", "The OAuth client is unknown or inactive.", 401);
  const registeredRedirects = parseJsonList(row.redirect_uris_json, "redirect URIs");
  if (!registeredRedirects.includes(redirectUri)) {
    throw new AgentOAuthError("invalid_request", "redirect_uri does not exactly match this client registration.");
  }
  const allowedScopes = parseJsonList(row.allowed_scopes_json, "allowed scopes");
  if (scopes.some(scope => !allowedScopes.includes(scope))) {
    throw new AgentOAuthError("invalid_scope", "The client is not registered for every requested scope.");
  }
  const registrationSource = text(row, "registration_source") as AgentOAuthAuthorizationRequest["registrationSource"];
  return {
    clientId,
    clientName: text(row, "client_name")!,
    redirectUri,
    responseType: "code",
    codeChallenge,
    codeChallengeMethod: "S256",
    resource,
    scopes,
    state,
    registrationSource,
    autoAuthorize: registrationSource === "pre_registered",
  };
}

export async function issueAgentOAuthAuthorizationCode(input: {
  request: AgentOAuthAuthorizationRequest;
  subjectPrincipalId: string;
  consented: boolean;
  now?: Date;
}) {
  if (!input.consented) throw new AgentOAuthError("access_denied", "The resource owner denied authorization.", 403);
  const now = input.now ?? new Date();
  const familyExpiresAt = new Date(now.getTime() + TOKEN_FAMILY_TTL_MS);
  const codeExpiresAt = new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS);
  const tokenFamilyId = `atf_${randomUUID().replaceAll("-", "")}`;
  const authorizationCodeId = `aco_${randomUUID().replaceAll("-", "")}`;
  const code = opaqueToken("rlo_ac_");
  const scopesJson = stableJson(input.request.scopes);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const principal = await client.query(
      `SELECT principal_id FROM tokenless_principals WHERE principal_id = $1 AND status = 'active' LIMIT 1`,
      [input.subjectPrincipalId],
    );
    if (principal.rowCount !== 1)
      throw new AgentOAuthError("access_denied", "The RateLoop principal is inactive.", 403);
    await client.query(
      `INSERT INTO tokenless_agent_oauth_token_families
       (token_family_id, client_id, subject_principal_id, audience, resource, granted_scopes_json,
        status, created_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $4, $5, 'active', $6, $7)`,
      [
        tokenFamilyId,
        input.request.clientId,
        input.subjectPrincipalId,
        input.request.resource,
        scopesJson,
        now,
        familyExpiresAt,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_agent_oauth_authorization_codes
       (authorization_code_id, code_hash, token_family_id, client_id, subject_principal_id,
        redirect_uri, redirect_uri_digest, code_challenge, code_challenge_method, state_hash,
        audience, resource, granted_scopes_json, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'S256', $9, $10, $10, $11, $12, $13)`,
      [
        authorizationCodeId,
        digest(code),
        tokenFamilyId,
        input.request.clientId,
        input.subjectPrincipalId,
        input.request.redirectUri,
        digest(input.request.redirectUri),
        input.request.codeChallenge,
        input.request.state ? digest(input.request.state) : null,
        input.request.resource,
        scopesJson,
        now,
        codeExpiresAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const redirect = new URL(input.request.redirectUri);
  redirect.searchParams.set("code", code);
  if (input.request.state) redirect.searchParams.set("state", input.request.state);
  return { redirectUri: redirect.href };
}

function verifyPkce(codeVerifier: string, codeChallenge: string) {
  if (!CODE_VERIFIER_PATTERN.test(codeVerifier)) return false;
  const actual = createHash("sha256").update(codeVerifier).digest("base64url");
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(codeChallenge);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

async function issueAccessToken(input: {
  client: PoolClient;
  tokenFamilyId: string;
  refreshTokenId: string;
  clientId: string;
  subjectPrincipalId: string;
  resource: string;
  scopes: AgentOAuthScope[];
  familyExpiresAt: Date;
  now: Date;
}) {
  const accessToken = opaqueToken("rlo_at_");
  const accessTokenId = `aat_${randomUUID().replaceAll("-", "")}`;
  const accessExpiresAt = new Date(
    Math.min(input.now.getTime() + ACCESS_TOKEN_TTL_MS, input.familyExpiresAt.getTime()),
  );
  const scopesJson = stableJson(input.scopes);
  await input.client.query(
    `INSERT INTO tokenless_agent_oauth_access_tokens
     (access_token_id, token_hash, token_family_id, refresh_token_id, client_id, subject_principal_id,
      audience, resource, granted_scopes_json, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10)`,
    [
      accessTokenId,
      digest(accessToken),
      input.tokenFamilyId,
      input.refreshTokenId,
      input.clientId,
      input.subjectPrincipalId,
      input.resource,
      scopesJson,
      input.now,
      accessExpiresAt,
    ],
  );
  return { accessToken, accessExpiresAt };
}

async function issueTokenPair(input: {
  client: PoolClient;
  tokenFamilyId: string;
  clientId: string;
  subjectPrincipalId: string;
  resource: string;
  scopes: AgentOAuthScope[];
  generation: number;
  familyExpiresAt: Date;
  now: Date;
}) {
  const refreshToken = opaqueToken("rlo_rt_");
  const refreshTokenId = `art_${randomUUID().replaceAll("-", "")}`;
  const refreshExpiresAt = new Date(
    Math.min(input.now.getTime() + REFRESH_TOKEN_TTL_MS, input.familyExpiresAt.getTime()),
  );
  const scopesJson = stableJson(input.scopes);
  await input.client.query(
    `INSERT INTO tokenless_agent_oauth_refresh_tokens
     (refresh_token_id, token_hash, token_family_id, client_id, subject_principal_id,
      audience, resource, granted_scopes_json, generation, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10)`,
    [
      refreshTokenId,
      digest(refreshToken),
      input.tokenFamilyId,
      input.clientId,
      input.subjectPrincipalId,
      input.resource,
      scopesJson,
      input.generation,
      input.now,
      refreshExpiresAt,
    ],
  );
  const { accessToken, accessExpiresAt } = await issueAccessToken({
    ...input,
    refreshTokenId,
  });
  return {
    response: {
      access_token: accessToken,
      token_type: "Bearer" as const,
      expires_in: Math.max(1, Math.floor((accessExpiresAt.getTime() - input.now.getTime()) / 1_000)),
      refresh_token: refreshToken,
      scope: input.scopes.join(" "),
      resource: input.resource,
    },
    refreshTokenId,
  };
}

export async function issueAgentOAuthDeviceTokenFamily(input: {
  client: PoolClient;
  clientId: string;
  subjectPrincipalId: string;
  resource: string;
  scopes: AgentOAuthScope[];
  now: Date;
}) {
  if (input.resource !== getCanonicalAgentMcpResource()) {
    throw new AgentOAuthError("invalid_grant", "The exact RateLoop workspace MCP resource is required.");
  }
  const scopes = canonicalScopes(input.scopes);
  if (!scopes.includes("connection:claim")) {
    throw new AgentOAuthError("invalid_scope", "connection:claim is required for an unbound agent grant.");
  }
  const active = await input.client.query(
    `SELECT c.client_id, p.principal_id
     FROM tokenless_agent_oauth_clients c
     JOIN tokenless_principals p ON p.principal_id = $2 AND p.status = 'active'
     WHERE c.client_id = $1 AND c.status = 'active' AND (c.expires_at IS NULL OR c.expires_at > $3)
     LIMIT 1`,
    [input.clientId, input.subjectPrincipalId, input.now],
  );
  if (active.rowCount !== 1) {
    throw new AgentOAuthError("access_denied", "The OAuth client or RateLoop principal is inactive.", 403);
  }
  const tokenFamilyId = `atf_${randomUUID().replaceAll("-", "")}`;
  const familyExpiresAt = new Date(input.now.getTime() + TOKEN_FAMILY_TTL_MS);
  await input.client.query(
    `INSERT INTO tokenless_agent_oauth_token_families
     (token_family_id, client_id, subject_principal_id, audience, resource, granted_scopes_json,
      status, created_at, absolute_expires_at, last_rotated_at)
     VALUES ($1, $2, $3, $4, $4, $5, 'active', $6, $7, $6)`,
    [
      tokenFamilyId,
      input.clientId,
      input.subjectPrincipalId,
      input.resource,
      stableJson(scopes),
      input.now,
      familyExpiresAt,
    ],
  );
  const issued = await issueTokenPair({
    client: input.client,
    tokenFamilyId,
    clientId: input.clientId,
    subjectPrincipalId: input.subjectPrincipalId,
    resource: input.resource,
    scopes,
    generation: 1,
    familyExpiresAt,
    now: input.now,
  });
  return { tokenFamilyId, response: issued.response };
}

async function revokeTokenFamily(client: PoolClient, tokenFamilyId: string, now: Date, reason: string) {
  await client.query(
    `UPDATE tokenless_agent_oauth_token_families
     SET status = 'revoked', revoked_at = COALESCE(revoked_at, $2), revoked_by = 'oauth_server',
         revocation_reason = COALESCE(revocation_reason, $3)
     WHERE token_family_id = $1 AND status = 'active'`,
    [tokenFamilyId, now, reason],
  );
  await client.query(
    `UPDATE tokenless_agent_oauth_refresh_tokens
     SET revoked_at = COALESCE(revoked_at, $2), revocation_reason = COALESCE(revocation_reason, $3)
     WHERE token_family_id = $1`,
    [tokenFamilyId, now, reason],
  );
  await client.query(
    `UPDATE tokenless_agent_oauth_access_tokens
     SET revoked_at = COALESCE(revoked_at, $2), revocation_reason = COALESCE(revocation_reason, $3)
     WHERE token_family_id = $1`,
    [tokenFamilyId, now, reason],
  );
}

export async function exchangeAgentOAuthToken(
  input:
    | {
        grantType: "authorization_code";
        clientId: string;
        code: string;
        redirectUri: string;
        codeVerifier: string;
        resource: string;
      }
    | {
        grantType: "refresh_token";
        clientId: string;
        refreshToken: string;
        resource: string;
        scope?: string | null;
      },
  now = new Date(),
): Promise<AgentOAuthTokenResponse> {
  if (input.resource !== getCanonicalAgentMcpResource()) {
    throw new AgentOAuthError("invalid_grant", "The exact RateLoop workspace MCP resource is required.");
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    if (input.grantType === "authorization_code") {
      const redirectUri = validateAgentOAuthRedirectUri(input.redirectUri);
      const result = await client.query(
        `SELECT c.*, f.status AS family_status, f.absolute_expires_at
         FROM tokenless_agent_oauth_authorization_codes c
         JOIN tokenless_agent_oauth_token_families f ON f.token_family_id = c.token_family_id
         JOIN tokenless_agent_oauth_clients o ON o.client_id = c.client_id
         WHERE c.code_hash = $1 AND o.status = 'active' AND (o.expires_at IS NULL OR o.expires_at > $2)
         FOR UPDATE`,
        [digest(input.code), now],
      );
      const row = result.rows[0] as Row | undefined;
      if (
        !row ||
        text(row, "client_id") !== input.clientId ||
        text(row, "redirect_uri") !== redirectUri ||
        text(row, "resource") !== input.resource ||
        text(row, "family_status") !== "active" ||
        date(row, "consumed_at") ||
        date(row, "revoked_at") ||
        !date(row, "expires_at") ||
        date(row, "expires_at")!.getTime() <= now.getTime() ||
        !date(row, "absolute_expires_at") ||
        date(row, "absolute_expires_at")!.getTime() <= now.getTime() ||
        !verifyPkce(input.codeVerifier, text(row, "code_challenge")!)
      ) {
        throw new AgentOAuthError(
          "invalid_grant",
          "The authorization code is invalid, expired, consumed, or misbound.",
        );
      }
      const consumed = await client.query(
        `UPDATE tokenless_agent_oauth_authorization_codes SET consumed_at = $2
         WHERE authorization_code_id = $1 AND consumed_at IS NULL RETURNING authorization_code_id`,
        [text(row, "authorization_code_id"), now],
      );
      if (consumed.rowCount !== 1) throw new AgentOAuthError("invalid_grant", "The authorization code was replayed.");
      const scopes = canonicalScopes(parseJsonList(row.granted_scopes_json, "granted scopes"));
      const issued = await issueTokenPair({
        client,
        tokenFamilyId: text(row, "token_family_id")!,
        clientId: input.clientId,
        subjectPrincipalId: text(row, "subject_principal_id")!,
        resource: input.resource,
        scopes,
        generation: 1,
        familyExpiresAt: date(row, "absolute_expires_at")!,
        now,
      });
      await client.query(
        `UPDATE tokenless_agent_oauth_token_families SET last_rotated_at = $2 WHERE token_family_id = $1`,
        [text(row, "token_family_id"), now],
      );
      await client.query("COMMIT");
      return issued.response;
    }

    const result = await client.query(
      `SELECT r.*, f.status AS family_status, f.absolute_expires_at
       FROM tokenless_agent_oauth_refresh_tokens r
       JOIN tokenless_agent_oauth_token_families f ON f.token_family_id = r.token_family_id
       JOIN tokenless_agent_oauth_clients o ON o.client_id = r.client_id
       WHERE r.token_hash = $1 AND o.status = 'active' AND (o.expires_at IS NULL OR o.expires_at > $2)
       FOR UPDATE`,
      [digest(input.refreshToken), now],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row || text(row, "client_id") !== input.clientId || text(row, "resource") !== input.resource) {
      throw new AgentOAuthError("invalid_grant", "The refresh token is invalid or misbound.");
    }
    const tokenFamilyId = text(row, "token_family_id")!;
    if (date(row, "used_at") || date(row, "replaced_at")) {
      await client.query(
        `UPDATE tokenless_agent_oauth_refresh_tokens
         SET revocation_reason = 'refresh_token_replay_presented'
         WHERE refresh_token_id = $1`,
        [text(row, "refresh_token_id")],
      );
      await revokeTokenFamily(client, tokenFamilyId, now, "refresh_token_replay");
      await client.query("COMMIT");
      throw new AgentOAuthError("invalid_grant", "Refresh-token replay revoked this token family.");
    }
    if (
      text(row, "family_status") !== "active" ||
      date(row, "revoked_at") ||
      !date(row, "expires_at") ||
      date(row, "expires_at")!.getTime() <= now.getTime() ||
      !date(row, "absolute_expires_at") ||
      date(row, "absolute_expires_at")!.getTime() <= now.getTime()
    ) {
      throw new AgentOAuthError("invalid_grant", "The refresh token or token family is inactive or expired.");
    }
    const existingScopes = canonicalScopes(parseJsonList(row.granted_scopes_json, "granted scopes"));
    const requestedScopes = input.scope ? canonicalScopes(input.scope) : existingScopes;
    if (requestedScopes.some(scope => !existingScopes.includes(scope))) {
      throw new AgentOAuthError("invalid_scope", "A refresh cannot widen its original scope.");
    }
    const issued = await issueAccessToken({
      client,
      tokenFamilyId,
      refreshTokenId: text(row, "refresh_token_id")!,
      clientId: input.clientId,
      subjectPrincipalId: text(row, "subject_principal_id")!,
      resource: input.resource,
      scopes: requestedScopes,
      familyExpiresAt: date(row, "absolute_expires_at")!,
      now,
    });
    await client.query("COMMIT");
    return {
      access_token: issued.accessToken,
      token_type: "Bearer",
      expires_in: Math.max(1, Math.floor((issued.accessExpiresAt.getTime() - now.getTime()) / 1_000)),
      refresh_token: input.refreshToken,
      scope: requestedScopes.join(" "),
      resource: input.resource,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // A deliberate replay path may already have committed the family revocation.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function authenticateAgentOAuthAccessToken(
  authorization: string | null | undefined,
  options?: { requiredScopes?: AgentOAuthScope[]; now?: Date },
): Promise<AgentOAuthAccessPrincipal> {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/);
  if (!match) throw new AgentOAuthError("invalid_token", "A valid bearer access token is required.", 401);
  const now = options?.now ?? new Date();
  const result = await dbClient.execute({
    sql: `SELECT a.access_token_id, a.token_family_id, a.client_id, a.subject_principal_id,
                 a.audience, a.resource, a.granted_scopes_json, a.expires_at, c.client_name,
                 f.status AS family_status, f.absolute_expires_at
          FROM tokenless_agent_oauth_access_tokens a
          JOIN tokenless_agent_oauth_token_families f ON f.token_family_id = a.token_family_id
          JOIN tokenless_agent_oauth_clients c ON c.client_id = a.client_id
          JOIN tokenless_principals p ON p.principal_id = a.subject_principal_id
          WHERE a.token_hash = ? AND a.revoked_at IS NULL AND a.expires_at > ?
            AND f.status = 'active' AND f.absolute_expires_at > ?
            AND c.status = 'active' AND (c.expires_at IS NULL OR c.expires_at > ?)
            AND p.status = 'active'
          LIMIT 1`,
    args: [digest(match[1]), now, now, now],
  });
  const row = result.rows[0] as Row | undefined;
  if (
    !row ||
    text(row, "resource") !== getCanonicalAgentMcpResource() ||
    text(row, "audience") !== getCanonicalAgentMcpResource()
  ) {
    throw new AgentOAuthError("invalid_token", "The bearer token is invalid, expired, revoked, or misbound.", 401);
  }
  const scopes = canonicalScopes(parseJsonList(row.granted_scopes_json, "granted scopes"));
  if (options?.requiredScopes?.some(scope => !scopes.includes(scope))) {
    throw new AgentOAuthError("invalid_scope", "The bearer token lacks a required scope.", 403);
  }
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_oauth_access_tokens SET last_used_at = ? WHERE access_token_id = ?`,
    args: [now, text(row, "access_token_id")],
  });
  return {
    tokenFamilyId: text(row, "token_family_id")!,
    clientId: text(row, "client_id")!,
    clientName: text(row, "client_name")!,
    subjectPrincipalId: text(row, "subject_principal_id")!,
    audience: text(row, "audience")!,
    resource: text(row, "resource")!,
    scopes,
    expiresAt: date(row, "expires_at")!,
  };
}

export async function revokeAgentOAuthToken(
  input: { clientId: string; token: string; tokenTypeHint?: string | null },
  now = new Date(),
) {
  if (!input.clientId || !input.token || input.clientId.length > 512 || input.token.length > 512) return;
  if (input.tokenTypeHint && !["access_token", "refresh_token"].includes(input.tokenTypeHint)) {
    throw new AgentOAuthError("invalid_request", "token_type_hint is unsupported.");
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const tokenHash = digest(input.token);
    const refresh = await client.query(
      `SELECT token_family_id, client_id FROM tokenless_agent_oauth_refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    const access = refresh.rowCount
      ? { rows: [] as Row[], rowCount: 0 }
      : await client.query(
          `SELECT token_family_id, client_id FROM tokenless_agent_oauth_access_tokens WHERE token_hash = $1 FOR UPDATE`,
          [tokenHash],
        );
    const row = (refresh.rows[0] ?? access.rows[0]) as Row | undefined;
    if (row && text(row, "client_id") === input.clientId) {
      await revokeTokenFamily(client, text(row, "token_family_id")!, now, "client_revocation");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
