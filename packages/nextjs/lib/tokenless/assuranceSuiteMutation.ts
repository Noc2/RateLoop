import type { PoolClient } from "pg";
import "server-only";

export type LockedAssuranceSuite = {
  manifest_hash: string | null;
  manifest_json: string | null;
  project_id: string;
  rubric_id: string;
  rubric_version: number;
  status: string;
  suite_id: string;
  version: number;
};

/**
 * Every mutation that can change a suite manifest must acquire this row lock
 * before checking draft/frozen state or reading its cases.
 */
export async function lockAssuranceSuiteForMutation(
  client: Pick<PoolClient, "query">,
  suiteId: string,
  suiteVersion: number,
) {
  const result = await client.query(
    `SELECT suite_id, version, project_id, status, rubric_id,
            rubric_version, manifest_hash, manifest_json
     FROM tokenless_assurance_suites
     WHERE suite_id = $1 AND version = $2
     LIMIT 1 FOR UPDATE`,
    [suiteId, suiteVersion],
  );
  return result.rows[0] as LockedAssuranceSuite | undefined;
}
