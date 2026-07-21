import type { PoolClient } from "pg";
import "server-only";
import { dbClient } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type PolicyAcceptanceBinding = {
  workspaceId: string;
  groupId: string;
  policyVersion: number;
  policyHash: string;
  principalAddress: string;
  workspaceReviewerAccessGrantId: string;
  workspaceReviewerAccessGrantHash: string;
};

export async function hasAcceptedPrivateGroupPolicy(input: PolicyAcceptanceBinding) {
  const result = await dbClient.execute({
    sql: `SELECT accepted_at FROM tokenless_private_group_policy_acceptances
          WHERE workspace_id=? AND group_id=? AND policy_version=? AND policy_hash=? AND principal_address=?
            AND workspace_reviewer_access_grant_id=? AND workspace_reviewer_access_grant_hash=? LIMIT 1`,
    args: [
      input.workspaceId,
      input.groupId,
      input.policyVersion,
      input.policyHash,
      input.principalAddress,
      input.workspaceReviewerAccessGrantId,
      input.workspaceReviewerAccessGrantHash,
    ],
  });
  return result.rowCount === 1;
}

export async function requirePrivateGroupPolicyAcceptance(
  client: PoolClient,
  input: PolicyAcceptanceBinding & {
    acceptedFromAssignmentId: string;
    acceptedNow: boolean;
    now: Date;
  },
) {
  const existing = await client.query(
    `SELECT accepted_at FROM tokenless_private_group_policy_acceptances
     WHERE workspace_id=$1 AND group_id=$2 AND policy_version=$3 AND policy_hash=$4 AND principal_address=$5
       AND workspace_reviewer_access_grant_id=$6 AND workspace_reviewer_access_grant_hash=$7 LIMIT 1`,
    [
      input.workspaceId,
      input.groupId,
      input.policyVersion,
      input.policyHash,
      input.principalAddress,
      input.workspaceReviewerAccessGrantId,
      input.workspaceReviewerAccessGrantHash,
    ],
  );
  if (existing.rowCount === 1) return { reused: true as const };
  if (!input.acceptedNow) {
    throw new TokenlessServiceError(
      "Accept this reviewer group's current confidentiality terms to open the assignment.",
      428,
      "confidentiality_acceptance_required",
    );
  }
  await client.query(
    `INSERT INTO tokenless_private_group_policy_acceptances
     (workspace_id,group_id,policy_version,policy_hash,principal_address,accepted_from_assignment_id,accepted_at,
      workspace_reviewer_access_grant_id,workspace_reviewer_access_grant_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (group_id,policy_version,principal_address) DO UPDATE SET
       workspace_id=EXCLUDED.workspace_id,
       policy_hash=EXCLUDED.policy_hash,
       accepted_from_assignment_id=EXCLUDED.accepted_from_assignment_id,
       accepted_at=EXCLUDED.accepted_at,
       workspace_reviewer_access_grant_id=EXCLUDED.workspace_reviewer_access_grant_id,
       workspace_reviewer_access_grant_hash=EXCLUDED.workspace_reviewer_access_grant_hash`,
    [
      input.workspaceId,
      input.groupId,
      input.policyVersion,
      input.policyHash,
      input.principalAddress,
      input.acceptedFromAssignmentId,
      input.now,
      input.workspaceReviewerAccessGrantId,
      input.workspaceReviewerAccessGrantHash,
    ],
  );
  const accepted = await client.query(
    `SELECT policy_hash FROM tokenless_private_group_policy_acceptances
     WHERE workspace_id=$1 AND group_id=$2 AND policy_version=$3 AND principal_address=$4
       AND workspace_reviewer_access_grant_id=$5 AND workspace_reviewer_access_grant_hash=$6 LIMIT 1`,
    [
      input.workspaceId,
      input.groupId,
      input.policyVersion,
      input.principalAddress,
      input.workspaceReviewerAccessGrantId,
      input.workspaceReviewerAccessGrantHash,
    ],
  );
  if (accepted.rowCount !== 1 || String(accepted.rows[0]?.policy_hash) !== input.policyHash) {
    throw new TokenlessServiceError("Confidentiality terms changed.", 409, "confidentiality_terms_mismatch");
  }
  return { reused: false as const };
}
