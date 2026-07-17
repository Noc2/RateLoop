import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient, dbPool } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import {
  humanReviewEvaluationPartition,
  humanReviewReplayIdentity,
  putHumanReviewConfigurationForOwner,
  saveHumanReviewConfiguration,
  saveHumanReviewConfigurationInTransaction,
} from "~~/lib/tokenless/humanReviewConfiguration";
import { createPrivateGroup } from "~~/lib/tokenless/privateGroups";
import { createAgentPublishingPolicy, createWorkspace } from "~~/lib/tokenless/productCore";
import { createManagedReviewPolicy, updateManagedReviewPolicy } from "~~/lib/tokenless/reviewPolicyManagement";
import { createReviewRequestProfile, updateReviewRequestProfile } from "~~/lib/tokenless/reviewRequestProfiles";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function fixture(
  options: {
    policyAudience?: "private_invited" | "public_network";
    policyMode?: "adaptive" | "manual";
  } = {},
) {
  const { workspaceId } = await createWorkspace({ name: "Atomic review configuration", ownerAddress: OWNER });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "atomic-review-agent",
    version: {
      displayName: "Atomic review agent",
      provider: "OpenAI",
      model: "gpt-5",
      environment: "production",
    },
  });
  const group = await createPrivateGroup({
    accountAddress: OWNER,
    workspaceId,
    name: "Configuration reviewers",
    purpose: "Review confidential suggestions.",
    policy: { defaultCompensation: "unpaid", dataClassifications: ["internal", "confidential"] },
  });
  const policyInput = {
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    mode: options.policyMode ?? ("adaptive" as const),
    enforcementMode: "advisory" as const,
    agreementThresholdBps: 8_000,
    productionFloorBps: 1_000,
    maximumUnreviewedGap: 20,
    requiredRiskTiers: [],
    criticalRiskTiers: ["critical"],
    audience: options.policyAudience ?? ("private_invited" as const),
  };
  const policy = await createManagedReviewPolicy({ accountAddress: OWNER, workspaceId, policy: policyInput });
  const profileInput = {
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    questionAuthority: "owner_fixed" as const,
    criterion: "Is this suggestion safe and correct?",
    positiveLabel: "Approve",
    negativeLabel: "Reject",
    rationaleMode: "required" as const,
    audience: "private_invited" as const,
    contentBoundary: "private_workspace" as const,
    privateSensitivity: "confidential" as const,
    privateGroupId: group.groupId,
    privateGroupPolicyVersion: 1,
    privateGroupPolicyHash: group.policyHash,
    responseWindowSeconds: 3_600,
    panelSize: 2,
    compensationMode: "unpaid" as const,
  };
  const profile = await createReviewRequestProfile({ accountAddress: OWNER, workspaceId, profile: profileInput });
  return { workspaceId, agent, group, policy, policyInput, profile, profileInput };
}

