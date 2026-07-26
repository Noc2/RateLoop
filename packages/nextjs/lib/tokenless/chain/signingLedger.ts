import type {
  EvmSigningLedger,
  EvmSigningLedgerEvent,
  EvmSigningTerminalEvent,
} from "@rateloop/node-utils/evm-signing-audit";
import "server-only";
import { dbClient } from "~~/lib/db";

function terminalEvent(row: Record<string, unknown>): EvmSigningTerminalEvent {
  const date = (value: unknown) => (value instanceof Date ? value : new Date(String(value)));
  return {
    eventId: String(row.event_id),
    attemptId: String(row.attempt_id),
    outcome: row.outcome as EvmSigningTerminalEvent["outcome"],
    signerRole: row.signer_role as EvmSigningTerminalEvent["signerRole"],
    provider: String(row.provider),
    keyId: String(row.key_id),
    digest: row.digest as EvmSigningTerminalEvent["digest"],
    purpose: row.purpose as EvmSigningTerminalEvent["purpose"],
    providerRequestId: row.provider_request_id === null ? null : String(row.provider_request_id),
    errorClass: row.error_class as EvmSigningTerminalEvent["errorClass"],
    retryable: row.retryable as boolean | null,
    signatureHash: row.signature_hash as EvmSigningTerminalEvent["signatureHash"],
    transactionHash: row.transaction_hash as EvmSigningTerminalEvent["transactionHash"],
    startedAt: date(row.started_at),
    completedAt: row.completed_at === null ? null : date(row.completed_at),
    recordedAt: date(row.recorded_at),
  };
}

export async function appendEvmSigningLedgerEvent(event: EvmSigningLedgerEvent) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_evm_signing_ledger
            (event_id, attempt_id, outcome, signer_role, provider, key_id, digest, purpose,
             provider_request_id, error_class, retryable, signature_hash, transaction_hash,
             started_at, completed_at, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
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
  });
}

export async function readEvmSigningTerminalEvent(attemptId: string) {
  const result = await dbClient.execute({
    sql: `SELECT event_id, attempt_id, outcome, signer_role, provider, key_id, digest, purpose,
                 provider_request_id, error_class, retryable, signature_hash, transaction_hash,
                 started_at, completed_at, recorded_at
          FROM tokenless_evm_signing_ledger
          WHERE attempt_id = ? AND outcome IN ('succeeded', 'failed')
          LIMIT 1`,
    args: [attemptId],
  });
  const row = result.rows[0];
  return row ? terminalEvent(row) : null;
}

export const evmSigningLedger: EvmSigningLedger = {
  append: appendEvmSigningLedgerEvent,
  readTerminal: readEvmSigningTerminalEvent,
};
