import { NextRequest } from "next/server";
import { POST as startDeviceAuthorization } from "./device/route";
import { POST as revokeToken } from "./revoke/route";
import { POST as exchangeToken } from "./token/route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { AGENT_OAUTH_CLIENT_ID_MAX_LENGTH, AGENT_OAUTH_CREDENTIAL_MAX_LENGTH } from "~~/lib/tokenless/agentOAuth";
import { AGENT_OAUTH_FORM_BODY_MAX_BYTES } from "~~/lib/tokenless/agentOAuthHttp";

const originalRateLimitSecret = process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;

function formRequest(path: "device" | "revoke" | "token", body: string, ip = "203.0.113.71", headers?: HeadersInit) {
  return new NextRequest(`https://rateloop-tokenless.vercel.app/api/agent/oauth/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-real-ip": ip,
      ...headers,
    },
    body,
  });
}

async function oauthError(response: Response) {
  return (await response.json()) as { error?: string; error_description?: string };
}

beforeEach(() => {
  process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = "oauth-endpoint-abuse-test-secret-with-at-least-32-characters";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalRateLimitSecret === undefined) delete process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;
  else process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = originalRateLimitSecret;
});

test("token exchange and revocation share one rate limit for a network identity", async () => {
  for (let count = 0; count < 60; count += 1) {
    const response = await exchangeToken(formRequest("token", ""));
    assert.equal(response.status, 400);
  }

  const limited = await revokeToken(formRequest("revoke", "client_id=client&token=token"));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.deepEqual(await oauthError(limited), {
    error: "slow_down",
    error_description: "OAuth request rate limit exceeded.",
  });
});

test("token exchange and revocation enforce the same client and credential boundaries", async () => {
  const acceptedTokenBoundary = await exchangeToken(
    formRequest(
      "token",
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: "c".repeat(AGENT_OAUTH_CLIENT_ID_MAX_LENGTH),
        refresh_token: "t".repeat(AGENT_OAUTH_CREDENTIAL_MAX_LENGTH),
      }).toString(),
      "203.0.113.72",
    ),
  );
  assert.equal((await oauthError(acceptedTokenBoundary)).error, "invalid_grant");

  const acceptedRevocationBoundary = await revokeToken(
    formRequest(
      "revoke",
      new URLSearchParams({
        client_id: "c".repeat(AGENT_OAUTH_CLIENT_ID_MAX_LENGTH),
        token: "t".repeat(AGENT_OAUTH_CREDENTIAL_MAX_LENGTH),
      }).toString(),
      "203.0.113.73",
    ),
  );
  assert.equal(acceptedRevocationBoundary.status, 200);

  for (const [route, field, body, ip] of [
    [
      "token",
      "client_id",
      {
        grant_type: "refresh_token",
        client_id: "c".repeat(AGENT_OAUTH_CLIENT_ID_MAX_LENGTH + 1),
        refresh_token: "token",
      },
      "203.0.113.74",
    ],
    [
      "token",
      "refresh_token",
      {
        grant_type: "refresh_token",
        client_id: "client",
        refresh_token: "t".repeat(AGENT_OAUTH_CREDENTIAL_MAX_LENGTH + 1),
      },
      "203.0.113.75",
    ],
    [
      "revoke",
      "client_id",
      {
        client_id: "c".repeat(AGENT_OAUTH_CLIENT_ID_MAX_LENGTH + 1),
        token: "token",
      },
      "203.0.113.76",
    ],
    [
      "revoke",
      "token",
      {
        client_id: "client",
        token: "t".repeat(AGENT_OAUTH_CREDENTIAL_MAX_LENGTH + 1),
      },
      "203.0.113.77",
    ],
  ] as const) {
    const response =
      route === "token"
        ? await exchangeToken(formRequest(route, new URLSearchParams(body).toString(), ip))
        : await revokeToken(formRequest(route, new URLSearchParams(body).toString(), ip));
    assert.equal(response.status, 400);
    assert.deepEqual(await oauthError(response), {
      error: "invalid_request",
      error_description: `${field} must appear exactly once.`,
    });
  }
});

test("OAuth form endpoints reject oversized bodies before parsing them", async () => {
  const declaredTooLarge = await exchangeToken(
    formRequest("token", "grant_type=refresh_token", "203.0.113.78", {
      "content-length": String(AGENT_OAUTH_FORM_BODY_MAX_BYTES + 1),
    }),
  );
  assert.equal(declaredTooLarge.status, 413);
  assert.equal((await oauthError(declaredTooLarge)).error, "invalid_request");

  const measuredTooLarge = await revokeToken(
    formRequest("revoke", `ignored=${"x".repeat(AGENT_OAUTH_FORM_BODY_MAX_BYTES)}`, "203.0.113.79"),
  );
  assert.equal(measuredTooLarge.status, 413);
  assert.equal((await oauthError(measuredTooLarge)).error, "invalid_request");

  const deviceTooLarge = await startDeviceAuthorization(
    formRequest("device", `ignored=${"x".repeat(AGENT_OAUTH_FORM_BODY_MAX_BYTES)}`, "203.0.113.84"),
  );
  assert.equal(deviceTooLarge.status, 413);
  assert.equal((await oauthError(deviceTooLarge)).error, "invalid_request");
});

test("token exchange and revocation share strict form media-type and public-client rules", async () => {
  const invalidMediaType = "application/x-www-form-urlencoded-malformed";
  const tokenMediaType = await exchangeToken(
    formRequest("token", "", "203.0.113.80", { "content-type": invalidMediaType }),
  );
  const revokeMediaType = await revokeToken(
    formRequest("revoke", "", "203.0.113.81", { "content-type": invalidMediaType }),
  );
  assert.equal(tokenMediaType.status, 415);
  assert.equal(revokeMediaType.status, 415);

  const authorization = await revokeToken(
    formRequest("revoke", "client_id=client&token=token", "203.0.113.82", {
      authorization: "Basic ignored",
    }),
  );
  assert.equal(authorization.status, 401);
  assert.equal((await oauthError(authorization)).error, "invalid_client");

  const clientSecret = await revokeToken(
    formRequest("revoke", "client_id=client&token=token&client_secret=ignored", "203.0.113.83"),
  );
  assert.equal(clientSecret.status, 401);
  assert.equal((await oauthError(clientSecret)).error, "invalid_client");
});
