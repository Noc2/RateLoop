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

function stateRequest(scopeId: string, token: string) {
  return new NextRequest(`https://rateloop-tokenless.vercel.app/api/agent/v1/assurance/review?scopeId=${scopeId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

const audience = { reviewerSource: "public_network" };

async function activateEarlyAccess(workspaceId: string) {
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
}

async function seedBoundAgent(input: {
  workspaceId: string;
  externalId: string;
  policyId: string;
  integrationId: string;
  allowedWorkflowKeys: string[];
}) {
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId: input.workspaceId,
    externalId: input.externalId,
    version: { displayName: "REST Agent", provider: "OpenAI", model: "gpt-test", environment: "production" },
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled,
           agreement_threshold_bps, production_floor_bps, maximum_unreviewed_gap, rules_json,
           audience_policy_json, created_by, approved_by, created_at)
          VALUES (?, 1, ?, ?, ?, 'adaptive', true, 7000, 1000, 20, '{}', ?, ?, ?, ?)`,
    args: [
      input.policyId,
      input.workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      JSON.stringify(audience),
      OWNER.toLowerCase(),
      OWNER.toLowerCase(),
      new Date(),
    ],
  });
  const binding = await seedReadyHumanReviewBinding({
    workspaceId: input.workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId: input.policyId,
    actor: OWNER.toLowerCase(),
  });
  const key = await createWorkspaceApiKey({
    workspaceId: input.workspaceId,
    name: `Review REST ${input.externalId}`,
    scopes: ["evaluation:read", "review:decide"],
  });
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 7 * 86_400_000);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_pairing_sessions
          (pairing_id, workspace_id, api_key_id, credential_hash, credential_prefix, status,
           created_by, resolved_by, created_at, expires_at, approved_at)
          VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?)`,
    args: [
      `apr_${input.externalId}`,
      input.workspaceId,
      key.apiKeyId,
      `credential-${input.integrationId}`,
      input.integrationId.slice(0, 20),
      OWNER,
      OWNER,
      createdAt,
      expiresAt,
      createdAt,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_integrations
          (integration_id, pairing_id, workspace_id, agent_id, agent_version_id,
           review_policy_id, review_policy_version, api_key_id, status, enforcement_mode,
           allowed_workflow_keys_json, granted_scopes_json, credential_expires_at,
           human_review_binding_id, human_review_binding_version, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'active', 'advisory', ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.integrationId,
      `apr_${input.externalId}`,
      input.workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      input.policyId,
      key.apiKeyId,
      JSON.stringify(input.allowedWorkflowKeys),
      JSON.stringify(["evaluation:read", "review:decide", "result:read"]),
      expiresAt,
      binding.bindingId,
      binding.bindingVersion,
      OWNER,
      createdAt,
      createdAt,
    ],
  });
  return { agent, token: key.token, policyId: input.policyId };
}

async function setup() {
  const { workspaceId } = await createWorkspace({ name: "Workspace REST", ownerAddress: OWNER });
  await activateEarlyAccess(workspaceId);
  const audiencePolicyHash = __adaptiveReviewServiceTestUtils.sha256(audience);
  const bound = await seedBoundAgent({
    workspaceId,
    externalId: "rest-agent",
    policyId: "arp_rest",
    integrationId: "agi_rest",
    allowedWorkflowKeys: ["support-reply"],
  });
  const other = await seedBoundAgent({
    workspaceId,
    externalId: "rest-agent-other",
    policyId: "arp_rest_other",
    integrationId: "agi_rest_other",
    allowedWorkflowKeys: ["support-reply"],
  });
  const narrow = await createWorkspaceApiKey({ workspaceId, name: "Results only", scopes: ["result:read"] });
  const unbound = await createWorkspaceApiKey({
    workspaceId,
    name: "No integration",
    scopes: ["evaluation:read", "review:decide"],
  });
  return {
    workspaceId,
    agent: bound.agent,
    other,
    audiencePolicyHash,
    token: bound.token,
    narrowToken: narrow.token,
    unboundToken: unbound.token,
  };
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

test("REST review endpoints refuse credentials without an active agent integration", async () => {
  const setupData = await setup();
  const posted = await POST(postRequest(opportunity(setupData), setupData.unboundToken));
  assert.equal(posted.status, 401);
  assert.equal((await posted.json()).code, "agent_integration_inactive");

  const read = await GET(stateRequest("evs_anything", setupData.unboundToken));
  assert.equal(read.status, 401);
  assert.equal((await read.json()).code, "agent_integration_inactive");
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

  const stateResponse = await GET(stateRequest(decision.scopeId, setupData.token));
  assert.equal(stateResponse.status, 200);
  assert.equal(stateResponse.headers.get("cache-control"), "private, no-store, max-age=0");
  const state = await stateResponse.json();
  assert.equal(state.scopeId, decision.scopeId);
  assert.equal(state.reviewRateBps, 10_000);
  assert.equal(state.humanAgreementBps, null);
});

test("REST assurance state is unreadable from another bound agent's credential", async () => {
  const setupData = await setup();
  const created = await POST(postRequest(opportunity(setupData), setupData.token));
  assert.equal(created.status, 201);
  const decision = await created.json();

  const crossAgent = await GET(stateRequest(decision.scopeId, setupData.other.token));
  assert.equal(crossAgent.status, 404);
  assert.equal((await crossAgent.json()).code, "assurance_state_not_found");
  assert.equal(crossAgent.headers.get("cache-control"), "private, no-store, max-age=0");

  const owned = await GET(stateRequest(decision.scopeId, setupData.token));
  assert.equal(owned.status, 200);
  assert.equal((await owned.json()).scopeId, decision.scopeId);
});

test("REST review decisions reject a caller-supplied agent or policy the credential is not bound to", async () => {
  const setupData = await setup();
  const foreignAgent = await POST(
    postRequest({ ...opportunity(setupData), agentId: setupData.other.agent.agentId }, setupData.token),
  );
  assert.equal(foreignAgent.status, 409);
  assert.equal((await foreignAgent.json()).code, "human_review_integration_binding_mismatch");

  const foreignPolicy = await POST(
    postRequest({ ...opportunity(setupData), policyId: "arp_rest_other" }, setupData.token),
  );
  assert.equal(foreignPolicy.status, 409);
  assert.equal((await foreignPolicy.json()).code, "human_review_integration_binding_mismatch");

  const foreignVersion = await POST(postRequest({ ...opportunity(setupData), policyVersion: 2 }, setupData.token));
  assert.equal(foreignVersion.status, 409);
  assert.equal((await foreignVersion.json()).code, "human_review_integration_binding_mismatch");
});

test("REST review decisions enforce the integration workflow allow-list", async () => {
  const setupData = await setup();
  const disallowed = await POST(
    postRequest({ ...opportunity(setupData), workflowKey: "billing-refund" }, setupData.token),
  );
  assert.equal(disallowed.status, 403);
  assert.equal((await disallowed.json()).code, "workflow_not_allowed");
  assert.equal(disallowed.headers.get("cache-control"), "private, no-store, max-age=0");
});
