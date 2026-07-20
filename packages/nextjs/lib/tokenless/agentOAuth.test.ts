import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  AGENT_OAUTH_SAFE_SCOPES,
  authenticateAgentOAuthAccessToken,
  exchangeAgentOAuthToken,
  getCanonicalAgentMcpResource,
  issueAgentOAuthAuthorizationCode,
  registerAgentOAuthClient,
  revokeAgentOAuthToken,
  validateAgentOAuthAuthorizationRequest,
  validateAgentOAuthRedirectUri,
} from "~~/lib/tokenless/agentOAuth";

const originalAppUrl = process.env.APP_URL;
const PRINCIPAL_ID = "rlp_oauth_test_principal";
const REDIRECT_URI = "http://127.0.0.1:43119/oauth/callback";
const CODE_VERIFIER = "a".repeat(64);
const CODE_CHALLENGE = createHash("sha256").update(CODE_VERIFIER).digest("base64url");

beforeEach(async () => {
  process.env.APP_URL = "https://rateloop-tokenless.vercel.app";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id, status, created_at, updated_at)
          VALUES (?, 'active', ?, ?)`,
    args: [PRINCIPAL_ID, now, now],
  });
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

async function authorizationFixture() {
  const registered = await registerAgentOAuthClient({
    client_name: "Generic MCP host",
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "connection:claim context:read evaluation:read review:decide",
  });
  const request = await validateAgentOAuthAuthorizationRequest(
    new URLSearchParams({
      client_id: registered.client_id,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: "S256",
      resource: getCanonicalAgentMcpResource(),
      scope: registered.scope,
      state: "client-state",
    }),
  );
  const issued = await issueAgentOAuthAuthorizationCode({
    request,
    subjectPrincipalId: PRINCIPAL_ID,
    consented: true,
  });
  const code = new URL(issued.redirectUri).searchParams.get("code");
  assert.ok(code);
  return { clientId: registered.client_id, code, request };
}

test("dynamic registration accepts only public clients with exact secure or loopback redirects", async () => {
  assert.equal(validateAgentOAuthRedirectUri("https://agent.example/callback"), "https://agent.example/callback");
  assert.equal(validateAgentOAuthRedirectUri(REDIRECT_URI), REDIRECT_URI);
  assert.throws(() => validateAgentOAuthRedirectUri("http://agent.example/callback"), /HTTPS.*loopback/);
  assert.throws(() => validateAgentOAuthRedirectUri("https://agent.example/callback#secret"), /fragment/);

  await assert.rejects(
    () =>
      registerAgentOAuthClient({
        client_name: "Confidential client",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "client_secret_post",
      }),
    /public PKCE clients/,
  );
  const registered = await registerAgentOAuthClient({
    client_name: "Public client",
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "none",
  });
  assert.equal(registered.token_endpoint_auth_method, "none");
  assert.deepEqual(registered.scope.split(" "), [...AGENT_OAUTH_SAFE_SCOPES]);
  assert.equal("client_secret" in registered, false);
  const stored = await dbClient.execute({
    sql: `SELECT client_secret_hash, registration_source, redirect_uris_json FROM tokenless_agent_oauth_clients
          WHERE client_id = ?`,
    args: [registered.client_id],
  });
  assert.equal(stored.rows[0].client_secret_hash, null);
  assert.equal(stored.rows[0].registration_source, "dynamic");
  assert.equal(JSON.parse(String(stored.rows[0].redirect_uris_json))[0], REDIRECT_URI);
});

test("authorization requires exact client, redirect, resource, safe scope, and S256 PKCE bindings", async () => {
  const registered = await registerAgentOAuthClient({
    client_name: "Bound client",
    redirect_uris: [REDIRECT_URI],
    scope: "connection:claim context:read",
  });
  const base = {
    client_id: registered.client_id,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: "S256",
    resource: getCanonicalAgentMcpResource(),
    scope: "connection:claim context:read",
  };
  await assert.rejects(
    () =>
      validateAgentOAuthAuthorizationRequest(
        new URLSearchParams({ ...base, redirect_uri: "http://127.0.0.1:43120/oauth/callback" }),
      ),
    /exactly match/,
  );
  await assert.rejects(
    () =>
      validateAgentOAuthAuthorizationRequest(new URLSearchParams({ ...base, resource: "https://evil.example/mcp" })),
    /exact RateLoop workspace MCP resource/,
  );
  await assert.rejects(
    () => validateAgentOAuthAuthorizationRequest(new URLSearchParams({ ...base, code_challenge_method: "plain" })),
    /S256 PKCE/,
  );
  await assert.rejects(
    () =>
      validateAgentOAuthAuthorizationRequest(
        new URLSearchParams({ ...base, scope: "connection:claim workspace:admin" }),
      ),
    /safe agent-connection scopes/,
  );
  const duplicated = new URLSearchParams(base);
  duplicated.append("resource", getCanonicalAgentMcpResource());
  await assert.rejects(() => validateAgentOAuthAuthorizationRequest(duplicated), /resource must not be repeated/);
});

test("authorization codes are single-use and opaque tokens remain hash-only", async () => {
  const fixture = await authorizationFixture();
  await assert.rejects(
    () =>
      exchangeAgentOAuthToken({
        grantType: "authorization_code",
        clientId: fixture.clientId,
        code: fixture.code,
        redirectUri: REDIRECT_URI,
        codeVerifier: "b".repeat(64),
        resource: getCanonicalAgentMcpResource(),
      }),
    /invalid, expired, consumed, or misbound/,
  );
  const tokens = await exchangeAgentOAuthToken({
    grantType: "authorization_code",
    clientId: fixture.clientId,
    code: fixture.code,
    redirectUri: REDIRECT_URI,
    codeVerifier: CODE_VERIFIER,
    resource: getCanonicalAgentMcpResource(),
  });
  assert.match(tokens.access_token, /^rlo_at_/);
  assert.match(tokens.refresh_token, /^rlo_rt_/);
  const principal = await authenticateAgentOAuthAccessToken(`Bearer ${tokens.access_token}`, {
    requiredScopes: ["connection:claim"],
  });
  assert.equal(principal.clientId, fixture.clientId);
  assert.equal(principal.clientName, "Generic MCP host");
  assert.equal(principal.subjectPrincipalId, PRINCIPAL_ID);
  assert.equal(principal.resource, getCanonicalAgentMcpResource());
  await assert.rejects(() =>
    exchangeAgentOAuthToken({
      grantType: "authorization_code",
      clientId: fixture.clientId,
      code: fixture.code,
      redirectUri: REDIRECT_URI,
      codeVerifier: CODE_VERIFIER,
      resource: getCanonicalAgentMcpResource(),
    }),
  );
  const serialized = JSON.stringify(
    (
      await dbClient.execute({
        sql: `SELECT code_hash FROM tokenless_agent_oauth_authorization_codes
              UNION ALL SELECT token_hash FROM tokenless_agent_oauth_access_tokens
              UNION ALL SELECT token_hash FROM tokenless_agent_oauth_refresh_tokens`,
      })
    ).rows,
  );
  assert.equal(serialized.includes(fixture.code), false);
  assert.equal(serialized.includes(tokens.access_token), false);
  assert.equal(serialized.includes(tokens.refresh_token), false);
});

test("public-client refresh tokens stay stable while issuing bounded access tokens", async () => {
  const fixture = await authorizationFixture();
  const first = await exchangeAgentOAuthToken({
    grantType: "authorization_code",
    clientId: fixture.clientId,
    code: fixture.code,
    redirectUri: REDIRECT_URI,
    codeVerifier: CODE_VERIFIER,
    resource: getCanonicalAgentMcpResource(),
  });
  const refreshed = await exchangeAgentOAuthToken({
    grantType: "refresh_token",
    clientId: fixture.clientId,
    refreshToken: first.refresh_token,
    resource: getCanonicalAgentMcpResource(),
    scope: "connection:claim context:read",
  });
  assert.equal(refreshed.refresh_token, first.refresh_token);
  assert.notEqual(refreshed.access_token, first.access_token);
  await authenticateAgentOAuthAccessToken(`Bearer ${refreshed.access_token}`);
  const next = await exchangeAgentOAuthToken({
    grantType: "refresh_token",
    clientId: fixture.clientId,
    refreshToken: first.refresh_token,
    resource: getCanonicalAgentMcpResource(),
  });
  assert.equal(next.refresh_token, first.refresh_token);
  assert.notEqual(next.access_token, refreshed.access_token);
  await authenticateAgentOAuthAccessToken(`Bearer ${next.access_token}`);
});

test("revocation is idempotent, client-bound, and invalidates the next access-token use", async () => {
  const fixture = await authorizationFixture();
  const tokens = await exchangeAgentOAuthToken({
    grantType: "authorization_code",
    clientId: fixture.clientId,
    code: fixture.code,
    redirectUri: REDIRECT_URI,
    codeVerifier: CODE_VERIFIER,
    resource: getCanonicalAgentMcpResource(),
  });
  await revokeAgentOAuthToken({ clientId: "another-client", token: tokens.refresh_token });
  await authenticateAgentOAuthAccessToken(`Bearer ${tokens.access_token}`);
  await revokeAgentOAuthToken({ clientId: fixture.clientId, token: tokens.refresh_token });
  await revokeAgentOAuthToken({ clientId: fixture.clientId, token: tokens.refresh_token });
  await assert.rejects(() => authenticateAgentOAuthAccessToken(`Bearer ${tokens.access_token}`), /invalid.*revoked/);
});
