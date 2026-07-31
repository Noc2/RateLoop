import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { createPrivateGroup } from "~~/lib/tokenless/privateGroups";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { resolveHumanReviewCapability } from "~~/lib/tokenless/reviewCapabilities";
import {
  createReviewRequestProfile,
  hashReviewRequestProfile,
  listReviewRequestProfiles,
  updateReviewRequestProfile,
} from "~~/lib/tokenless/reviewRequestProfiles";

const OWNER = "0x1111111111111111111111111111111111111111";
const DESIGNATED_AWARDER = "0x2222222222222222222222222222222222222222";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("ordinary configuration persists private review while governed experiments stay closed", async () => {
  const { workspaceId } = await createWorkspace({ name: "Audience economics E2E", ownerAddress: OWNER });
  const group = await createPrivateGroup({
    accountAddress: OWNER,
    workspaceId,
    name: "Invited E2E reviewers",
    purpose: "Review agent outputs covered by the end-to-end audience matrix.",
    policy: { defaultCompensation: "unpaid", dataClassifications: ["internal", "confidential"] },
  });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "audience-economics-agent",
    version: {
      displayName: "Audience economics agent",
      provider: "OpenAI",
      model: "gpt-5",
      environment: "production",
    },
  });
  const privateProfile = {
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    questionAuthority: "owner_fixed" as const,
    criterion: "Which answer is safest and most useful?",
    positiveLabel: "Use",
    negativeLabel: "Revise",
    rationaleMode: "optional" as const,
    audience: "private_invited" as const,
    contentBoundary: "private_workspace" as const,
    privateSensitivity: "confidential" as const,
    privateGroupId: group.groupId,
    privateGroupPolicyVersion: 1,
    privateGroupPolicyHash: group.policyHash,
    responseWindowSeconds: 1_200,
    panelSize: 2,
    compensationMode: "unpaid" as const,
    bountyPerSeatAtomic: null,
    feedbackBonusEnabled: false,
    feedbackBonusPoolAtomic: null,
    feedbackBonusAwarderKind: "requester" as const,
    feedbackBonusAwarderAccount: null,
    feedbackBonusAwardWindowSeconds: null,
  };
  const created = await createReviewRequestProfile({ accountAddress: OWNER, workspaceId, profile: privateProfile });
  assert.equal(created.audience, "private_invited");

  const candidates = [
    {
      ...privateProfile,
      rationaleMode: "required" as const,
      feedbackBonusEnabled: true,
      feedbackBonusPoolAtomic: "5000000",
      feedbackBonusAwarderKind: "designated" as const,
      feedbackBonusAwarderAccount: DESIGNATED_AWARDER,
      feedbackBonusAwardWindowSeconds: 604_800,
    },
    {
      ...privateProfile,
      audience: "public_network" as const,
      contentBoundary: "public_or_test" as const,
      privateSensitivity: null,
      privateGroupId: null,
      privateGroupPolicyVersion: null,
      privateGroupPolicyHash: null,
      panelSize: 3,
      compensationMode: "usdc" as const,
      bountyPerSeatAtomic: "1250000",
    },
    {
      ...privateProfile,
      audience: "hybrid" as const,
      contentBoundary: "public_or_test" as const,
      privateSensitivity: null,
      panelSize: 4,
      compensationMode: "usdc" as const,
      bountyPerSeatAtomic: "1250000",
    },
  ];
  for (const profile of candidates) {
    await assert.rejects(
      () =>
        updateReviewRequestProfile({
          accountAddress: OWNER,
          workspaceId,
          profileId: created.profileId,
          profile,
        }),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "human_review_experiment_unavailable",
    );
  }

  const listed = await listReviewRequestProfiles({ accountAddress: OWNER, workspaceId, includeHistory: true });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.version, 1);
  assert.equal(listed[0]?.feedbackBonusEnabled, false);
});

test("private review freezes base bounty and Feedback Bonus as two independent switches", () => {
  const base = {
    agentId: "agent_economics_hash",
    agentVersionId: "agent_version_economics_hash",
    questionAuthority: "owner_fixed" as const,
    criterion: "Which answer is best?",
    positiveLabel: "Use",
    negativeLabel: "Revise",
    rationaleMode: "required" as const,
    audience: "private_invited" as const,
    contentBoundary: "private_workspace" as const,
    privateSensitivity: "confidential" as const,
    privateGroupId: "group_economics_hash",
    privateGroupPolicyVersion: 1,
    privateGroupPolicyHash: `sha256:${"58".repeat(32)}`,
    responseWindowSeconds: 3_600,
    panelSize: 3,
    feedbackBonusAwarderKind: "requester" as const,
    feedbackBonusAwarderAccount: null,
  };
  const hashes = new Set<string>();
  for (const baseBounty of [false, true]) {
    for (const feedbackBonus of [false, true]) {
      hashes.add(
        hashReviewRequestProfile({
          ...base,
          compensationMode: baseBounty ? "usdc" : "unpaid",
          bountyPerSeatAtomic: baseBounty ? "1250000" : null,
          feedbackBonusEnabled: feedbackBonus,
          feedbackBonusPoolAtomic: feedbackBonus ? "5000000" : null,
          feedbackBonusAwardWindowSeconds: feedbackBonus ? 604_800 : null,
        }),
      );
    }
  }
  assert.equal(hashes.size, 4);
  assert.ok([...hashes].every(value => /^sha256:[0-9a-f]{64}$/u.test(value)));
});

test("currently unsupported unpaid public and hybrid delivery fails closed after profile configuration", () => {
  const readiness = {
    evaluation: true,
    ownerApproval: true,
    autonomousPublishing: true,
    privateInvitedUnpaid: true,
    privateInvitedPaid: true,
    publicPaidNetwork: true,
    hybridPublicSafe: true,
  };
  for (const audience of ["public_network", "hybrid"] as const) {
    const capability = resolveHumanReviewCapability(
      {
        audience,
        compensationMode: "unpaid",
        contentBoundary: "public_or_test",
        authority: "ask_automatically",
      },
      readiness,
    );
    assert.equal(capability.available, false);
    assert.equal(capability.code, "paid_network_required");
    assert.equal(capability.lane, audience === "public_network" ? "public_paid_network" : "hybrid_public_safe");
  }
});
