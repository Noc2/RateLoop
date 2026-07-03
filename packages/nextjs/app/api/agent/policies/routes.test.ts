import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import {
  AGENT_POLICIES_CHALLENGE_TITLE,
  ROTATE_AGENT_POLICY_TOKEN_ACTION,
  hashAgentPolicyManagementPayload,
  normalizeAgentPolicyManagementInput,
} from "~~/lib/auth/agentPolicies";
import { AGENT_POLICIES_SIGNED_READ_SESSION_COOKIE_NAME, issueSignedReadSession } from "~~/lib/auth/signedReadSessions";
import { __setRateLimitStoreForTests } from "~~/utils/rateLimit";

type ChallengeRouteModule = typeof import("./challenge/route");
type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type PoliciesModule = typeof import("~~/lib/agent/policies");
type RecentRouteModule = typeof import("./recent/route");
type SignedActionsModule = typeof import("~~/lib/auth/signedActions");
type PoliciesRouteModule = typeof import("./route");
type StatusRouteModule = typeof import("./status/route");
type TokenRouteModule = typeof import("./token/route");

let challengeRoute: ChallengeRouteModule;
let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let policiesModule: PoliciesModule;
let policiesRoute: PoliciesRouteModule;
let recentRoute: RecentRouteModule;
let signedActions: SignedActionsModule;
let statusRoute: StatusRouteModule;
let tokenRoute: TokenRouteModule;

const env = process.env as Record<string, string | undefined>;
const originalAppUrl = env.APP_URL;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNextPublicAppUrl = env.NEXT_PUBLIC_APP_URL;
const originalTargetNetworks = env.NEXT_PUBLIC_TARGET_NETWORKS;
const originalNodeEnv = env.NODE_ENV;
const originalVercel = env.VERCEL;
const originalVercelEnv = env.VERCEL_ENV;
const originalVercelProjectProductionUrl = env.VERCEL_PROJECT_PRODUCTION_URL;
const originalVercelUrl = env.VERCEL_URL;

const OWNER_WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;
const AGENT_WALLET = "0x2234567890abcdef1234567890abcdef12345678" as const;

function makeMalformedRequest(path: string, method = "POST") {
  return new NextRequest(`https://rateloop.example${path}`, {
    body: "{",
    headers: new Headers({ "content-type": "application/json", "x-real-ip": "203.0.113.10" }),
    method,
  });
}

async function expectInvalidJson(response: Response) {
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    code: "invalid_arguments",
    message: "Invalid JSON body",
    recoverWith: "fix_request_and_retry",
    retryable: false,
    status: 400,
  });
}

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function configureTestEnv() {
  env.APP_URL = "https://canonical.rateloop.ai/app";
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "production";
  env.NEXT_PUBLIC_TARGET_NETWORKS = "4801";
  env.VERCEL = "1";
  delete env.NEXT_PUBLIC_APP_URL;
  delete env.VERCEL_ENV;
  delete env.VERCEL_PROJECT_PRODUCTION_URL;
  delete env.VERCEL_URL;
}

async function buildSignedManagementBody(policyId: string) {
  const body = {
    address: OWNER_WALLET,
    intent: "rotate_token",
    policyId,
  };
  const normalized = normalizeAgentPolicyManagementInput(body);
  assert.equal(normalized.ok, true);
  if (!normalized.ok) throw new Error("invalid test payload");

  const payloadHash = hashAgentPolicyManagementPayload(normalized.payload);
  const challenge = await signedActions.issueSignedActionChallenge({
    action: ROTATE_AGENT_POLICY_TOKEN_ACTION,
    payloadHash,
    title: AGENT_POLICIES_CHALLENGE_TITLE,
    walletAddress: OWNER_WALLET,
  });
  const signature = "0x1234";

  return {
    ...body,
    challengeId: challenge.challengeId,
    signature,
  };
}

