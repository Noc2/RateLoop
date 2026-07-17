import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { createPrivateGroup, createPrivateGroupPolicyVersion } from "~~/lib/tokenless/privateGroups";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import {
  MAXIMUM_REVIEW_USDC_ATOMIC,
  __reviewRequestProfileTestUtils,
  createReviewRequestProfile,
  hashReviewRequestProfile,
  listReviewRequestProfiles,
  updateReviewRequestProfile,
} from "~~/lib/tokenless/reviewRequestProfiles";
import { createWorkspaceReviewerExpertiseDefinition } from "~~/lib/tokenless/reviewerExpertiseDefinitions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function fixture() {
  const { workspaceId } = await createWorkspace({ name: "Request profiles", ownerAddress: OWNER });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "request-profile-agent",
    version: {
      displayName: "Request profile agent",
      provider: "OpenAI",
      model: "gpt-5",
      environment: "production",
    },
  });
  const group = await createPrivateGroup({
    accountAddress: OWNER,
    workspaceId,
    name: "Workspace reviewers",
    purpose: "Review confidential agent output.",
    policy: { defaultCompensation: "unpaid", dataClassifications: ["internal", "confidential"] },
  });
  return { workspaceId, agent, group };
}

function privateProfile(agentId: string, agentVersionId: string, group: { groupId: string; policyHash: string }) {
  return {
    agentId,
    agentVersionId,
    questionAuthority: "owner_fixed",
    criterion: " Is the suggested response safe to send? ",
    positiveLabel: " Send ",
    negativeLabel: "Do not send",
    rationaleMode: "required",
    audience: "private_invited",
    contentBoundary: "private_workspace",
    privateSensitivity: "confidential",
    privateGroupId: group.groupId,
    privateGroupPolicyVersion: 1,
    privateGroupPolicyHash: group.policyHash,
    responseWindowSeconds: 3_600,
    panelSize: 2,
    compensationMode: "unpaid",
  };
}

test("profile normalization rejects unknown fields and hashes only normalized semantic terms", () => {
  const input = {
    agentId: "agent_1",
    agentVersionId: "agent_version_1",
    questionAuthority: "owner_fixed",
    criterion: " Is this correct? ",
    positiveLabel: " Yes ",
    negativeLabel: "No",
    rationaleMode: "optional",
    audience: "public_network",
    contentBoundary: "public_or_test",
    responseWindowSeconds: 3_600,
    panelSize: 3,
    compensationMode: "usdc",
    bountyPerSeatAtomic: "1000000",
  };
  const normalized = __reviewRequestProfileTestUtils.normalizeReviewRequestProfileInput(input);
  assert.equal(normalized.criterion, "Is this correct?");
  assert.equal(normalized.questionAuthority, "owner_fixed");
  assert.equal(normalized.resultSemantics, "assurance");
  assert.equal(normalized.positiveLabel, "Yes");
  assert.equal(normalized.negativeLabel, "No");
  assert.equal(
    hashReviewRequestProfile(normalized),
    hashReviewRequestProfile({ ...normalized, configurationStatus: "action_required" } as typeof normalized),
  );
  assert.match(hashReviewRequestProfile(normalized), /^sha256:[0-9a-f]{64}$/u);
  assert.throws(
    () => __reviewRequestProfileTestUtils.normalizeReviewRequestProfileInput({ ...input, readiness: { public: true } }),
    /unknown fields/i,
  );
  assert.throws(
    () => __reviewRequestProfileTestUtils.normalizeReviewRequestProfileInput({ ...input, negativeLabel: " yes " }),
    /must be distinct/i,
  );
});

