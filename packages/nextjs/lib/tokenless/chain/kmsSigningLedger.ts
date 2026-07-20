import type { EvmKmsSigningLedger, EvmKmsSigningLedgerEvent } from "@rateloop/node-utils/aws-kms-signing-audit";
import "server-only";
import { dbClient } from "~~/lib/db";

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

export const evmKmsSigningLedger: EvmKmsSigningLedger = {
  append: appendEvmKmsSigningLedgerEvent,
};
