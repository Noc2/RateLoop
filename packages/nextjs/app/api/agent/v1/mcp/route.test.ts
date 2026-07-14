import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { POST } from "~~/app/api/agent/v1/mcp/route";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { tokenlessMcpTools } from "~~/lib/mcp/protocol";
import { __adaptiveReviewServiceTestUtils } from "~~/lib/tokenless/adaptiveReviewService";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";

const OWNER = "0x1111111111111111111111111111111111111111";
const originalSamplerKey = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
const originalSamplerVersion = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;

beforeEach(() => {
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = "99".repeat(32);
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = "sampler-route-v1";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSamplerKey === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = originalSamplerKey;
  if (originalSamplerVersion === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = originalSamplerVersion;
});

function request(value: unknown, token?: string) {
  return new NextRequest("https://rateloop-tokenless.vercel.app/api/agent/v1/mcp", {
    method: "POST",
    body: JSON.stringify(value),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function setup() {
  const { workspaceId } = await createWorkspace({ name: "Workspace MCP", ownerAddress: OWNER });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "mcp-agent",
    version: { displayName: "MCP Agent", provider: "OpenAI", model: "gpt-test", environment: "production" },
  });
  const audience = { source: "customer_invited", group: "mcp-test" };
  const audiencePolicyHash = __adaptiveReviewServiceTestUtils.sha256(audience);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled,
           agreement_threshold_bps, production_floor_bps, maximum_unreviewed_gap, rules_json,
           audience_policy_json, created_by, approved_by, created_at)
          VALUES ('arp_mcp', 1, ?, ?, ?, 'adaptive', true, 7000, 1000, 20, '{}', ?, ?, ?, ?)`,
    args: [
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      JSON.stringify(audience),
      OWNER.toLowerCase(),
      OWNER.toLowerCase(),
      new Date(),
    ],
  });
  const key = await createWorkspaceApiKey({
    workspaceId,
    name: "Workspace MCP",
    scopes: ["evaluation:read", "review:decide"],
  });
  return { workspaceId, agent, audiencePolicyHash, token: key.token };
}

test("uses a separate authenticated two-tool workspace surface without changing the public four tools", async () => {
  const setupData = await setup();
  const unauthenticated = await POST(request({ id: 1, jsonrpc: "2.0", method: "tools/list", params: {} }));
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).error.data.code, "authentication_required");

  const listed = await POST(request({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} }, setupData.token));
  const listedBody = await listed.json();
  assert.deepEqual(
    listedBody.result.tools.map((tool: { name: string }) => tool.name),
    ["rateloop_get_assurance_state", "rateloop_evaluate_review_requirement"],
  );
  assert.deepEqual(
    tokenlessMcpTools.map(tool => tool.name),
    ["rateloop_capabilities", "rateloop_create_handoff", "rateloop_get_handoff_status", "rateloop_get_result"],
  );
});

test("freezes a review decision and exposes only aggregate assurance state through authenticated MCP", async () => {
  const setupData = await setup();
  const args = {
    externalOpportunityId: "mcp-opportunity-0001",
    agentId: setupData.agent.agentId,
    agentVersionId: setupData.agent.currentVersion.versionId,
    policyId: "arp_mcp",
    policyVersion: 1,
    workflowKey: "support-reply",
    riskTier: "low",
    audiencePolicyHash: setupData.audiencePolicyHash,
    suggestionCommitment: __adaptiveReviewServiceTestUtils.sha256({ answer: "candidate" }),
    sourceEvidence: {
      reference: "case/mcp-opportunity-0001/revision-1",
      hash: __adaptiveReviewServiceTestUtils.sha256({ source: "mcp-opportunity-0001", revision: 1 }),
    },
    declaredConfidenceBps: 9200,
    metadataComplete: true,
  };
  const decided = await POST(
    request(
      {
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_evaluate_review_requirement", arguments: args },
      },
      setupData.token,
    ),
  );
  const decision = (await decided.json()).result.structuredContent;
  assert.equal(decision.decision, "required");
  assert.equal(decision.policyFrozen, true);
  assert.equal(decision.stage, "calibrating");
  assert.equal("sourceEvidenceReference" in decision, false);

  const stateResponse = await POST(
    request(
      {
        id: 4,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_get_assurance_state", arguments: { scopeId: decision.scopeId } },
      },
      setupData.token,
    ),
  );
  const state = (await stateResponse.json()).result.structuredContent;
  assert.equal(state.scopeId, decision.scopeId);
  assert.equal(state.reviewRateBps, 10_000);
  assert.equal(state.humanAgreementBps, null);
  assert.equal(state.nextReassessmentAfter, 30);
});
