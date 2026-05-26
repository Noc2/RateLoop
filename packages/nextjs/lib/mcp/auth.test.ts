import { MCP_SCOPES, McpAuthError, authenticateMcpRequest, getConfiguredMcpAgents } from "./auth";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import {
  AgentPolicyLifecycleError,
  hashMcpBearerToken,
  normalizeAgentPolicyInput,
  rotateAgentPolicyToken,
  updateAgentPolicyStatus,
  upsertAgentPolicy,
} from "~~/lib/agent/policies";

const env = process.env as Record<string, string | undefined>;
const originalAgents = env.RATELOOP_MCP_AGENTS;
const originalAllowUnlimitedBudget = env.RATELOOP_MCP_ALLOW_UNLIMITED_BUDGET;
const originalBearerScopes = env.RATELOOP_MCP_BEARER_SCOPES;
const originalBearerToken = env.RATELOOP_MCP_BEARER_TOKEN;
const originalDailyBudget = env.RATELOOP_MCP_DAILY_BUDGET_USDC;
const originalDatabaseUrl = env.DATABASE_URL;
const originalPerAskLimit = env.RATELOOP_MCP_PER_ASK_LIMIT_USDC;
let dbModule: typeof import("../db");
let dbTestMemory: typeof import("../db/testMemory");

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requestWithToken(token?: string) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request("https://rateloop.xyz/api/mcp", { headers });
}

before(async () => {
  env.DATABASE_URL = "memory:";
  dbModule = await import("../db");
  dbTestMemory = await import("../db/testMemory");
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
});

beforeEach(async () => {
  delete env.RATELOOP_MCP_ALLOW_UNLIMITED_BUDGET;
  delete env.RATELOOP_MCP_BEARER_SCOPES;
  delete env.RATELOOP_MCP_BEARER_TOKEN;
  delete env.RATELOOP_MCP_DAILY_BUDGET_USDC;
  delete env.RATELOOP_MCP_PER_ASK_LIMIT_USDC;
  env.RATELOOP_MCP_AGENTS = JSON.stringify([
    {
      dailyBudgetAtomic: "5000000",
      id: "agent-a",
      perAskLimitAtomic: "1000000",
      scopes: [MCP_SCOPES.ask, MCP_SCOPES.quote, MCP_SCOPES.read],
      tokenHash: sha256("secret-token"),
    },
  ]);
  await dbModule.dbClient.execute("DELETE FROM agent_wallet_policy_audit_records");
  await dbModule.dbClient.execute("DELETE FROM agent_wallet_policies");
});

after(() => {
  dbModule.__setDatabaseResourcesForTests(null);
  if (originalAgents === undefined) {
    delete env.RATELOOP_MCP_AGENTS;
  } else {
    env.RATELOOP_MCP_AGENTS = originalAgents;
  }

  if (originalAllowUnlimitedBudget === undefined) {
    delete env.RATELOOP_MCP_ALLOW_UNLIMITED_BUDGET;
  } else {
    env.RATELOOP_MCP_ALLOW_UNLIMITED_BUDGET = originalAllowUnlimitedBudget;
  }

  if (originalBearerScopes === undefined) {
    delete env.RATELOOP_MCP_BEARER_SCOPES;
  } else {
    env.RATELOOP_MCP_BEARER_SCOPES = originalBearerScopes;
  }

  if (originalBearerToken === undefined) {
    delete env.RATELOOP_MCP_BEARER_TOKEN;
  } else {
    env.RATELOOP_MCP_BEARER_TOKEN = originalBearerToken;
  }

  if (originalDailyBudget === undefined) {
    delete env.RATELOOP_MCP_DAILY_BUDGET_USDC;
  } else {
    env.RATELOOP_MCP_DAILY_BUDGET_USDC = originalDailyBudget;
  }

  if (originalDatabaseUrl === undefined) {
    delete env.DATABASE_URL;
  } else {
    env.DATABASE_URL = originalDatabaseUrl;
  }

  if (originalPerAskLimit === undefined) {
    delete env.RATELOOP_MCP_PER_ASK_LIMIT_USDC;
  } else {
    env.RATELOOP_MCP_PER_ASK_LIMIT_USDC = originalPerAskLimit;
  }
});

test("getConfiguredMcpAgents loads hashed bearer agents", () => {
  const [agent] = getConfiguredMcpAgents();

  assert.equal(agent.id, "agent-a");
  assert.equal(agent.dailyBudgetAtomic, 5_000_000n);
  assert.equal(agent.perAskLimitAtomic, 1_000_000n);
  assert.equal(agent.scopes.has(MCP_SCOPES.ask), true);
});

test("getConfiguredMcpAgents requires positive budgets for static ask tokens", () => {
  delete env.RATELOOP_MCP_AGENTS;
  env.RATELOOP_MCP_BEARER_TOKEN = "static-token";

  assert.throws(() => getConfiguredMcpAgents(), /must be positive for static rateloop:ask tokens/);

  env.RATELOOP_MCP_DAILY_BUDGET_USDC = "5000000";
  env.RATELOOP_MCP_PER_ASK_LIMIT_USDC = "1000000";

  const [agent] = getConfiguredMcpAgents();
  assert.equal(agent.dailyBudgetAtomic, 5_000_000n);
  assert.equal(agent.perAskLimitAtomic, 1_000_000n);
});

