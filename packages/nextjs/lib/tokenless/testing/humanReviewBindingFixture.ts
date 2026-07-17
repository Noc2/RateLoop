import { createHash } from "node:crypto";
import { dbClient } from "~~/lib/db";
import { hashHumanReviewConfiguration } from "~~/lib/tokenless/humanReviewConfiguration";
import { hashReviewRequestProfile } from "~~/lib/tokenless/reviewRequestProfiles";

export async function seedReadyHumanReviewBinding(input: {
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  policyId: string;
  policyVersion?: number;
  actor: string;
  feedbackBonus?: {
    poolAtomic: string;
    awarderKind?: "requester" | "designated";
    awarderAccount?: string | null;
    awardWindowSeconds: number;
  };
}) {
  const policyVersion = input.policyVersion ?? 1;
  const suffix = createHash("sha256")
    .update(`${input.workspaceId}\0${input.policyId}\0${policyVersion}`)
    .digest("hex")
    .slice(0, 32);
  const profileId = `rrp_test_${suffix}`;
  const bindingId = `hrb_test_${suffix}`;
  const feedbackBonus = input.feedbackBonus ?? null;
  const profileHash = hashReviewRequestProfile({
    agentId: input.agentId,
    agentVersionId: input.agentVersionId,
    questionAuthority: "owner_fixed",
    criterion: "Is this output correct and safe to use",
    positiveLabel: "Approve",
    negativeLabel: "Reject",
    rationaleMode: "optional",
    audience: "public_network",
    contentBoundary: "public_or_test",
    privateSensitivity: null,
    privateGroupId: null,
    privateGroupPolicyVersion: null,
    privateGroupPolicyHash: null,
    responseWindowSeconds: 1_200,
    panelSize: 3,
    compensationMode: "usdc",
    bountyPerSeatAtomic: "1000000",
    feedbackBonusEnabled: feedbackBonus !== null,
    feedbackBonusPoolAtomic: feedbackBonus?.poolAtomic ?? null,
    feedbackBonusAwarderKind: feedbackBonus?.awarderKind ?? "requester",
    feedbackBonusAwarderAccount: feedbackBonus?.awarderAccount ?? null,
    feedbackBonusAwardWindowSeconds: feedbackBonus?.awardWindowSeconds ?? null,
  });
  const canonicalHash = hashHumanReviewConfiguration({
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    agentVersionId: input.agentVersionId,
    selectionPolicy: { id: input.policyId, version: policyVersion },
    requestProfile: { id: profileId, version: 1, hash: profileHash },
    publishingPolicy: null,
    authority: "check_only",
  });
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_request_profiles
          (profile_id,version,workspace_id,agent_id,agent_version_id,question_authority,result_semantics,
           criterion,positive_label,negative_label,
           rationale_mode,audience,content_boundary,private_sensitivity,private_group_id,
           private_group_policy_version,private_group_policy_hash,response_window_seconds,panel_size,
           compensation_mode,bounty_per_seat_atomic,feedback_bonus_enabled,feedback_bonus_pool_atomic,
           feedback_bonus_awarder_kind,feedback_bonus_awarder_account,feedback_bonus_award_window_seconds,
           configuration_status,profile_hash,created_by,created_at,
           approved_by,approved_at)
          VALUES (?,1,?,?,?,'owner_fixed','assurance','Is this output correct and safe to use','Approve','Reject','optional',
                  'public_network','public_or_test',NULL,NULL,NULL,NULL,1200,3,'usdc','1000000',?,?,?,?,?,'ready',?,?,?,?,?)`,
    args: [
      profileId,
      input.workspaceId,
      input.agentId,
      input.agentVersionId,
      feedbackBonus !== null,
      feedbackBonus?.poolAtomic ?? null,
      feedbackBonus?.awarderKind ?? "requester",
      feedbackBonus?.awarderAccount ?? null,
      feedbackBonus?.awardWindowSeconds ?? null,
      profileHash,
      input.actor,
      now,
      input.actor,
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_human_review_bindings
          (binding_id,version,workspace_id,agent_id,agent_version_id,selection_policy_id,
           selection_policy_version,request_profile_id,request_profile_version,request_profile_hash,
           publishing_policy_id,publishing_policy_version,authority,enabled,canonical_hash,
           created_by,created_at,approved_by,approved_at)
          VALUES (?,1,?,?,?,?,?,?,1,?,NULL,NULL,'check_only',true,?,?,?,?,?)`,
    args: [
      bindingId,
      input.workspaceId,
      input.agentId,
      input.agentVersionId,
      input.policyId,
      policyVersion,
      profileId,
      profileHash,
      canonicalHash,
      input.actor,
      now,
      input.actor,
      now,
    ],
  });
  return { bindingId, bindingVersion: 1, profileId, profileVersion: 1, profileHash };
}