test("fixed profiles retain v1 hashes while agent-per-request profiles use feedback-only v2 policy terms", () => {
  const fixed = {
    agentId: "agent_1",
    agentVersionId: "agent_version_1",
    questionAuthority: "owner_fixed",
    criterion: "Is this correct?",
    positiveLabel: "Yes",
    negativeLabel: "No",
    rationaleMode: "optional",
    audience: "public_network",
    contentBoundary: "public_or_test",
    responseWindowSeconds: 3_600,
    panelSize: 3,
    compensationMode: "usdc",
    bountyPerSeatAtomic: "1000000",
  };
  const normalizedFixed = __reviewRequestProfileTestUtils.normalizeReviewRequestProfileInput(fixed);
  const fixedDocument = __reviewRequestProfileTestUtils.reviewRequestProfileSemanticDocument(normalizedFixed);
  assert.equal(fixedDocument.schemaVersion, "rateloop.review-request-profile.v1");
  assert.equal(
    hashReviewRequestProfile(normalizedFixed),
    "sha256:37152028647c167f477fa2ced8daccf608515de26f724f3ed969c48578c428d5",
  );

  const dynamicInput = {
    ...fixed,
    questionAuthority: "agent_per_request",
    criterion: null,
    positiveLabel: null,
    negativeLabel: null,
  };
  const dynamic = __reviewRequestProfileTestUtils.normalizeReviewRequestProfileInput(dynamicInput);
  const dynamicDocument = __reviewRequestProfileTestUtils.reviewRequestProfileSemanticDocument(dynamic);
  assert.equal(dynamic.questionAuthority, "agent_per_request");
  assert.equal(dynamic.resultSemantics, "feedback");
  assert.equal(dynamic.criterion, null);
  assert.equal(dynamicDocument.schemaVersion, "rateloop.review-request-profile.v2");
  assert.deepEqual("questionPolicy" in dynamicDocument ? dynamicDocument.questionPolicy : null, {
    authority: "agent_per_request",
    kind: "binary",
    maximumPromptLength: 500,
    maximumLabelLength: 40,
    rationaleMode: "optional",
    resultSemantics: "feedback",
  });
  assert.notEqual(hashReviewRequestProfile(dynamic), hashReviewRequestProfile(normalizedFixed));
  assert.equal(
    hashReviewRequestProfile(dynamic),
    "sha256:8cb7079628f7692a30d2c3e263cef25802ec96aa02bca2e2c36c7d141cd61a5d",
  );

  assert.throws(
    () =>
      __reviewRequestProfileTestUtils.normalizeReviewRequestProfileInput({
        ...fixed,
        questionAuthority: "agent_per_request",
      }),
    /cannot include a fixed criterion/i,
  );
  const missingAuthority = Object.fromEntries(Object.entries(fixed).filter(([key]) => key !== "questionAuthority"));
  assert.throws(() => __reviewRequestProfileTestUtils.normalizeReviewRequestProfileInput(missingAuthority), /invalid/i);

  assert.throws(
    () =>
      __reviewRequestProfileTestUtils.normalizeReviewRequestProfileInput({
        ...dynamicInput,
        audience: "private_invited",
        contentBoundary: "private_workspace",
        privateSensitivity: "internal",
        privateGroupId: "group_1",
        privateGroupPolicyVersion: 1,
        privateGroupPolicyHash: `sha256:${"a".repeat(64)}`,
        panelSize: 1,
        compensationMode: "unpaid",
        bountyPerSeatAtomic: null,
      }),
    /public-safe RateLoop-network review/i,
  );
});

