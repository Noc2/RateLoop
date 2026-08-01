import type { PoolClient } from "pg";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

/**
 * One authoritative clock for immutable DSA evidence written in a database transaction.
 * Source-event timestamps remain source facts; record, reconciliation, and freeze times do not.
 */
export async function dsaEvidenceTransactionTimestamp(client: PoolClient) {
  const result = await client.query("SELECT tokenless_dsa_evidence_transaction_timestamp() AS transaction_time");
  const value = result.rows[0]?.transaction_time;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new TokenlessServiceError("The DSA evidence transaction clock is invalid.", 500, "stored_dsa_evidence_invalid");
  }
  return parsed;
}

/**
 * Late wall-clock time for a commitment whose digest must cover the instant at
 * which the complete source projection has already been constructed.
 *
 * This is deliberately distinct from transaction_timestamp(): a long-running
 * repeatable-read/serializable transaction keeps its snapshot timestamp fixed.
 */
export async function dsaEvidenceCommitTimestamp(client: PoolClient) {
  const result = await client.query("SELECT tokenless_dsa_evidence_commit_timestamp() AS commit_time");
  const value = result.rows[0]?.commit_time;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new TokenlessServiceError("The DSA evidence commit clock is invalid.", 500, "stored_dsa_evidence_invalid");
  }
  return parsed;
}
