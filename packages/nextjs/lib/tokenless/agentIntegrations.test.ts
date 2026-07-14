import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  approveAgentPairing,
  authenticateAgentMcpPrincipal,
  createAgentPairing,
  rejectAgentPairing,
  revokeAgentIntegration,
  rotateAgentIntegration,
  submitAgentRegistration,
} from "~~/lib/tokenless/agentIntegrations";
import { createAgentPublishingPolicy, createWorkspace } from "~~/lib/tokenless/productCore";

const OWNER = "0x1111111111111111111111111111111111111111";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function fixture() {
  const { workspaceId } = await createWorkspace({ name: "Pairing workspace", ownerAddress: OWNER });
  const policy = await createAgentPublishingPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: {
      name: "Connected agent",
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
      onPolicyMiss: "deny",
    },
  });
  return { workspaceId, policy };
}

test("one secret moves from restricted pairing to an exact active integration", async () => {
  const { workspaceId, policy } = await fixture();
  const issued = await createAgentPairing({ accountAddress: OWNER, workspaceId, origin: "https://tokenless.example" });
  const provisional = await authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`);
  assert.equal(provisional.kind, "pairing");
  if (provisional.kind !== "pairing") return;
  await submitAgentRegistration({
    pairing: provisional,
    registration: {
      externalId: "support-prod",
      displayName: "Support agent",
      provider: "OpenAI",
      model: "gpt-5",
      environment: "production",
      clientName: "Codex",
      requestedWorkflowKeys: ["support-reply"],
    },
  });
  const approved = await approveAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    pairingId: issued.pairing.pairingId,
    body: { publishingPolicyId: policy.policyId, allowedWorkflowKeys: ["support-reply"] },
  });
  const active = await authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`);
  assert.equal(active.kind, "integration");
  if (active.kind !== "integration") return;
  assert.equal(active.integration.integrationId, approved.integration.integrationId);
  assert.equal(active.integration.agentId, approved.agent.agentId);
  assert.equal(active.integration.enforcementMode, "advisory");
  assert.deepEqual(active.integration.allowedWorkflowKeys, ["support-reply"]);

  const rotated = await rotateAgentIntegration({
    accountAddress: OWNER,
    workspaceId,
    integrationId: active.integration.integrationId,
    origin: "https://tokenless.example",
  });
  await assert.rejects(() => authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`), /Invalid agent credential/);
  assert.equal((await authenticateAgentMcpPrincipal(`Bearer ${rotated.secret}`)).kind, "integration");

  await revokeAgentIntegration({ accountAddress: OWNER, workspaceId, integrationId: active.integration.integrationId });
  await assert.rejects(
    () => authenticateAgentMcpPrincipal(`Bearer ${rotated.secret}`),
    /inactive|Invalid agent credential/,
  );
});

test("owners can reject an untrusted claim without activating its bearer", async () => {
  const { workspaceId } = await fixture();
  const issued = await createAgentPairing({ accountAddress: OWNER, workspaceId, origin: "https://tokenless.example" });
  await rejectAgentPairing({ accountAddress: OWNER, workspaceId, pairingId: issued.pairing.pairingId });
  await assert.rejects(() => authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`), /no longer active/);
});
