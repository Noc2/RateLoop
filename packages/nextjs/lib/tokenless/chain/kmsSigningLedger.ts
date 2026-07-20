import type {
  EvmKmsSigningLedger,
  EvmKmsSigningLedgerEvent,
  EvmKmsSigningTerminalEvent,
} from "@rateloop/node-utils/aws-kms-signing-audit";
import "server-only";
import { dbClient } from "~~/lib/db";

function terminalEvent(row: Record<string, unknown>): EvmKmsSigningTerminalEvent {
  const date = (value: unknown) => (value instanceof Date ? value : new Date(String(value)));
  return {
    eventId: String(row.event_id),
    attemptId: String(row.attempt_id),
    outcome: row.outcome as EvmKmsSigningTerminalEvent["outcome"],
    signerRole: row.signer_role as EvmKmsSigningTerminalEvent["signerRole"],
    keyArn: String(row.key_arn),
    digest: row.digest as EvmKmsSigningTerminalEvent["digest"],
    purpose: row.purpose as EvmKmsSigningTerminalEvent["purpose"],
    awsRequestId: row.aws_request_id === null ? null : String(row.aws_request_id),
    errorClass: row.error_class as EvmKmsSigningTerminalEvent["errorClass"],
    retryable: row.retryable as boolean | null,
    signatureHash: row.signature_hash as EvmKmsSigningTerminalEvent["signatureHash"],
    transactionHash: row.transaction_hash as EvmKmsSigningTerminalEvent["transactionHash"],
    startedAt: date(row.started_at),
    completedAt: row.completed_at === null ? null : date(row.completed_at),
    recordedAt: date(row.recorded_at),
  };
}

export async function appendEvmKmsSigningLedgerEvent(event: EvmKmsSigningLedgerEvent) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_evm_kms_signing_ledger
            (event_id, attempt_id, outcome, signer_role, key_arn, digest, purpose,
             aws_request_id, error_class, retryable, signature_hash, transaction_hash,
             started_at, completed_at, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
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
  });
}

export async function readEvmKmsSigningTerminalEvent(attemptId: string) {
  const result = await dbClient.execute({
    sql: `SELECT event_id, attempt_id, outcome, signer_role, key_arn, digest, purpose,
                 aws_request_id, error_class, retryable, signature_hash, transaction_hash,
                 started_at, completed_at, recorded_at
          FROM tokenless_evm_kms_signing_ledger
          WHERE attempt_id = ? AND outcome IN ('succeeded', 'failed')
          LIMIT 1`,
    args: [attemptId],
  });
  const row = result.rows[0];
  return row ? terminalEvent(row) : null;
}

export const evmKmsSigningLedger: EvmKmsSigningLedger = {
  append: appendEvmKmsSigningLedgerEvent,
  readTerminal: readEvmKmsSigningTerminalEvent,
};
