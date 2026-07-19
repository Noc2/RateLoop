import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { DEFAULT_ADAPTIVE_AGREEMENT_THRESHOLD_BPS } from "~~/lib/tokenless/adaptiveReviewDefaults";
import {
  approveAgentPairing,
  authenticateAgentMcpPrincipal,
  createAgentPairing,
  listAgentConnections,
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
      maxFeeBps: 1_000,
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
  const policies = await dbClient.execute({
    sql: `SELECT agreement_threshold_bps FROM tokenless_agent_review_policies
          WHERE workspace_id = ? AND agent_id = ?`,
    args: [workspaceId, active.integration.agentId],
  });
  assert.equal(policies.rowCount, 1);
  assert.equal(Number(policies.rows[0]?.agreement_threshold_bps), DEFAULT_ADAPTIVE_AGREEMENT_THRESHOLD_BPS);

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

  const audit = await dbClient.execute({
    sql: `SELECT action, actor_reference, target_id, metadata_json
          FROM tokenless_audit_events
          WHERE workspace_id = ? AND action LIKE 'agent.%'
          ORDER BY sequence ASC`,
    args: [workspaceId],
  });
  assert.deepEqual(
    audit.rows.map(row => row.action),
    [
      "agent.pairing_created",
      "agent.pairing_claimed",
      "agent.integration_approved",
      "agent.integration_credential_rotated",
      "agent.integration_revoked",
    ],
  );
  const serializedAudit = JSON.stringify(audit.rows);
  assert.equal(serializedAudit.includes(issued.secret), false);
  assert.equal(serializedAudit.includes(rotated.secret), false);
});

test("owners can reject an untrusted claim without activating its bearer", async () => {
  const { workspaceId } = await fixture();
  const issued = await createAgentPairing({ accountAddress: OWNER, workspaceId, origin: "https://tokenless.example" });
  await rejectAgentPairing({ accountAddress: OWNER, workspaceId, pairingId: issued.pairing.pairingId });
  await assert.rejects(() => authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`), /no longer active/);
  const audit = await dbClient.execute({
    sql: `SELECT action FROM tokenless_audit_events
          WHERE workspace_id = ? AND action LIKE 'agent.%'
          ORDER BY sequence ASC`,
    args: [workspaceId],
  });
  assert.deepEqual(
    audit.rows.map(row => row.action),
    ["agent.pairing_created", "agent.pairing_rejected"],
  );
});

test("elapsed pairings expire on read and cannot be approved", async () => {
  const { workspaceId, policy } = await fixture();
  const issued = await createAgentPairing({ accountAddress: OWNER, workspaceId, origin: "https://tokenless.example" });
  const provisional = await authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`);
  assert.equal(provisional.kind, "pairing");
  if (provisional.kind !== "pairing") return;
  await submitAgentRegistration({
    pairing: provisional,
    registration: {
      externalId: "expired-agent",
      displayName: "Expired agent",
      provider: "unknown",
      model: "unknown",
      environment: "production",
      requestedWorkflowKeys: ["general-assistance"],
    },
  });
  await dbClient.execute({
    sql: "UPDATE tokenless_agent_pairing_sessions SET expires_at = ? WHERE pairing_id = ?",
    args: [new Date(Date.now() - 1_000), issued.pairing.pairingId],
  });

  const listed = await listAgentConnections({ accountAddress: OWNER, workspaceId });
  assert.equal(listed.pairings.find(row => row.pairingId === issued.pairing.pairingId)?.status, "expired");
  await assert.rejects(
    () =>
      approveAgentPairing({
        accountAddress: OWNER,
        workspaceId,
        pairingId: issued.pairing.pairingId,
        body: { publishingPolicyId: policy.policyId, allowedWorkflowKeys: ["general-assistance"] },
      }),
    /expired/,
  );
});
