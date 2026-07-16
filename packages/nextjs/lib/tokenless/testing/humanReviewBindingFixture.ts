import { createHash } from "node:crypto";
import { dbClient } from "~~/lib/db";

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function seedReadyHumanReviewBinding(input: {
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  policyId: string;
  policyVersion?: number;
  actor: string;
}) {
  const policyVersion = input.policyVersion ?? 1;
  const suffix = createHash("sha256")
    .update(`${input.workspaceId}\0${input.policyId}\0${policyVersion}`)
    .digest("hex")
    .slice(0, 32);
  const profileId = `rrp_test_${suffix}`;
  const bindingId = `hrb_test_${suffix}`;
  const profileHash = sha256(`ready-profile\0${suffix}`);
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_request_profiles
          (profile_id,version,workspace_id,agent_id,agent_version_id,criterion,positive_label,negative_label,
           rationale_mode,audience,content_boundary,private_sensitivity,private_group_id,
           private_group_policy_version,private_group_policy_hash,response_window_seconds,panel_size,
           compensation_mode,bounty_per_seat_atomic,configuration_status,profile_hash,created_by,created_at,
           approved_by,approved_at)
          VALUES (?,1,?,?,?,'Is this output correct and safe to use','Approve','Reject','optional',
                  'public_network','public_or_test',NULL,NULL,NULL,NULL,1200,3,'usdc','1000000','ready',?,?,?,?,?)`,
    args: [
      profileId,
      input.workspaceId,
      input.agentId,
      input.agentVersionId,
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
      sha256(`ready-binding\0${suffix}`),
      input.actor,
      now,
      input.actor,
      now,
    ],
  });
  return { bindingId, bindingVersion: 1, profileId, profileVersion: 1, profileHash };
}