test("getConfiguredMcpAgents permits static read-only and explicit unlimited tokens", () => {
  delete env.RATELOOP_MCP_AGENTS;
  env.RATELOOP_MCP_BEARER_TOKEN = "static-token";
  env.RATELOOP_MCP_BEARER_SCOPES = MCP_SCOPES.read;

  let [agent] = getConfiguredMcpAgents();
  assert.equal(agent.dailyBudgetAtomic, 0n);
  assert.equal(agent.perAskLimitAtomic, 0n);

  env.RATELOOP_MCP_BEARER_SCOPES = MCP_SCOPES.ask;
  env.RATELOOP_MCP_ALLOW_UNLIMITED_BUDGET = "true";

  [agent] = getConfiguredMcpAgents();
  assert.equal(agent.scopes.has(MCP_SCOPES.ask), true);
  assert.equal(agent.dailyBudgetAtomic, 0n);
  assert.equal(agent.perAskLimitAtomic, 0n);
});

test("authenticateMcpRequest accepts valid bearer token and scope", async () => {
  const agent = await authenticateMcpRequest(requestWithToken("secret-token"), MCP_SCOPES.ask);

  assert.equal(agent.id, "agent-a");
});

test("authenticateMcpRequest rejects missing scopes", async () => {
  await assert.rejects(
    () => authenticateMcpRequest(requestWithToken("secret-token"), MCP_SCOPES.balance),
    (error: unknown) => error instanceof McpAuthError && error.status === 403,
  );
});

test("authenticateMcpRequest rejects invalid bearer tokens", async () => {
  await assert.rejects(
    () => authenticateMcpRequest(requestWithToken("wrong"), MCP_SCOPES.ask),
    (error: unknown) => error instanceof McpAuthError && error.status === 401,
  );
});

test("authenticateMcpRequest accepts active DB-backed policy tokens", async () => {
  delete env.RATELOOP_MCP_AGENTS;
  await dbModule.dbClient.execute({
    sql: `
      INSERT INTO agent_wallet_policies (
        id, owner_wallet_address, agent_id, agent_wallet_address, status, scopes, categories,
        daily_budget_atomic, per_ask_limit_atomic, token_hash, token_issued_at,
        expires_at, created_at, updated_at, revoked_at
      )
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NOW(), NULL, NOW(), NOW(), NULL)
    `,
    args: [
      "agent_policy_test",
      "0x00000000000000000000000000000000000000aa",
      "research-agent",
      "0x00000000000000000000000000000000000000bb",
      JSON.stringify([MCP_SCOPES.ask, MCP_SCOPES.balance]),
      JSON.stringify(["6"]),
      "9000000",
      "3000000",
      hashMcpBearerToken("db-token"),
    ],
  });

  const agent = await authenticateMcpRequest(requestWithToken("db-token"), MCP_SCOPES.ask);

  assert.equal(agent.id, "agent_policy_test");
  assert.equal(agent.walletAddress, "0x00000000000000000000000000000000000000bb");
  assert.equal(agent.perAskLimitAtomic, 3_000_000n);
  assert.equal(agent.allowedCategoryIds?.has("6"), true);
});

test("agent policy token rotation does not revive paused or revoked policies", async () => {
  const ownerWalletAddress = "0x00000000000000000000000000000000000000aa";
  const agentWalletAddress = "0x00000000000000000000000000000000000000bb";
  const createdPolicy = await upsertAgentPolicy(
    ownerWalletAddress,
    normalizeAgentPolicyInput({
      agentId: "research-agent",
      agentWalletAddress,
      categories: ["6"],
      dailyBudgetAtomic: "9000000",
      perAskLimitAtomic: "3000000",
      scopes: [MCP_SCOPES.ask, MCP_SCOPES.balance],
    }),
  );
  const pausedPolicy = await updateAgentPolicyStatus({
    ownerWalletAddress,
    policyId: createdPolicy.id,
    status: "paused",
  });

  const rotated = await rotateAgentPolicyToken({ ownerWalletAddress, policyId: pausedPolicy.id });

  assert.equal(rotated.policy.status, "paused");

  await updateAgentPolicyStatus({ ownerWalletAddress, policyId: createdPolicy.id, status: "revoked" });
  await assert.rejects(
    () => rotateAgentPolicyToken({ ownerWalletAddress, policyId: createdPolicy.id }),
    (error: unknown) => error instanceof AgentPolicyLifecycleError,
  );
  await assert.rejects(
    () => updateAgentPolicyStatus({ ownerWalletAddress, policyId: createdPolicy.id, status: "active" }),
    (error: unknown) => error instanceof AgentPolicyLifecycleError,
  );
  await assert.rejects(
    () =>
      upsertAgentPolicy(
        ownerWalletAddress,
        normalizeAgentPolicyInput({
          agentId: "research-agent",
          agentWalletAddress,
          categories: ["6"],
          dailyBudgetAtomic: "9000000",
          perAskLimitAtomic: "3000000",
          policyId: createdPolicy.id,
          scopes: [MCP_SCOPES.ask, MCP_SCOPES.balance],
        }),
      ),
    (error: unknown) => error instanceof AgentPolicyLifecycleError,
  );
});

test("normalizeAgentPolicyInput defaults blank agent ids to the agent wallet", () => {
  const agentWalletAddress = "0x00000000000000000000000000000000000000bb";
  const normalized = normalizeAgentPolicyInput({
    agentId: "",
    agentWalletAddress,
    categories: [],
    dailyBudgetAtomic: "0",
    perAskLimitAtomic: "0",
    scopes: [],
  });

  assert.equal(normalized.agentId, agentWalletAddress);
  assert.equal(normalized.dailyBudgetAtomic, "0");
  assert.equal(normalized.perAskLimitAtomic, "0");
  assert.deepEqual(normalized.scopes, [MCP_SCOPES.ask, MCP_SCOPES.balance, MCP_SCOPES.quote, MCP_SCOPES.read].sort());
});
