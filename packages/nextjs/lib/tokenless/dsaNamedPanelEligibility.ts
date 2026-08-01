import type { PoolClient } from "pg";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export async function assertDsaNamedPanelPrincipalEligible(
  client: Pick<PoolClient, "query">,
  input: { workspaceId: string; projectId: string; epochId: string; principalId: string; now?: Date },
) {
  const result = await client.query(
    `SELECT
       EXISTS (SELECT 1 FROM tokenless_workspace_members member
               WHERE member.workspace_id=$1 AND member.account_address=$4) AS has_workspace_authority,
       EXISTS (SELECT 1 FROM tokenless_project_access_assignments access
               WHERE access.workspace_id=$1 AND access.project_id=$2
                 AND access.subject_kind='principal' AND access.subject_reference=$4
                 AND access.status='active'
                 AND (access.expires_at IS NULL OR access.expires_at>$5)) AS has_project_access,
       EXISTS (SELECT 1 FROM tokenless_dsa_named_panel_reference_definitions definition
               WHERE definition.workspace_id=$1 AND definition.epoch_id=$3
                 AND definition.created_by=$4) AS authored_reference_definition`,
    [input.workspaceId, input.projectId, input.epochId, input.principalId, input.now ?? new Date()],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (
    !row ||
    row.has_workspace_authority === true ||
    row.has_project_access === true ||
    row.authored_reference_definition === true
  ) {
    throw new TokenlessServiceError(
      "A reviewer with workspace membership or project access cannot join this blinded reference panel.",
      409,
      "dsa_named_panel_reviewer_access_conflict",
    );
  }
}