before(async () => {
  configureTestEnv();
  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
  policiesModule = await import("~~/lib/agent/policies");
  signedActions = await import("~~/lib/auth/signedActions");
  __setRateLimitStoreForTests({
    execute: async input => {
      const sql = typeof input === "string" ? input : input.sql;
      if (sql.includes("api_rate_limits")) {
        return { rows: [{ request_count: 1 }] } as never;
      }
      return { rows: [] } as never;
    },
  });

  challengeRoute = await import("./challenge/route");
  policiesRoute = await import("./route");
  recentRoute = await import("./recent/route");
  statusRoute = await import("./status/route");
  tokenRoute = await import("./token/route");
});

beforeEach(() => {
  configureTestEnv();
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  signedActions.__setSignedActionVerificationClientForTests({
    async verifyMessage() {
      return true;
    },
  });
});

after(() => {
  __setRateLimitStoreForTests(null);
  signedActions.__setSignedActionVerificationClientForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("APP_URL", originalAppUrl);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NEXT_PUBLIC_APP_URL", originalNextPublicAppUrl);
  restoreEnv("NEXT_PUBLIC_TARGET_NETWORKS", originalTargetNetworks);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("VERCEL", originalVercel);
  restoreEnv("VERCEL_ENV", originalVercelEnv);
  restoreEnv("VERCEL_PROJECT_PRODUCTION_URL", originalVercelProjectProductionUrl);
  restoreEnv("VERCEL_URL", originalVercelUrl);
});

test("agent policy mutation routes reject malformed JSON with 400 responses", async () => {
  await expectInvalidJson(await challengeRoute.POST(makeMalformedRequest("/api/agent/policies/challenge")));
  await expectInvalidJson(await policiesRoute.POST(makeMalformedRequest("/api/agent/policies")));
  await expectInvalidJson(await policiesRoute.PUT(makeMalformedRequest("/api/agent/policies", "PUT")));
  await expectInvalidJson(await statusRoute.POST(makeMalformedRequest("/api/agent/policies/status")));
  await expectInvalidJson(await tokenRoute.POST(makeMalformedRequest("/api/agent/policies/token")));
  await expectInvalidJson(await tokenRoute.DELETE(makeMalformedRequest("/api/agent/policies/token", "DELETE")));
});

test("agent policy token rotation returns canonical MCP config URL in production", async () => {
  const policy = await policiesModule.upsertAgentPolicy(
    OWNER_WALLET,
    policiesModule.normalizeAgentPolicyInput({
      agentId: "policy_agent",
      agentWalletAddress: AGENT_WALLET,
      categories: [],
      dailyBudgetAtomic: "5000000",
      perAskLimitAtomic: "1000000",
      scopes: ["rateloop:ask"],
    }),
  );
  const signedBody = await buildSignedManagementBody(policy.id);

  const response = await tokenRoute.POST(
    new NextRequest("https://evil.example/api/agent/policies/token", {
      body: JSON.stringify(signedBody),
      headers: new Headers({ "content-type": "application/json", "x-real-ip": "203.0.113.10" }),
      method: "POST",
    }),
  );
  const body = (await response.json()) as {
    mcpConfig?: {
      mcpServers?: {
        rateloop?: {
          headers?: Record<string, string>;
          url?: string;
          walletAddress?: string;
        };
      };
    };
    token?: string;
  };
  const server = body.mcpConfig?.mcpServers?.rateloop;

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(String(body.token), /^rateloop_mcp_/);
  assert.equal(server?.url, "https://canonical.rateloop.ai/app/api/mcp");
  assert.equal(server?.headers?.Authorization, `Bearer ${body.token}`);
  assert.equal(server?.walletAddress, AGENT_WALLET);
});

test("agent policy recent route rejects malformed numeric limits", async () => {
  const session = await issueSignedReadSession(OWNER_WALLET, "agent_policies");
  const response = await recentRoute.GET(
    new NextRequest(
      `https://rateloop.example/api/agent/policies/recent?address=${OWNER_WALLET}&policyId=pol_test&limit=10junk`,
      {
        headers: new Headers({
          cookie: `${AGENT_POLICIES_SIGNED_READ_SESSION_COOKIE_NAME}=${session.token}`,
          "x-real-ip": "203.0.113.10",
        }),
        method: "GET",
      },
    ),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    code: "invalid_arguments",
    message: "limit must be a positive integer.",
    recoverWith: "fix_request_and_retry",
    retryable: false,
    status: 400,
  });
});