test("exact specialist requirements use ordered v3 semantics without reinterpreting legacy all-seat keys", () => {
  const base = {
    agentId: "agent_1",
    agentVersionId: "agent_version_1",
    questionAuthority: "owner_fixed",
    criterion: "Is this correct?",
    positiveLabel: "Yes",
    negativeLabel: "No",
    rationaleMode: "optional",
    audience: "private_invited",
    contentBoundary: "private_workspace",
    privateSensitivity: "confidential",
    privateGroupId: "pgrp_1",
    privateGroupPolicyVersion: 1,
    privateGroupPolicyHash: `sha256:${"1".repeat(64)}`,
    responseWindowSeconds: 3_600,
    panelSize: 3,
    compensationMode: "unpaid",
  };
  const requirements = [
    {
      definitionId: "expd_workspace_typescript_review",
      definitionVersion: 2,
      definitionHash: `sha256:${"b".repeat(64)}`,
      minimumSeats: 1,
      sourceScope: "customer_invited",
    },
    {
      definitionId: "expd_code_review_security",
      definitionVersion: 1,
      definitionHash: `sha256:${"a".repeat(64)}`,
      minimumSeats: 2,
      sourceScope: "customer_invited",
    },
  ];
  const normalized = __reviewRequestProfileTestUtils.normalizeReviewRequestProfileInput({
    ...base,
    expertiseRequirements: requirements,
  });
  assert.equal(normalized.semanticSchemaVersion, 3);
  assert.deepEqual(
    normalized.expertiseRequirements.map(requirement => requirement.definitionId),
    ["expd_code_review_security", "expd_workspace_typescript_review"],
  );
  const document = __reviewRequestProfileTestUtils.reviewRequestProfileSemanticDocument(normalized);
  assert.equal(document.schemaVersion, "rateloop.review-request-profile.v3");
  if (document.schemaVersion !== "rateloop.review-request-profile.v3") assert.fail("Expected v3 semantics.");
  assert.deepEqual(document.audience.expertiseRequirements, [
    {
      definitionId: "expd_code_review_security",
      definitionVersion: 1,
      definitionHash: `sha256:${"a".repeat(64)}`,
      minimumSeats: 2,
      sourceScope: "customer_invited",
    },
    {
      definitionId: "expd_workspace_typescript_review",
      definitionVersion: 2,
      definitionHash: `sha256:${"b".repeat(64)}`,
      minimumSeats: 1,
      sourceScope: "customer_invited",
    },
  ]);
  const hash = hashReviewRequestProfile(normalized);
  const changedFirstRequirement = (change: Record<string, unknown>) =>
    hashReviewRequestProfile({
      ...normalized,
      expertiseRequirements: normalized.expertiseRequirements.map((requirement, index) =>
        index === 0 ? { ...requirement, ...change } : requirement,
      ),
    });
  for (const change of [
    { definitionId: "expd_changed_security" },
    { definitionVersion: 2 },
    { definitionHash: `sha256:${"d".repeat(64)}` },
    { minimumSeats: 1 },
  ]) {
    assert.notEqual(hash, changedFirstRequirement(change));
  }
  assert.throws(() => changedFirstRequirement({ sourceScope: "rateloop_network" }), /invited reviewers/i);
  assert.throws(
    () =>
      __reviewRequestProfileTestUtils.normalizeReviewRequestProfileInput({
        ...base,
        requiredExpertiseKeys: ["code-review:security"],
        expertiseRequirements: requirements,
      }),
    /cannot be used together/i,
  );
});

test("exact specialist requirements persist with their semantic version and immutable tuple", async () => {
  const { workspaceId, agent, group } = await fixture();
  const { definition } = await createWorkspaceReviewerExpertiseDefinition({
    accountAddress: OWNER,
    workspaceId,
    label: "TypeScript release review",
    description: "Can assess this workspace's TypeScript release and runtime constraints.",
  });
  const expertiseRequirements = [
    {
      definitionId: definition.definitionId,
      definitionVersion: definition.version,
      definitionHash: definition.hash,
      minimumSeats: 1,
      sourceScope: "customer_invited",
    },
  ];
  const created = await createReviewRequestProfile({
    accountAddress: OWNER,
    workspaceId,
    profile: {
      ...privateProfile(agent.agentId, agent.currentVersion.versionId, group),
      expertiseRequirements,
    },
  });
  assert.equal(created.semanticSchemaVersion, 3);
  assert.deepEqual(created.expertiseRequirements, expertiseRequirements);
  assert.deepEqual(created.requiredExpertiseKeys, []);
  const stored = await dbClient.execute({
    sql: `SELECT semantic_schema_version,required_expertise_keys_json,expertise_requirements_json
          FROM tokenless_agent_review_request_profiles WHERE profile_id=? AND version=1`,
    args: [created.profileId],
  });
  assert.equal(Number(stored.rows[0]?.semantic_schema_version), 3);
  assert.deepEqual(JSON.parse(String(stored.rows[0]?.required_expertise_keys_json)), []);
  assert.deepEqual(JSON.parse(String(stored.rows[0]?.expertise_requirements_json)), expertiseRequirements);
});

