import type { PoolClient } from "pg";
import "server-only";

export type LockedAssuranceProject = {
  project_id: string;
  status: string;
  workspace_id: string;
};

/**
 * Serializes project archival with every path that can create an active run.
 */
export async function lockAssuranceProjectForRunMutation(client: Pick<PoolClient, "query">, projectId: string) {
  const result = await client.query(
    `SELECT project_id, workspace_id, status
     FROM tokenless_assurance_projects
     WHERE project_id = $1
     LIMIT 1 FOR UPDATE`,
    [projectId],
  );
  return result.rows[0] as LockedAssuranceProject | undefined;
}
