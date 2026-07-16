import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET, POST } from "~~/app/api/agent/v1/assurance/review/route";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { __adaptiveReviewServiceTestUtils } from "~~/lib/tokenless/adaptiveReviewService";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const OWNER = "0x1111111111111111111111111111111111111111";
const originalSamplerKey = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
const originalSamplerVersion = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;

beforeEach(() => {
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = "55".repeat(32);
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = "sampler-rest-v1";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSamplerKey === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = originalSamplerKey;
  if (originalSamplerVersion === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = originalSamplerVersion;
});

function postRequest(value: unknown, token?: string, rawBody?: string) {
  return new NextRequest("https://rateloop-tokenless.vercel.app/api/agent/v1/assurance/review", {
    method: "POST",
    body: rawBody ?? JSON.stringify(value),
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

async function setup() {
  const { workspaceId } = await createWorkspace({ name: "Workspace REST", ownerAddress: OWNER });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "rest-agent",
    version: { displayName: "REST Agent", provider: "OpenAI", model: "gpt-test", environment: "production" },
  });
  const audience = { reviewerSource: "public_network" };
  const audiencePolicyHash = __adaptiveReviewServiceTestUtils.sha256(audience);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled,
           agreement_threshold_bps, production_floor_bps, maximum_unreviewed_gap, rules_json,
           audience_policy_json, created_by, approved_by, created_at)
          VALUES ('arp_rest', 1, ?, ?, ?, 'adaptive', true, 7000, 1000, 20, '{}', ?, ?, ?, ?)`,
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
  await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId: "arp_rest",
    actor: OWNER.toLowerCase(),
  });
  const key = await createWorkspaceApiKey({
    workspaceId,
    name: "Review REST",
    scopes: ["evaluation:read", "review:decide"],
  });
  const narrow = await createWorkspaceApiKey({ workspaceId, name: "Results only", scopes: ["result:read"] });
  return { workspaceId, agent, audiencePolicyHash, token: key.token, narrowToken: narrow.token };
}

function opportunity(input: Awaited<ReturnType<typeof setup>>) {
  return {
    externalOpportunityId: "rest-opportunity-0001",
    agentId: input.agent.agentId,
    agentVersionId: input.agent.currentVersion.versionId,
    policyId: "arp_rest",
    policyVersion: 1,
    workflowKey: "support-reply",
    riskTier: "low",
    audiencePolicyHash: input.audiencePolicyHash,
    suggestionCommitment: __adaptiveReviewServiceTestUtils.sha256({ answer: "candidate" }),
    sourceEvidence: {
      reference: "case/rest-opportunity-0001/revision-1",
      hash: __adaptiveReviewServiceTestUtils.sha256({ caseId: "rest-opportunity-0001", revision: 1 }),
    },
    declaredConfidenceBps: 9000,
    metadataComplete: true,
    execution: {
      externalExecutionId: "execution-rest-opportunity-0001",
      status: "completed",
      primarySpanId: "generation-primary",
      generationSpans: [
        {
          spanId: "generation-primary",
          role: "primary",
          provider: "OpenAI",
          requestedModel: "gpt-5.6-sol",
          reasoningEffort: "medium",
        },
      ],
    },
  };
}

test("REST review decisions require an API key with review:decide", async () => {
  const setupData = await setup();
  const missing = await POST(postRequest(opportunity(setupData)));
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).code, "workspace_api_key_required");
  assert.equal(missing.headers.get("cache-control"), "private, no-store, max-age=0");

  const narrow = await POST(postRequest(opportunity(setupData), setupData.narrowToken));
  assert.equal(narrow.status, 403);
  assert.equal((await narrow.json()).code, "insufficient_scope");
});

test("REST review decisions validate JSON and carry private no-store headers", async () => {
  const setupData = await setup();
  const malformed = await POST(postRequest(null, setupData.token, "{"));
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, "invalid_review_opportunity");
  assert.equal(malformed.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("REST creates a frozen decision and reads the resulting aggregate state", async () => {
  const setupData = await setup();
  const created = await POST(postRequest(opportunity(setupData), setupData.token));
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "private, no-store, max-age=0");
  const decision = await created.json();
  assert.equal(decision.policyFrozen, true);
  assert.equal(decision.decision, "required");

  const stateRequest = new NextRequest(
    `https://rateloop-tokenless.vercel.app/api/agent/v1/assurance/review?scopeId=${decision.scopeId}`,
    { headers: { authorization: `Bearer ${setupData.token}` } },
  );
  const stateResponse = await GET(stateRequest);
  assert.equal(stateResponse.status, 200);
  assert.equal(stateResponse.headers.get("cache-control"), "private, no-store, max-age=0");
  const state = await stateResponse.json();
  assert.equal(state.scopeId, decision.scopeId);
  assert.equal(state.reviewRateBps, 10_000);
  assert.equal(state.humanAgreementBps, null);
});