test("lane, content, group, and economics combinations fail closed", () => {
  const publicProfile = {
    agentId: "agent_1",
    agentVersionId: "version_1",
    questionAuthority: "owner_fixed",
    criterion: "Is this correct?",
    positiveLabel: "Yes",
    negativeLabel: "No",
    rationaleMode: "off",
    audience: "public_network",
    contentBoundary: "public_or_test",
    responseWindowSeconds: 3_600,
    panelSize: 3,
    compensationMode: "usdc",
    bountyPerSeatAtomic: "1000000",
  };
  const normalize = (overrides: Record<string, unknown>) =>
    __reviewRequestProfileTestUtils.normalizeReviewRequestProfileInput({ ...publicProfile, ...overrides });
  assert.throws(() => normalize({ compensationMode: "unpaid", bountyPerSeatAtomic: undefined }), /must be paid/i);
  assert.throws(() => normalize({ contentBoundary: "private_workspace" }), /only to invited reviewers/i);
  assert.throws(() => normalize({ privateSensitivity: "confidential" }), /must be omitted/i);
  assert.throws(() => normalize({ panelSize: 2 }), /at least 3/i);
  assert.throws(
    () =>
      normalize({
        privateGroupId: "pgrp_1",
        privateGroupPolicyVersion: 1,
        privateGroupPolicyHash: `sha256:${"1".repeat(64)}`,
      }),
    /cannot bind a private reviewer group/i,
  );
  assert.throws(
    () =>
      normalize({
        audience: "hybrid",
        privateGroupId: undefined,
        privateGroupPolicyVersion: undefined,
        privateGroupPolicyHash: undefined,
      }),
    /requires an exact private-group/i,
  );
  assert.throws(
    () =>
      normalize({
        audience: "private_invited",
        compensationMode: "unpaid",
        bountyPerSeatAtomic: "1",
        privateGroupId: "pgrp_1",
        privateGroupPolicyVersion: 1,
        privateGroupPolicyHash: `sha256:${"1".repeat(64)}`,
      }),
    /cannot include a per-seat bounty/i,
  );
});

test("response windows, panel sizes, and USDC liability use exact bounded integers", () => {
  const base = {
    agentId: "agent_1",
    agentVersionId: "version_1",
    questionAuthority: "owner_fixed",
    criterion: "Is this correct?",
    positiveLabel: "Yes",
    negativeLabel: "No",
    rationaleMode: "off",
    audience: "public_network",
    contentBoundary: "public_or_test",
    responseWindowSeconds: 3_600,
    panelSize: 3,
    compensationMode: "usdc",
    bountyPerSeatAtomic: "1000000",
  };
  const normalize = (overrides: Record<string, unknown>) =>
    __reviewRequestProfileTestUtils.normalizeReviewRequestProfileInput({ ...base, ...overrides });
  assert.throws(() => normalize({ responseWindowSeconds: 1_199 }), /1200 to 86400/i);
  assert.throws(() => normalize({ responseWindowSeconds: 86_401 }), /1200 to 86400/i);
  assert.throws(() => normalize({ panelSize: 101 }), /1 to 100/i);
  assert.throws(() => normalize({ bountyPerSeatAtomic: "01" }), /positive integer string/i);
  assert.throws(() => normalize({ bountyPerSeatAtomic: "1.5" }), /positive integer string/i);
  assert.throws(
    () => normalize({ panelSize: 3, bountyPerSeatAtomic: MAXIMUM_REVIEW_USDC_ATOMIC.toString() }),
    /maximum panel liability/i,
  );
  assert.equal(normalize({ bountyPerSeatAtomic: "1" }).bountyPerSeatAtomic, "1");
});

test("creation verifies the exact active private-group policy tuple and stores a ready immutable profile", async () => {
  const { workspaceId, agent, group } = await fixture();
  const created = await createReviewRequestProfile({
    accountAddress: OWNER,
    workspaceId,
    profile: privateProfile(agent.agentId, agent.currentVersion.versionId, group),
  });
  assert.equal(created.version, 1);
  assert.equal(created.configurationStatus, "ready");
  assert.equal(created.criterion, "Is the suggested response safe to send?");
  assert.equal(created.positiveLabel, "Send");
  assert.equal(created.negativeLabel, "Do not send");
  assert.equal(created.approvedBy, OWNER);
  assert.match(created.profileHash, /^sha256:[0-9a-f]{64}$/u);

  const stored = await dbClient.execute({
    sql: `SELECT configuration_status, private_group_id, private_group_policy_version,
                 private_group_policy_hash, approved_by, superseded_at
          FROM tokenless_agent_review_request_profiles WHERE profile_id = ? AND version = 1`,
    args: [created.profileId],
  });
  assert.equal(stored.rows[0]?.configuration_status, "ready");
  assert.equal(stored.rows[0]?.private_group_id, group.groupId);
  assert.equal(Number(stored.rows[0]?.private_group_policy_version), 1);
  assert.equal(stored.rows[0]?.private_group_policy_hash, group.policyHash);
  assert.equal(stored.rows[0]?.approved_by, OWNER);
  assert.equal(stored.rows[0]?.superseded_at, null);
});

