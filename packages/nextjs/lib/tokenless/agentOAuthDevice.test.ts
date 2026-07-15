import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  AGENT_OAUTH_DEVICE_GRANT_TYPE,
  AGENT_OAUTH_SAFE_SCOPES,
  authenticateAgentOAuthAccessToken,
  getAgentOAuthAuthorizationServerMetadata,
  getCanonicalAgentMcpResource,
  registerAgentOAuthClient,
} from "~~/lib/tokenless/agentOAuth";
import {
  createAgentOAuthDeviceAuthorization,
  decideAgentOAuthDeviceAuthorization,
  exchangeAgentOAuthDeviceCode,
  getAgentOAuthDeviceApproval,
} from "~~/lib/tokenless/agentOAuthDevice";

const originalAppUrl = process.env.APP_URL;
const PRINCIPAL_ID = "rlp_device_test_principal";
const NOW = new Date("2026-07-15T08:00:00.000Z");

beforeEach(async () => {
  process.env.APP_URL = "https://rateloop-tokenless.vercel.app";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id, status, created_at, updated_at)
          VALUES (?, 'active', ?, ?)`,
    args: [PRINCIPAL_ID, NOW, NOW],
  });
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

async function registerDeviceClient() {
  return registerAgentOAuthClient(
    {
      client_name: "Terminal MCP host",
      token_endpoint_auth_method: "none",
      grant_types: [AGENT_OAUTH_DEVICE_GRANT_TYPE, "refresh_token"],
      response_types: [],
      scope: AGENT_OAUTH_SAFE_SCOPES.join(" "),
    },
    NOW,
  );
}

test("device-only public clients are discoverable and issue hash-only verification codes", async () => {
  const metadata = getAgentOAuthAuthorizationServerMetadata();
  assert.equal(metadata.device_authorization_endpoint, "https://rateloop-tokenless.vercel.app/api/agent/oauth/device");
  assert.ok(metadata.grant_types_supported.includes(AGENT_OAUTH_DEVICE_GRANT_TYPE));

  const registered = await registerDeviceClient();
  assert.deepEqual(registered.redirect_uris, []);
  assert.deepEqual(registered.response_types, []);
  const issued = await createAgentOAuthDeviceAuthorization(
    {
      clientId: registered.client_id,
      resource: getCanonicalAgentMcpResource(),
      scope: registered.scope,
    },
    NOW,
  );
  assert.match(issued.device_code, /^rlo_dc_[A-Za-z0-9_-]{43}$/);
  assert.match(issued.user_code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(issued.expires_in, 600);
  assert.equal(issued.interval, 5);
  assert.equal(
    issued.verification_uri_complete,
    `${issued.verification_uri}?user_code=${encodeURIComponent(issued.user_code)}`,
  );

  const stored = await dbClient.execute({
    sql: `SELECT device_code_hash, user_code_hash, resource, requested_scopes_json
          FROM tokenless_agent_oauth_device_authorizations`,
  });
  const serialized = JSON.stringify(stored.rows);
  assert.equal(serialized.includes(issued.device_code), false);
  assert.equal(serialized.includes(issued.user_code.replace("-", "")), false);
  assert.equal(stored.rows[0].resource, getCanonicalAgentMcpResource());
  assert.deepEqual(
    JSON.parse(String(stored.rows[0].requested_scopes_json)).sort(),
    [...AGENT_OAUTH_SAFE_SCOPES].sort(),
  );
});

test("pending polls persist slow_down and owner approval issues one stable token family", async () => {
  const registered = await registerDeviceClient();
  const issued = await createAgentOAuthDeviceAuthorization(
    { clientId: registered.client_id, resource: getCanonicalAgentMcpResource(), scope: registered.scope },
    NOW,
  );
  await assert.rejects(
    () =>
      exchangeAgentOAuthDeviceCode(
        { clientId: registered.client_id, deviceCode: issued.device_code, resource: getCanonicalAgentMcpResource() },
        NOW,
      ),
    (error: unknown) => error instanceof Error && error.message.includes("not approved yet"),
  );
  await assert.rejects(
    () =>
      exchangeAgentOAuthDeviceCode(
        { clientId: registered.client_id, deviceCode: issued.device_code, resource: getCanonicalAgentMcpResource() },
        new Date(NOW.getTime() + 1_000),
      ),
    (error: unknown) => error instanceof Error && error.message.includes("too frequent"),
  );
  const polling = await dbClient.execute({
    sql: `SELECT poll_count, interval_seconds FROM tokenless_agent_oauth_device_authorizations`,
  });
  assert.equal(Number(polling.rows[0].poll_count), 2);
  assert.equal(Number(polling.rows[0].interval_seconds), 10);

  const approved = await decideAgentOAuthDeviceAuthorization({
    userCode: issued.user_code,
    subjectPrincipalId: PRINCIPAL_ID,
    decision: "approve",
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(approved.status, "approved");
  const approval = await getAgentOAuthDeviceApproval(issued.user_code, new Date(NOW.getTime() + 2_000));
  assert.equal(approval.clientName, "Terminal MCP host");
  assert.equal(approval.status, "approved");

  const tokens = await exchangeAgentOAuthDeviceCode(
    { clientId: registered.client_id, deviceCode: issued.device_code, resource: getCanonicalAgentMcpResource() },
    new Date(NOW.getTime() + 2_000),
  );
  const principal = await authenticateAgentOAuthAccessToken(`Bearer ${tokens.access_token}`, {
    requiredScopes: ["connection:claim"],
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(principal.subjectPrincipalId, PRINCIPAL_ID);
  assert.equal(principal.clientId, registered.client_id);
  const bound = await dbClient.execute({
    sql: `SELECT status, approved_by_principal_id, token_family_id
          FROM tokenless_agent_oauth_device_authorizations`,
  });
  assert.equal(bound.rows[0].status, "consumed");
  assert.equal(bound.rows[0].approved_by_principal_id, PRINCIPAL_ID);
  assert.equal(bound.rows[0].token_family_id, principal.tokenFamilyId);
  await assert.rejects(() =>
    exchangeAgentOAuthDeviceCode(
      { clientId: registered.client_id, deviceCode: issued.device_code, resource: getCanonicalAgentMcpResource() },
      new Date(NOW.getTime() + 3_000),
    ),
  );

  const credentials = JSON.stringify(
    (
      await dbClient.execute({
        sql: `SELECT device_code_hash AS hash FROM tokenless_agent_oauth_device_authorizations
              UNION ALL SELECT token_hash AS hash FROM tokenless_agent_oauth_access_tokens
              UNION ALL SELECT token_hash AS hash FROM tokenless_agent_oauth_refresh_tokens`,
      })
    ).rows,
  );
  assert.equal(credentials.includes(issued.device_code), false);
  assert.equal(credentials.includes(tokens.access_token), false);
  assert.equal(credentials.includes(tokens.refresh_token), false);
});

test("denial and expiry are terminal and cannot issue credentials", async () => {
  const registered = await registerDeviceClient();
  const denied = await createAgentOAuthDeviceAuthorization(
    { clientId: registered.client_id, resource: getCanonicalAgentMcpResource() },
    NOW,
  );
  await decideAgentOAuthDeviceAuthorization({
    userCode: denied.user_code,
    subjectPrincipalId: PRINCIPAL_ID,
    decision: "deny",
    now: new Date(NOW.getTime() + 1_000),
  });
  await assert.rejects(
    () =>
      exchangeAgentOAuthDeviceCode(
        { clientId: registered.client_id, deviceCode: denied.device_code, resource: getCanonicalAgentMcpResource() },
        new Date(NOW.getTime() + 2_000),
      ),
    /denied/,
  );

  const expired = await createAgentOAuthDeviceAuthorization(
    { clientId: registered.client_id, resource: getCanonicalAgentMcpResource() },
    NOW,
  );
  await assert.rejects(
    () =>
      exchangeAgentOAuthDeviceCode(
        { clientId: registered.client_id, deviceCode: expired.device_code, resource: getCanonicalAgentMcpResource() },
        new Date(NOW.getTime() + 10 * 60_000),
      ),
    /expired/,
  );
  const families = await dbClient.execute({
    sql: `SELECT COUNT(*)::integer AS count FROM tokenless_agent_oauth_token_families`,
  });
  assert.equal(Number(families.rows[0].count), 0);
});
