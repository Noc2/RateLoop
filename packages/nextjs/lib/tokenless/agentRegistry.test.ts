import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  createWorkspaceAgent,
  createWorkspaceAgentVersion,
  deactivateWorkspaceAgent,
  listWorkspaceAgents,
} from "~~/lib/tokenless/agentRegistry";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const OWNER = "0x1111111111111111111111111111111111111111";
const MEMBER = "0x2222222222222222222222222222222222222222";
const OUTSIDER = "0x3333333333333333333333333333333333333333";
const ADMIN = "0x4444444444444444444444444444444444444444";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

function version(modelVersion: string) {
  return {
    displayName: "Support quality agent",
    description: "Reviews support responses before customer delivery.",
    provider: "OpenAI",
    model: "gpt-5",
    modelVersion,
    deploymentName: "support-prod",
    environment: "production" as const,
  };
}

test("agent updates append immutable declared-model versions and preserve earlier snapshots", async () => {
  const { workspaceId } = await createWorkspace({ name: "Agent registry", ownerAddress: OWNER });
  const created = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "support-agent-prod",
    version: version("2026-07-01"),
  });
  assert.equal(created.currentVersion.versionNumber, 1);
  assert.equal(created.currentVersion.declaredModelVersion, "2026-07-01");
  assert.match(created.currentVersion.configurationCommitment, /^[a-f0-9]{64}$/);

  const updated = await createWorkspaceAgentVersion({
    accountAddress: OWNER,
    workspaceId,
    agentId: created.agentId,
    version: { ...version("2026-07-14"), displayName: "Support quality agent v2" },
  });
  assert.equal(updated.currentVersion.versionNumber, 2);
  assert.equal(updated.currentVersion.displayName, "Support quality agent v2");
  assert.deepEqual(
    updated.versions.map(item => [item.versionNumber, item.declaredModelVersion]),
    [
      [2, "2026-07-14"],
      [1, "2026-07-01"],
    ],
  );
  assert.notEqual(updated.versions[0]?.configurationCommitment, updated.versions[1]?.configurationCommitment);

  const stored = await dbClient.execute({
    sql: `SELECT version_number, display_name, declared_model_version, configuration_commitment
          FROM tokenless_agent_versions WHERE agent_id = ? ORDER BY version_number`,
    args: [created.agentId],
  });
  assert.equal(stored.rowCount, 2);
  assert.equal(stored.rows[0]?.display_name, "Support quality agent");
  assert.equal(stored.rows[0]?.declared_model_version, "2026-07-01");
  assert.match(String(stored.rows[0]?.configuration_commitment), /^[a-f0-9]{64}$/);
  assert.equal(stored.rows[1]?.display_name, "Support quality agent v2");

  await assert.rejects(
    () =>
      createWorkspaceAgentVersion({
        accountAddress: OWNER,
        workspaceId,
        agentId: created.agentId,
        version: { ...version("2026-07-14"), displayName: "Support quality agent v2" },
      }),
    /already exists/,
  );
});

test("workspace roles permit authorized reads while restricting registry mutations to owners and admins", async () => {
  const { workspaceId } = await createWorkspace({ name: "Scoped registry", ownerAddress: OWNER });
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?), (?, ?, 'admin', ?)`,
    args: [workspaceId, MEMBER, new Date(), workspaceId, ADMIN, new Date()],
  });
  await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "allowed-reader",
    version: version("2026-07-14"),
  });
  const adminAgent = await createWorkspaceAgent({
    accountAddress: ADMIN,
    workspaceId,
    externalId: "admin-managed",
    version: version("2026-07-14-admin"),
  });
  assert.equal(adminAgent.ownerAccountAddress, ADMIN.toLowerCase());
  const adminRegistry = await listWorkspaceAgents({ accountAddress: ADMIN, workspaceId });
  assert.equal(adminRegistry.callerRole, "admin");
  assert.equal(adminRegistry.canManage, true);

  const memberRegistry = await listWorkspaceAgents({ accountAddress: MEMBER, workspaceId });
  assert.equal(memberRegistry.callerRole, "member");
  assert.equal(memberRegistry.canManage, false);
  assert.equal(memberRegistry.agents.length, 2);
  await assert.rejects(
    () =>
      createWorkspaceAgent({
        accountAddress: MEMBER,
        workspaceId,
        externalId: "member-write",
        version: version("2026-07-14"),
      }),
    /Workspace not found/,
  );
  await assert.rejects(() => listWorkspaceAgents({ accountAddress: OUTSIDER, workspaceId }), /Workspace not found/);
});

test("Free and Early Access plans enforce active-agent limits in the creation transaction", async () => {
  const { workspaceId } = await createWorkspace({ name: "Agent limits", ownerAddress: OWNER });
  await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "free-agent",
    version: version("2026-07-14"),
  });
  await assert.rejects(
    () =>
      createWorkspaceAgent({
        accountAddress: OWNER,
        workspaceId,
        externalId: "over-free-limit",
        version: version("2026-07-15"),
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "plan_limit_reached" &&
      "limitType" in error &&
      error.limitType === "active_agents",
  );
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
  const second = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "paid-agent-two",
    version: version("2026-07-15"),
  });
  const third = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "paid-agent-three",
    version: version("2026-07-16"),
  });
  assert.equal(second.status, "active");
  assert.equal(third.status, "active");
  await assert.rejects(
    () =>
      createWorkspaceAgent({
        accountAddress: OWNER,
        workspaceId,
        externalId: "over-paid-limit",
        version: version("2026-07-17"),
      }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "plan_limit_reached",
  );
});

test("deactivation is durable and blocks later versions without deleting audit history", async () => {
  const { workspaceId } = await createWorkspace({ name: "Deactivation", ownerAddress: OWNER });
  const created = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "deactivated-agent",
    version: version("2026-07-14"),
  });
  const inactive = await deactivateWorkspaceAgent({ accountAddress: OWNER, workspaceId, agentId: created.agentId });
  assert.equal(inactive.status, "inactive");
  assert.ok(inactive.deactivatedAt);
  assert.equal(inactive.versions.length, 1);
  await assert.rejects(
    () =>
      createWorkspaceAgentVersion({
        accountAddress: OWNER,
        workspaceId,
        agentId: created.agentId,
        version: version("2026-07-15"),
      }),
    /inactive/,
  );
  const audit = await dbClient.execute({
    sql: `SELECT event_type FROM tokenless_agent_audit_events
          WHERE workspace_id = ? AND agent_id = ? ORDER BY created_at`,
    args: [workspaceId, created.agentId],
  });
  assert.deepEqual(
    audit.rows.map(row => row.event_type),
    ["agent.created", "agent.deactivated"],
  );
});

test("external IDs and declared model metadata are validated before persistence", async () => {
  const { workspaceId } = await createWorkspace({ name: "Validation", ownerAddress: OWNER });
  await assert.rejects(
    () =>
      createWorkspaceAgent({
        accountAddress: OWNER,
        workspaceId,
        externalId: "contains spaces",
        version: version("2026-07-14"),
      }),
    /External agent ID/,
  );
  await assert.rejects(
    () =>
      createWorkspaceAgent({
        accountAddress: OWNER,
        workspaceId,
        externalId: "missing-provider",
        version: { ...version("2026-07-14"), provider: "" },
      }),
    /Declared provider/,
  );
});