test("private-group bindings enforce workspace, active version, hash, status, and sensitivity", async () => {
  const { workspaceId, agent, group } = await fixture();
  const profile = privateProfile(agent.agentId, agent.currentVersion.versionId, group);
  await assert.rejects(
    () =>
      createReviewRequestProfile({
        accountAddress: OWNER,
        workspaceId,
        profile: { ...profile, privateGroupPolicyHash: `sha256:${"0".repeat(64)}` },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "private_group_policy_not_found",
  );

  const { workspaceId: otherWorkspaceId } = await createWorkspace({
    name: "Other request profiles",
    ownerAddress: OWNER,
  });
  const otherGroup = await createPrivateGroup({
    accountAddress: OWNER,
    workspaceId: otherWorkspaceId,
    name: "Other reviewers",
    purpose: "Review material for another workspace.",
    policy: { defaultCompensation: "unpaid", dataClassifications: ["confidential"] },
  });
  await assert.rejects(
    () =>
      createReviewRequestProfile({
        accountAddress: OWNER,
        workspaceId,
        profile: {
          ...profile,
          privateGroupId: otherGroup.groupId,
          privateGroupPolicyHash: otherGroup.policyHash,
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "private_group_policy_not_found",
  );

  const nextPolicy = await createPrivateGroupPolicyVersion({
    accountAddress: OWNER,
    workspaceId,
    groupId: group.groupId,
    policy: { defaultCompensation: "unpaid", dataClassifications: ["confidential"] },
  });
  await assert.rejects(
    () => createReviewRequestProfile({ accountAddress: OWNER, workspaceId, profile }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "private_group_policy_not_found",
  );

  await dbClient.execute({
    sql: `UPDATE tokenless_private_group_policy_versions SET max_private_sensitivity = 'internal'
          WHERE group_id = ? AND version = 2 AND policy_hash = ?`,
    args: [group.groupId, nextPolicy.policyHash],
  });
  await assert.rejects(
    () =>
      createReviewRequestProfile({
        accountAddress: OWNER,
        workspaceId,
        profile: {
          ...profile,
          privateGroupPolicyVersion: 2,
          privateGroupPolicyHash: nextPolicy.policyHash,
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "private_group_sensitivity_exceeded",
  );

  await dbClient.execute({
    sql: "UPDATE tokenless_private_groups SET status = 'archived' WHERE workspace_id = ? AND group_id = ?",
    args: [workspaceId, group.groupId],
  });
  await assert.rejects(
    () =>
      createReviewRequestProfile({
        accountAddress: OWNER,
        workspaceId,
        profile: {
          ...profile,
          privateGroupPolicyVersion: 2,
          privateGroupPolicyHash: nextPolicy.policyHash,
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "private_group_policy_not_found",
  );
});

test("updates append one immutable version and supersede only the locked active predecessor", async () => {
  const { workspaceId, agent, group } = await fixture();
  const initialInput = privateProfile(agent.agentId, agent.currentVersion.versionId, group);
  const initial = await createReviewRequestProfile({ accountAddress: OWNER, workspaceId, profile: initialInput });
  const updated = await updateReviewRequestProfile({
    accountAddress: OWNER,
    workspaceId,
    profileId: initial.profileId,
    profile: { ...initialInput, criterion: "Is this revised response safe to send?", responseWindowSeconds: 14_400 },
  });
  assert.equal(updated.profileId, initial.profileId);
  assert.equal(updated.version, 2);
  assert.notEqual(updated.profileHash, initial.profileHash);

  const versions = await listReviewRequestProfiles({ accountAddress: OWNER, workspaceId, includeHistory: true });
  assert.deepEqual(
    versions.map(profile => [profile.version, profile.supersededAt !== null]),
    [
      [2, false],
      [1, true],
    ],
  );
  await assert.rejects(
    () =>
      updateReviewRequestProfile({
        accountAddress: OWNER,
        workspaceId,
        profileId: initial.profileId,
        profile: {
          ...initialInput,
          criterion: "Is this revised response safe to send?",
          responseWindowSeconds: 14_400,
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "review_request_profile_unchanged",
  );
});
