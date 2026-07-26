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

export async function seedLegacyAgentIntegration(input: {
  integrationId: string;
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  reviewPolicyId: string;
  reviewPolicyVersion?: number;
  publishingPolicyId: string;
  publishingPolicyVersion?: number;
  apiKeyId: string;
  humanReviewBindingId: string;
  humanReviewBindingVersion?: number;
  allowedWorkflowKeys: string[];
  grantedScopes: string[];
  actor: string;
}) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 86_400_000);
  const pairingId = `apr_${createHash("sha256").update(input.integrationId).digest("hex").slice(0, 32)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_pairing_sessions
          (pairing_id,workspace_id,api_key_id,credential_hash,credential_prefix,status,
           created_by,resolved_by,created_at,expires_at,approved_at)
          VALUES (?,?,?,?,?,'approved',?,?,?,?,?)`,
    args: [
      pairingId,
      input.workspaceId,
      input.apiKeyId,
      `test-credential:${input.integrationId}`,
      input.integrationId.slice(0, 20),
      input.actor,
      input.actor,
      now,
      expiresAt,
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_integrations
          (integration_id,pairing_id,workspace_id,agent_id,agent_version_id,
           review_policy_id,review_policy_version,publishing_policy_id,publishing_policy_version,
           api_key_id,status,enforcement_mode,allowed_workflow_keys_json,granted_scopes_json,
           credential_expires_at,human_review_binding_id,human_review_binding_version,
           created_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,'active','advisory',?,?,?,?,?,?,?,?)`,
    args: [
      input.integrationId,
      pairingId,
      input.workspaceId,
      input.agentId,
      input.agentVersionId,
      input.reviewPolicyId,
      input.reviewPolicyVersion ?? 1,
      input.publishingPolicyId,
      input.publishingPolicyVersion ?? 1,
      input.apiKeyId,
      JSON.stringify(input.allowedWorkflowKeys),
      JSON.stringify(input.grantedScopes),
      expiresAt,
      input.humanReviewBindingId,
      input.humanReviewBindingVersion ?? 1,
      input.actor,
      now,
      now,
    ],
  });
}
