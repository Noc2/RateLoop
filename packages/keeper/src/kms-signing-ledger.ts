import type {
  EvmKmsSigningLedger,
  EvmKmsSigningLedgerEvent,
} from "@rateloop/node-utils/aws-kms-signing-audit";
import { Pool, type QueryResult } from "pg";

type LedgerExecutor = Readonly<{
  query(text: string, values: readonly unknown[]): Promise<QueryResult>;
}>;

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
  };
}

export function createKeeperEvmKmsSigningLedgerPool(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  return {
    ledger: createKeeperEvmKmsSigningLedger(pool),
    close: () => pool.end(),
  };
}
