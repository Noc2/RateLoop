import type { PoolClient } from "pg";
import "server-only";

export type LockedAssuranceRun = {
  manifest_hash: string | null;
  policy_hash: string;
  project_id: string;
  run_id: string;
  status: string;
};

/**
 * Serializes run cancellation with every path that can reserve human work.
 */
export async function lockAssuranceRunForWorkMutation(client: Pick<PoolClient, "query">, runId: string) {
  const result = await client.query(
    `SELECT run_id, project_id, status, manifest_hash, policy_hash
     FROM tokenless_assurance_runs
     WHERE run_id = $1
     LIMIT 1 FOR UPDATE`,
    [runId],
  );
  return result.rows[0] as LockedAssuranceRun | undefined;
}
