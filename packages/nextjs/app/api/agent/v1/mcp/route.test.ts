import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { POST } from "~~/app/api/agent/v1/mcp/route";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { tokenlessMcpTools } from "~~/lib/mcp/protocol";
import { __adaptiveReviewServiceTestUtils } from "~~/lib/tokenless/adaptiveReviewService";
import {
  approveAgentPairing,
  authenticateAgentMcpPrincipal,
  createAgentPairing,
  submitAgentRegistration,
} from "~~/lib/tokenless/agentIntegrations";
import { createAgentPublishingPolicy, createWorkspace } from "~~/lib/tokenless/productCore";

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
  const publishing = await createAgentPublishingPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: {
      name: "MCP policy",
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "30000000",
      maxDailyAtomic: "100000000",
      maxMonthlyAtomic: "1000000000",
      maxPanelSize: 15,
      maxBountyAtomic: "20000000",
      maxFeeBps: 750,
      maxAttemptReserveAtomic: "5000000",
      allowedReviewerSources: ["customer_invited"],
      allowedAdmissionPolicyHashes: [`0x${"11".repeat(32)}`],
      allowedDataClassifications: ["internal"],
    },
  });
  const audience = { reviewerSource: "private_invited" };
  const audiencePolicyHash = __adaptiveReviewServiceTestUtils.sha256(audience);
  const issued = await createAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.vercel.app",
  });
  const provisional = await authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`);
  assert.equal(provisional.kind, "pairing");
  if (provisional.kind !== "pairing") throw new Error("Pairing principal expected.");
  await submitAgentRegistration({
    pairing: provisional,
    registration: {
      externalId: "mcp-agent",
      displayName: "MCP Agent",
      provider: "OpenAI",
      model: "gpt-test",
      environment: "production",
      requestedWorkflowKeys: ["support-reply"],
    },
  });
  const approved = await approveAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    pairingId: issued.pairing.pairingId,
    body: { publishingPolicyId: publishing.policyId, allowedWorkflowKeys: ["support-reply"] },
  });
  return { workspaceId, approved, audiencePolicyHash, token: issued.secret };
}

test("pairing initialization tells the agent to register immediately and returns the next automatic action", async () => {
  const { workspaceId } = await createWorkspace({ name: "Automatic pairing", ownerAddress: OWNER });
  const issued = await createAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.vercel.app",
  });
  const initialized = await POST(
    request(
      {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "automatic-agent", version: "1.0.0" },
        },
      },
      issued.secret,
    ),
  );
  const initializedBody = await initialized.json();
  assert.match(initializedBody.result.instructions, /Act immediately without asking the user/);
  assert.match(initializedBody.result.instructions, /call rateloop_register_agent exactly once/);

  const listed = await POST(request({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} }, issued.secret));
  const listedBody = await listed.json();
  assert.deepEqual(
    listedBody.result.tools.map((tool: { name: string }) => tool.name),
    ["rateloop_register_agent", "rateloop_get_registration_status"],
  );
  assert.match(listedBody.result.tools[0].description, /Call immediately after connecting/);

  const registered = await POST(
    request(
      {
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "rateloop_register_agent",
          arguments: {
            externalId: "automatic-agent",
            displayName: "Automatic Agent",
            provider: "OpenAI",
            model: "gpt-test",
            environment: "production",
            requestedWorkflowKeys: ["general-assistance"],
          },
        },
      },
      issued.secret,
    ),
  );
  const registration = (await registered.json()).result.structuredContent;
  assert.equal(registration.registration.status, "claimed");
  assert.equal(registration.pollAfterMs, 3_000);
  assert.match(registration.nextAction, /rateloop_get_registration_status/);
});

test("uses a bound authenticated workspace surface without changing the public four tools", async () => {
  const setupData = await setup();
  const unauthenticated = await POST(request({ id: 1, jsonrpc: "2.0", method: "tools/list", params: {} }));
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).error.data.code, "invalid_agent_credential");

  const listed = await POST(request({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} }, setupData.token));
  const listedBody = await listed.json();
  assert.deepEqual(
    listedBody.result.tools.map((tool: { name: string }) => tool.name),
    [
      "rateloop_get_agent_context",
      "rateloop_get_assurance_state",
      "rateloop_evaluate_review_requirement",
      "rateloop_request_review",
      "rateloop_wait_for_review",
      "rateloop_get_review_result",
    ],
  );
  assert.deepEqual(
    tokenlessMcpTools.map(tool => tool.name),
    ["rateloop_capabilities", "rateloop_create_handoff", "rateloop_get_handoff_status", "rateloop_get_result"],
  );

  const approvalTransition = await POST(
    request(
      {
        id: 21,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_get_registration_status", arguments: {} },
      },
      setupData.token,
    ),
  );
  const approval = (await approvalTransition.json()).result.structuredContent;
  assert.equal(approval.registration.status, "approved");
  assert.equal(approval.integration.integrationId, setupData.approved.integration.integrationId);
  assert.match(approval.nextAction, /rateloop_get_agent_context/);
});

test("injects bound identity into review decisions and rejects caller spoofing", async () => {
  const setupData = await setup();
  const args = {
    externalOpportunityId: "mcp-opportunity-0001",
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

  const spoofed = await POST(
    request(
      {
        id: 31,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_evaluate_review_requirement", arguments: { ...args, agentId: "agt_spoofed" } },
      },
      setupData.token,
    ),
  );
  assert.equal((await spoofed.json()).result.isError, true);

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
