import type { PoolClient } from "pg";
import "server-only";

type AdvisoryLockClient = Pick<PoolClient, "query" | "release">;

export class AdvisoryLockUnavailableError extends Error {
  readonly code = "database_coordination_busy";
  readonly retryable = true;
  readonly status = 503;

  constructor() {
    super("Database coordination is busy. Retry the operation.");
    this.name = "AdvisoryLockUnavailableError";
  }
}

export class AdvisoryLockReleaseError extends Error {
  readonly code = "database_coordination_release_failed";

  constructor() {
    super("Database coordination could not be released safely.");
    this.name = "AdvisoryLockReleaseError";
  }
}

export async function tryAcquireSessionAdvisoryLock(client: AdvisoryLockClient, lockKey: string) {
  const result = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [lockKey]);
  return result.rows[0]?.acquired === true;
}

export async function acquireSessionAdvisoryLock(client: AdvisoryLockClient, lockKey: string) {
  if (!(await tryAcquireSessionAdvisoryLock(client, lockKey))) {
    throw new AdvisoryLockUnavailableError();
  }
}

export async function acquireTransactionAdvisoryLock(client: AdvisoryLockClient, lockKey: string) {
  const result = await client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", [lockKey]);
  if (result.rows[0]?.acquired !== true) {
    throw new AdvisoryLockUnavailableError();
  }
}

export async function releaseSessionAdvisoryLocksAndConnection(
  client: AdvisoryLockClient,
  acquiredLockKeys: readonly string[],
) {
  try {
    for (const lockKey of [...acquiredLockKeys].reverse()) {
      const result = await client.query("SELECT pg_advisory_unlock(hashtext($1)) AS released", [lockKey]);
      if (result.rows[0]?.released !== true) {
        throw new AdvisoryLockReleaseError();
      }
    }
  } catch (error) {
    client.release(error instanceof Error ? error : new AdvisoryLockReleaseError());
    throw error;
  }
  client.release();
}
