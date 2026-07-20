import type {
  EvmKmsSigningLedger,
  EvmKmsSigningLedgerEvent,
  EvmKmsSigningTerminalEvent,
} from "@rateloop/node-utils/aws-kms-signing-audit";
import { Pool, type QueryResult } from "pg";

type LedgerExecutor = Readonly<{
  query(text: string, values: readonly unknown[]): Promise<QueryResult>;
}>;

function terminalEvent(
  row: Record<string, unknown>,
): EvmKmsSigningTerminalEvent {
  const date = (value: unknown) =>
    value instanceof Date ? value : new Date(String(value));
  return {
    eventId: String(row.event_id),
    attemptId: String(row.attempt_id),
    outcome: row.outcome as EvmKmsSigningTerminalEvent["outcome"],
    signerRole: row.signer_role as EvmKmsSigningTerminalEvent["signerRole"],
    keyArn: String(row.key_arn),
    digest: row.digest as EvmKmsSigningTerminalEvent["digest"],
    purpose: row.purpose as EvmKmsSigningTerminalEvent["purpose"],
    awsRequestId:
      row.aws_request_id === null ? null : String(row.aws_request_id),
    errorClass: row.error_class as EvmKmsSigningTerminalEvent["errorClass"],
    retryable: row.retryable as boolean | null,
    signatureHash:
      row.signature_hash as EvmKmsSigningTerminalEvent["signatureHash"],
    transactionHash:
      row.transaction_hash as EvmKmsSigningTerminalEvent["transactionHash"],
    startedAt: date(row.started_at),
    completedAt: row.completed_at === null ? null : date(row.completed_at),
    recordedAt: date(row.recorded_at),
  };
}

export function createKeeperEvmKmsSigningLedger(
  executor: LedgerExecutor,
): EvmKmsSigningLedger {
  return {
    async append(event: EvmKmsSigningLedgerEvent) {
      await executor.query(
        `INSERT INTO tokenless_evm_kms_signing_ledger
           (event_id, attempt_id, outcome, signer_role, key_arn, digest, purpose,
            aws_request_id, error_class, retryable, signature_hash, transaction_hash,
            started_at, completed_at, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          event.eventId,
          event.attemptId,
          event.outcome,
          event.signerRole,
          event.keyArn,
          event.digest,
          event.purpose,
          event.awsRequestId,
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
        `SELECT event_id, attempt_id, outcome, signer_role, key_arn, digest, purpose,
                aws_request_id, error_class, retryable, signature_hash, transaction_hash,
                started_at, completed_at, recorded_at
         FROM tokenless_evm_kms_signing_ledger
         WHERE attempt_id = $1 AND outcome IN ('succeeded', 'failed')
         LIMIT 1`,
        [attemptId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? terminalEvent(row) : null;
    },
  };
}

export function createKeeperEvmKmsSigningLedgerPool(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  return {
    ledger: createKeeperEvmKmsSigningLedger(pool),
    close: () => pool.end(),
  };
}
