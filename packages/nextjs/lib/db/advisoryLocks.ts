import type { Pool, PoolClient } from "pg";
import "server-only";
import { releasePoolClient, rollbackAndReleasePoolClient } from "~~/lib/db/transactionCleanup";

type AdvisoryLockClient = Pick<PoolClient, "query">;
type AdvisoryLockPool = Pick<Pool, "connect">;

export class AdvisoryLockUnavailableError extends Error {
  readonly code = "database_coordination_busy";
  readonly retryable = true;
  readonly status = 503;

  constructor() {
    super("Database coordination is busy. Retry the operation.");
    this.name = "AdvisoryLockUnavailableError";
  }
}

export async function acquireTransactionAdvisoryLock(client: AdvisoryLockClient, lockKey: string) {
  const result = await client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", [lockKey]);
  if (result.rows[0]?.acquired !== true) {
    throw new AdvisoryLockUnavailableError();
  }
}

export async function withTransactionAdvisoryLocks<T>(
  pool: AdvisoryLockPool,
  lockKeys: readonly string[],
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const lockKey of [...new Set(lockKeys)].sort()) {
      await acquireTransactionAdvisoryLock(client, lockKey);
    }
    const result = await operation(client);
    await client.query("COMMIT");
    releasePoolClient(client);
    return result;
  } catch (error) {
    return rollbackAndReleasePoolClient(client, error);
  }
}