test("manual handoff normalizes owner mutations and rejects contradictory direct bindings", async () => {
  const setup = await fixture({ policyMode: "manual" });
  const normalized = await putHumanReviewConfigurationForOwner({
    accountAddress: OWNER,
    workspaceId: setup.workspaceId,
    agentId: setup.agent.agentId,
    body: {
      expectedBindingVersion: null,
      selection: {
        mode: "manual",
        enforcementMode: "host_enforced",
        agreementThresholdBps: 8_000,
        productionFloorBps: 0,
        fixedRateBps: null,
        maximumUnreviewedGap: 20,
        requiredRiskTiers: [],
        criticalRiskTiers: ["critical"],
        minimumConfidenceBps: null,
        maximumLatencyMs: null,
      },
      requestProfile: {
        questionAuthority: "owner_fixed",
        criterion: setup.profileInput.criterion,
        positiveLabel: setup.profileInput.positiveLabel,
        negativeLabel: setup.profileInput.negativeLabel,
        rationaleMode: setup.profileInput.rationaleMode,
        audience: setup.profileInput.audience,
        contentBoundary: setup.profileInput.contentBoundary,
        privateSensitivity: setup.profileInput.privateSensitivity,
        privateGroupId: setup.profileInput.privateGroupId,
        requiredExpertiseKeys: [],
        responseWindowSeconds: setup.profileInput.responseWindowSeconds,
        panelSize: setup.profileInput.panelSize,
        compensationMode: setup.profileInput.compensationMode,
        bountyPerSeatAtomic: null,
        feedbackBonusEnabled: false,
      },
      authority: "prepare_for_approval",
    },
  });
  assert.equal(normalized.configuration.authority, "check_only");
  assert.equal(normalized.configuration.publishingPolicy, null);
  const policy = await dbClient.execute({
    sql: `SELECT mode,rules_json FROM tokenless_agent_review_policies
          WHERE workspace_id=? AND policy_id=? AND version=?`,
    args: [
      setup.workspaceId,
      normalized.configuration.selectionPolicy.id,
      normalized.configuration.selectionPolicy.version,
    ],
  });
  assert.equal(policy.rows[0]?.mode, "manual");
  assert.equal(JSON.parse(String(policy.rows[0]?.rules_json)).enforcementMode, "advisory");

  await assert.rejects(
    () =>
      saveHumanReviewConfiguration({
        accountAddress: OWNER,
        workspaceId: setup.workspaceId,
        agentId: setup.agent.agentId,
        agentVersionId: setup.agent.currentVersion.versionId,
        expectedBindingVersion: normalized.configuration.version,
        authority: "prepare_for_approval",
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "human_review_manual_invariant_mismatch",
  );
});

test("optimistic saves append one binding version while carrying forward unchanged object versions", async () => {
  const setup = await fixture();
  const created = await saveHumanReviewConfiguration({
    accountAddress: OWNER,
    workspaceId: setup.workspaceId,
    agentId: setup.agent.agentId,
    agentVersionId: setup.agent.currentVersion.versionId,
    expectedBindingVersion: null,
    selectionPolicy: { id: setup.policy.policyId, version: setup.policy.version },
    requestProfile: { id: setup.profile.profileId, version: setup.profile.version },
    authority: "check_only",
  });
  assert.equal(created.version, 1);
  assert.equal(created.authority, "check_only");
  assert.equal(created.selectionPolicy.version, 1);
  assert.equal(created.requestProfile.version, 1);
  assert.match(created.canonicalHash, /^sha256:[0-9a-f]{64}$/u);

  const updated = await saveHumanReviewConfiguration({
    accountAddress: OWNER,
    workspaceId: setup.workspaceId,
    agentId: setup.agent.agentId,
    agentVersionId: setup.agent.currentVersion.versionId,
    expectedBindingVersion: 1,
    authority: "prepare_for_approval",
  });
  assert.equal(updated.bindingId, created.bindingId);
  assert.equal(updated.version, 2);
  assert.equal(updated.authority, "prepare_for_approval");
  assert.deepEqual(updated.selectionPolicy, created.selectionPolicy);
  assert.deepEqual(updated.requestProfile, created.requestProfile);

  const stored = await dbClient.execute({
    sql: `SELECT version, enabled, superseded_at FROM tokenless_agent_human_review_bindings
          WHERE binding_id = ? ORDER BY version`,
    args: [created.bindingId],
  });
  assert.deepEqual(
    stored.rows.map(row => [Number(row.version), row.enabled, row.superseded_at !== null]),
    [
      [1, false, true],
      [2, true, false],
    ],
  );
  const events = await dbClient.execute({
    sql: `SELECT event_type, binding_version, event_hash
          FROM tokenless_agent_human_review_binding_events WHERE binding_id = ? ORDER BY binding_version`,
    args: [created.bindingId],
  });
  assert.deepEqual(
    events.rows.map(row => [row.event_type, Number(row.binding_version)]),
    [
      ["created", 1],
      ["configuration_changed", 2],
    ],
  );
  assert.ok(events.rows.every(row => /^sha256:[0-9a-f]{64}$/u.test(String(row.event_hash))));
  const guidedSetup = await dbClient.execute({
    sql: `SELECT human_review_binding_id, human_review_binding_version
          FROM tokenless_workspace_agent_setups WHERE workspace_id = ?`,
    args: [setup.workspaceId],
  });
  assert.equal(guidedSetup.rows[0]?.human_review_binding_id, created.bindingId);
  assert.equal(Number(guidedSetup.rows[0]?.human_review_binding_version), 2);

  await assert.rejects(
    () =>
      saveHumanReviewConfiguration({
        accountAddress: OWNER,
        workspaceId: setup.workspaceId,
        agentId: setup.agent.agentId,
        agentVersionId: setup.agent.currentVersion.versionId,
        expectedBindingVersion: 1,
        authority: "check_only",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "human_review_configuration_conflict",
  );
});

test("the in-transaction seam leaves commit and rollback ownership with the unified coordinator", async () => {
  const setup = await fixture();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const transactionControl: string[] = [];
    const callerOwnedClient = new Proxy(client, {
      get(target, property, receiver) {
        if (property !== "query") return Reflect.get(target, property, receiver);
        return (...args: Parameters<typeof client.query>) => {
          const statement = String(args[0]);
          if (/^(BEGIN|COMMIT|ROLLBACK)$/u.test(statement.trim())) transactionControl.push(statement.trim());
          return Reflect.apply(target.query, target, args);
        };
      },
    });
    const created = await saveHumanReviewConfigurationInTransaction(callerOwnedClient, {
      actor: OWNER,
      workspaceId: setup.workspaceId,
      agentId: setup.agent.agentId,
      agentVersionId: setup.agent.currentVersion.versionId,
      expectedBindingVersion: null,
      selectionPolicy: { id: setup.policy.policyId, version: setup.policy.version },
      requestProfile: { id: setup.profile.profileId, version: setup.profile.version },
      authority: "check_only",
    });
    const inside = await client.query(
      "SELECT version FROM tokenless_agent_human_review_bindings WHERE binding_id = $1",
      [created.bindingId],
    );
    assert.equal(Number(inside.rows[0]?.version), 1);
    assert.deepEqual(transactionControl, []);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});

test("request profile audience is authoritative across the bound objects", async () => {
  const setup = await fixture({ policyAudience: "public_network" });
  await assert.rejects(
    () =>
      saveHumanReviewConfiguration({
        accountAddress: OWNER,
        workspaceId: setup.workspaceId,
        agentId: setup.agent.agentId,
        agentVersionId: setup.agent.currentVersion.versionId,
        expectedBindingVersion: null,
        selectionPolicy: { id: setup.policy.policyId, version: setup.policy.version },
        requestProfile: { id: setup.profile.profileId, version: setup.profile.version },
        authority: "check_only",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "human_review_audience_mismatch",
  );
});

test("automatic asks require an active exact delegation grant, not only a publishing policy", async () => {
  const setup = await fixture();
  const publishing = await createAgentPublishingPolicy({
    accountAddress: OWNER,
    workspaceId: setup.workspaceId,
    policy: {
      name: "Exact automatic review grant",
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "10000000",
      maxDailyAtomic: "100000000",
      maxMonthlyAtomic: "1000000000",
      maxPanelSize: 10,
      maxBountyAtomic: "10000000",
      maxFeeBps: 2_000,
      maxAttemptReserveAtomic: "10000000",
      allowedReviewerSources: ["customer_invited"],
      allowedAdmissionPolicyHashes: [`0x${"1".repeat(64)}`],
      allowedDataClassifications: ["confidential"],
    },
  });
  await assert.rejects(
    () =>
      saveHumanReviewConfiguration({
        accountAddress: OWNER,
        workspaceId: setup.workspaceId,
        agentId: setup.agent.agentId,
        agentVersionId: setup.agent.currentVersion.versionId,
        expectedBindingVersion: null,
        selectionPolicy: { id: setup.policy.policyId, version: setup.policy.version },
        requestProfile: { id: setup.profile.profileId, version: setup.profile.version },
        publishingPolicy: { id: publishing.policyId, version: publishing.version ?? 1 },
        authority: "ask_automatically",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "human_review_delegation_required",
  );
});

test("legacy object editors cannot mutate versions held by an active binding", async () => {
  const setup = await fixture();
  await saveHumanReviewConfiguration({
    accountAddress: OWNER,
    workspaceId: setup.workspaceId,
    agentId: setup.agent.agentId,
    agentVersionId: setup.agent.currentVersion.versionId,
    expectedBindingVersion: null,
    selectionPolicy: { id: setup.policy.policyId, version: setup.policy.version },
    requestProfile: { id: setup.profile.profileId, version: setup.profile.version },
    authority: "check_only",
  });
  await assert.rejects(
    () =>
      updateManagedReviewPolicy({
        accountAddress: OWNER,
        workspaceId: setup.workspaceId,
        policyId: setup.policy.policyId,
        policy: { ...setup.policyInput, maximumUnreviewedGap: 10 },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "human_review_configuration_required",
  );
  await assert.rejects(
    () =>
      updateReviewRequestProfile({
        accountAddress: OWNER,
        workspaceId: setup.workspaceId,
        profileId: setup.profile.profileId,
        profile: { ...setup.profileInput, responseWindowSeconds: 7_200 },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "human_review_configuration_required",
  );
});

test("profile hash partitions evaluation but an external opportunity retains one replay identity", () => {
  const hashA = `sha256:${"a".repeat(64)}`;
  const hashB = `sha256:${"b".repeat(64)}`;
  const base = {
    agentVersionId: "version_a",
    selectionPolicy: { id: "policy_a", version: 1 },
    workflowKey: "general-assistance",
    riskTier: "normal",
    audiencePolicyHash: `sha256:${"c".repeat(64)}`,
    executionProfileHash: `sha256:${"d".repeat(64)}`,
  };
  assert.notEqual(
    humanReviewEvaluationPartition({ ...base, requestProfileHash: hashA }).commitment,
    humanReviewEvaluationPartition({ ...base, requestProfileHash: hashB }).commitment,
  );

  const replayA = humanReviewReplayIdentity({
    workspaceId: "workspace_a",
    agentId: "agent_a",
    externalOpportunityId: "opportunity_a",
    requestProfileHash: hashA,
  });
  const replayB = humanReviewReplayIdentity({
    workspaceId: "workspace_a",
    agentId: "agent_a",
    externalOpportunityId: "opportunity_a",
    requestProfileHash: hashB,
  });
  assert.equal(replayA.identity, replayB.identity);
  assert.notEqual(replayA.requestProfileHash, replayB.requestProfileHash);
});
