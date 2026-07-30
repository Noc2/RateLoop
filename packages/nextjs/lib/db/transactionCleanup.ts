import type { PoolClient } from "pg";
import "server-only";

type ReleasableTransactionClient = Pick<PoolClient, "query" | "release">;

const releasedClients = new WeakSet<object>();

function errorValue(value: unknown, fallback: string) {
  return value instanceof Error ? value : new Error(fallback);
}

export class DatabaseRollbackError extends Error {
  readonly operationError: unknown;

  constructor(operationError: unknown, rollbackError: Error) {
    super("Database transaction rollback failed; the connection was destroyed.", { cause: rollbackError });
    this.name = "DatabaseRollbackError";
    this.operationError = operationError;
  }
}

export function releasePoolClient(client: Pick<PoolClient, "release">, error?: Error) {
  if (releasedClients.has(client)) return;
  releasedClients.add(client);
  client.release(error);
}

export async function rollbackAndReleasePoolClient(
  client: ReleasableTransactionClient,
  operationError: unknown,
): Promise<never> {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    const connectionError = errorValue(rollbackError, "Database transaction rollback failed.");
    releasePoolClient(client, connectionError);
    throw new DatabaseRollbackError(operationError, connectionError);
  }
  releasePoolClient(client);
  throw operationError;
}
