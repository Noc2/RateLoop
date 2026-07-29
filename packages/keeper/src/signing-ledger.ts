import type {
  EvmSigningLedger,
  EvmSigningLedgerEvent,
  EvmSigningTerminalEvent,
} from "@rateloop/node-utils/evm-signing-audit";
import { Pool, type QueryResult } from "pg";

export const KEEPER_POSTGRES_CONNECTION_TIMEOUT_MS = 10_000;

type LedgerExecutor = Readonly<{
  query(text: string, values: readonly unknown[]): Promise<QueryResult>;
}>;

function terminalEvent(
  row: Record<string, unknown>,
): EvmSigningTerminalEvent {
  const date = (value: unknown) =>
    value instanceof Date ? value : new Date(String(value));
  return {
    eventId: String(row.event_id),
    attemptId: String(row.attempt_id),
    outcome: row.outcome as EvmSigningTerminalEvent["outcome"],
    signerRole: row.signer_role as EvmSigningTerminalEvent["signerRole"],
    provider: String(row.provider),
    keyId: String(row.key_id),
    digest: row.digest as EvmSigningTerminalEvent["digest"],
    purpose: row.purpose as EvmSigningTerminalEvent["purpose"],
    providerRequestId:
      row.provider_request_id === null
        ? null
        : String(row.provider_request_id),
    errorClass: row.error_class as EvmSigningTerminalEvent["errorClass"],
    retryable: row.retryable as boolean | null,
    signatureHash:
      row.signature_hash as EvmSigningTerminalEvent["signatureHash"],
    transactionHash:
      row.transaction_hash as EvmSigningTerminalEvent["transactionHash"],
    startedAt: date(row.started_at),
    completedAt:
      row.completed_at === null ? null : date(row.completed_at),
    recordedAt: date(row.recorded_at),
  };
}

export function createKeeperEvmSigningLedger(
  executor: LedgerExecutor,
): EvmSigningLedger {
  return {
    async append(event: EvmSigningLedgerEvent) {
      await executor.query(
        `INSERT INTO tokenless_evm_signing_ledger
           (event_id, attempt_id, outcome, signer_role, provider, key_id, digest, purpose,
            provider_request_id, error_class, retryable, signature_hash, transaction_hash,
            started_at, completed_at, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          event.eventId,
          event.attemptId,
          event.outcome,
          event.signerRole,
          event.provider,
          event.keyId,
          event.digest,
          event.purpose,
          event.providerRequestId,
          event.errorClass,
          event.retryable,
          event.signatureHash,
          event.transactionHash,
          event.startedAt,
          event.completedAt,
          event.recordedAt,
        ],
      );
    },
    async readTerminal(attemptId: string) {
      const result = await executor.query(
        `SELECT event_id, attempt_id, outcome, signer_role, provider, key_id, digest, purpose,
                provider_request_id, error_class, retryable, signature_hash, transaction_hash,
                started_at, completed_at, recorded_at
         FROM tokenless_evm_signing_ledger
         WHERE attempt_id = $1 AND outcome IN ('succeeded', 'failed')
         LIMIT 1`,
        [attemptId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? terminalEvent(row) : null;
    },
  };
}

export function createKeeperEvmSigningLedgerPool(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: KEEPER_POSTGRES_CONNECTION_TIMEOUT_MS,
    max: 2,
  });
  return {
    ledger: createKeeperEvmSigningLedger(pool),
    close: () => pool.end(),
  };
}
