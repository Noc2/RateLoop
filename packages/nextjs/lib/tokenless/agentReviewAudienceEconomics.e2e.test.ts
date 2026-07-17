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

test("all audiences persist optional Feedback Bonus while private review also supports an optional base bounty", async () => {
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
  let index = 0;
  let profileId: string | null = null;

  for (const audience of ["private_invited", "public_network", "hybrid"] as const) {
    for (const baseBounty of audience === "private_invited" ? [false, true] : [true]) {
      for (const feedbackBonus of [false, true]) {
        const designated = feedbackBonus && index % 2 === 1;
        const profileInput = {
          agentId: agent.agentId,
          agentVersionId: agent.currentVersion.versionId,
          criterion: "Which answer is safest and most useful?",
          positiveLabel: "Use",
          negativeLabel: "Revise",
          rationaleMode: feedbackBonus ? ("required" as const) : ("optional" as const),
          audience,
          contentBoundary:
            audience === "private_invited" ? ("private_workspace" as const) : ("public_or_test" as const),
          privateSensitivity: audience === "private_invited" ? ("confidential" as const) : null,
          privateGroupId: audience === "public_network" ? null : group.groupId,
          privateGroupPolicyVersion: audience === "public_network" ? null : 1,
          privateGroupPolicyHash: audience === "public_network" ? null : group.policyHash,
          responseWindowSeconds: index % 2 === 0 ? 1_200 : 86_400,
          panelSize: audience === "private_invited" ? 2 : 3,
          compensationMode: baseBounty ? ("usdc" as const) : ("unpaid" as const),
          bountyPerSeatAtomic: baseBounty ? "1250000" : null,
          feedbackBonusEnabled: feedbackBonus,
          feedbackBonusPoolAtomic: feedbackBonus ? "5000000" : null,
          feedbackBonusAwarderKind: designated ? ("designated" as const) : ("requester" as const),
          feedbackBonusAwarderAccount: designated ? DESIGNATED_AWARDER : null,
          feedbackBonusAwardWindowSeconds: feedbackBonus ? 604_800 : null,
        };
        let profile: Awaited<ReturnType<typeof createReviewRequestProfile>>;
        if (profileId === null) {
          profile = await createReviewRequestProfile({ accountAddress: OWNER, workspaceId, profile: profileInput });
        } else {
          profile = await updateReviewRequestProfile({
            accountAddress: OWNER,
            workspaceId,
            profileId,
            profile: profileInput,
          });
        }
        profileId = profile.profileId;
        assert.equal(profile.audience, audience);
        assert.equal(profile.compensationMode, baseBounty ? "usdc" : "unpaid");
        assert.equal(profile.bountyPerSeatAtomic, baseBounty ? "1250000" : null);
        assert.equal(profile.feedbackBonusEnabled, feedbackBonus);
        assert.equal(profile.feedbackBonusPoolAtomic, feedbackBonus ? "5000000" : null);
        assert.equal(profile.feedbackBonusAwarderKind, designated ? "designated" : "requester");
        assert.equal(profile.feedbackBonusAwarderAccount, designated ? DESIGNATED_AWARDER : null);
        assert.equal(profile.feedbackBonusAwardWindowSeconds, feedbackBonus ? 604_800 : null);
        assert.equal(profile.responseWindowSeconds, index % 2 === 0 ? 1_200 : 86_400);
        index += 1;
      }
    }
  }

  const listed = await listReviewRequestProfiles({ accountAddress: OWNER, workspaceId, includeHistory: true });
  assert.equal(listed.length, 8);
  assert.equal(new Set(listed.map(profile => profile.profileId)).size, 1);
  assert.deepEqual(new Set(listed.map(profile => profile.version)), new Set([1, 2, 3, 4, 5, 6, 7, 8]));
  assert.deepEqual(
    new Set(listed.map(profile => `${profile.compensationMode}:${profile.feedbackBonusEnabled}`)),
    new Set(["unpaid:false", "unpaid:true", "usdc:false", "usdc:true"]),
  );
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
