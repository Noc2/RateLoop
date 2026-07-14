import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import {
  __reviewPolicyManagementTestUtils,
  createManagedReviewPolicy,
  disableManagedReviewPolicy,
  listManagedReviewPolicies,
  updateManagedReviewPolicy,
} from "~~/lib/tokenless/reviewPolicyManagement";

const OWNER = "0x1111111111111111111111111111111111111111";
const MEMBER = "0x2222222222222222222222222222222222222222";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function fixture() {
  const { workspaceId } = await createWorkspace({ name: "Adaptive policy", ownerAddress: OWNER });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "support-agent",
    version: {
      displayName: "Support agent",
      description: "Answers customer support questions.",
      provider: "OpenAI",
      model: "gpt-5",
      modelVersion: "2026-07-14",
      deploymentName: "support-production",
      environment: "production",
    },
  });
  return { workspaceId, agent };
}

function adaptivePolicy(agentId: string, agentVersionId: string) {
  return {
    agentId,
    agentVersionId,
    mode: "adaptive",
    enforcementMode: "advisory",
    agreementThresholdBps: 9_000,
    productionFloorBps: 1_000,
    maximumUnreviewedGap: 20,
    requiredRiskTiers: ["high"],
    criticalRiskTiers: ["critical"],
    minimumConfidenceBps: 7_000,
    maximumLatencyMs: 120_000,
    audience: "private_invited",
  };
}

test("owners create review policies bound to exact immutable agent versions", async () => {
  const { workspaceId, agent } = await fixture();
  const created = await createManagedReviewPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: adaptivePolicy(agent.agentId, agent.currentVersion.versionId),
  });

  assert.equal(created.version, 1);
  assert.equal(created.mode, "adaptive");
  assert.equal(created.enforcementMode, "advisory");
  assert.equal(created.agentVersionId, agent.currentVersion.versionId);
  assert.equal(created.safetyFloors.minimumReviewRateBps, 1_000);
  assert.match(created.audiencePolicyHash, /^sha256:[a-f0-9]{64}$/);

  const registry = await listManagedReviewPolicies({ accountAddress: OWNER, workspaceId });
  assert.equal(registry.agents[0]?.displayName, "Support agent");
  assert.equal(registry.policies[0]?.policyId, created.policyId);
});

test("policy edits append immutable versions and reset future adaptive scopes without rewriting history", async () => {
  const { workspaceId, agent } = await fixture();
  const initial = await createManagedReviewPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: adaptivePolicy(agent.agentId, agent.currentVersion.versionId),
  });
  const updated = await updateManagedReviewPolicy({
    accountAddress: OWNER,
    workspaceId,
    policyId: initial.policyId,
    policy: {
      ...adaptivePolicy(agent.agentId, agent.currentVersion.versionId),
      enforcementMode: "host_enforced",
      agreementThresholdBps: 9_500,
      productionFloorBps: 2_500,
    },
  });

  assert.equal(updated.policyId, initial.policyId);
  assert.equal(updated.version, 2);
  assert.equal(updated.enforcementMode, "host_enforced");
  assert.equal(updated.productionFloorBps, 2_500);
  const stored = await dbClient.execute({
    sql: `SELECT version, enabled, superseded_at FROM tokenless_agent_review_policies
          WHERE workspace_id = ? AND policy_id = ? ORDER BY version`,
    args: [workspaceId, initial.policyId],
  });
  assert.equal(stored.rowCount, 2);
  assert.equal(stored.rows[0]?.enabled, false);
  assert.ok(stored.rows[0]?.superseded_at);
  assert.equal(stored.rows[1]?.enabled, true);
  assert.equal(stored.rows[1]?.superseded_at, null);
});

test("unsafe or misleading policy combinations fail closed", async () => {
  const { workspaceId, agent } = await fixture();
  const policy = adaptivePolicy(agent.agentId, agent.currentVersion.versionId);
  await assert.rejects(
    () =>
      createManagedReviewPolicy({
        accountAddress: OWNER,
        workspaceId,
        policy: { ...policy, productionFloorBps: 0 },
      }),
    /cannot fall below the 10% production floor/,
  );
  await assert.rejects(
    () =>
      createManagedReviewPolicy({
        accountAddress: OWNER,
        workspaceId,
        policy: { ...policy, mode: "manual", enforcementMode: "host_enforced" },
      }),
    /Manual handoffs are advisory/,
  );
  await createManagedReviewPolicy({ accountAddress: OWNER, workspaceId, policy });
  await assert.rejects(
    () => createManagedReviewPolicy({ accountAddress: OWNER, workspaceId, policy }),
    /already has an active review policy/,
  );
  assert.equal(
    __reviewPolicyManagementTestUtils.normalizeInput({
      ...policy,
      mode: "always",
      productionFloorBps: 5_000,
    }).productionFloorBps,
    0,
  );
  assert.throws(
    () => __reviewPolicyManagementTestUtils.normalizeInput({ ...policy, misspelledFloor: 1_000 }),
    /unknown fields/,
  );
});

test("members cannot read, mutate, or disable workspace review policies", async () => {
  const { workspaceId, agent } = await fixture();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [workspaceId, MEMBER, new Date()],
  });
  const created = await createManagedReviewPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: adaptivePolicy(agent.agentId, agent.currentVersion.versionId),
  });

  await assert.rejects(() => listManagedReviewPolicies({ accountAddress: MEMBER, workspaceId }), /Workspace not found/);
  await assert.rejects(
    () => disableManagedReviewPolicy({ accountAddress: MEMBER, workspaceId, policyId: created.policyId }),
    /Workspace not found/,
  );
  await disableManagedReviewPolicy({ accountAddress: OWNER, workspaceId, policyId: created.policyId });
  const active = await listManagedReviewPolicies({ accountAddress: OWNER, workspaceId });
  assert.equal(active.policies.length, 0);
});
