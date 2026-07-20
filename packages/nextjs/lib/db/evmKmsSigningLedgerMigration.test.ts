import { __setDatabaseResourcesForTests, dbClient } from ".";
import { appendEvmKmsSigningLedgerEvent, readEvmKmsSigningTerminalEvent } from "../tokenless/chain/kmsSigningLedger";
import { createMemoryDatabaseResources } from "./testing/testMemory";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { afterEach, beforeEach } from "node:test";

const KEY_ARN = "arn:aws:kms:eu-central-1:123456789012:key/11111111-1111-1111-1111-111111111111";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("0122 installs a constrained append-only EVM KMS signing ledger", () => {
  const migration = readFileSync(join(process.cwd(), "drizzle", "0122_evm_kms_signing_ledger.sql"), "utf8");
  assert.match(migration, /digest/u);
  assert.match(migration, /aws_request_id/u);
  assert.match(migration, /access_or_key_configuration/u);
  assert.match(migration, /malformed_response_or_recovery/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE/u);
  assert.match(migration, /EVM KMS signing ledger is append-only/u);
  assert.doesNotMatch(migration, /private_key|secret|signature_bytes/iu);
});

test("0123 enforces one consistent terminal outcome and purpose-bound transaction identity", () => {
  const migration = readFileSync(join(process.cwd(), "drizzle", "0123_evm_kms_signing_ledger_integrity.sql"), "utf8");
  assert.match(migration, /terminal_unique/u);
  assert.match(migration, /WHERE "outcome" IN \('succeeded', 'failed'\)/u);
  assert.match(migration, /inconsistent attempt identity/u);
  assert.match(migration, /terminal event does not match its attempted event/u);
  assert.match(migration, /"purpose" = 'evm_transaction' AND "transaction_hash" IS NOT NULL/u);
  assert.match(migration, /BEFORE TRUNCATE/u);
});

test("the web adapter persists attempted and terminal events without signing material", async () => {
  const startedAt = new Date("2026-07-20T10:00:00.000Z");
  await appendEvmKmsSigningLedgerEvent({
    eventId: `kms_evt_${"1".repeat(32)}`,
    attemptId: `kms_att_${"a".repeat(32)}`,
    outcome: "attempted",
    signerRole: "credential_issuer",
    keyArn: KEY_ARN,
    digest: `0x${"2".repeat(64)}`,
    purpose: "eip712_typed_data",
    awsRequestId: null,
    errorClass: null,
    retryable: null,
    signatureHash: null,
    transactionHash: null,
    startedAt,
    completedAt: null,
    recordedAt: startedAt,
  });
  await appendEvmKmsSigningLedgerEvent({
    eventId: `kms_evt_${"3".repeat(32)}`,
    attemptId: `kms_att_${"a".repeat(32)}`,
    outcome: "succeeded",
    signerRole: "credential_issuer",
    keyArn: KEY_ARN,
    digest: `0x${"2".repeat(64)}`,
    purpose: "eip712_typed_data",
    awsRequestId: "aws-request-123",
    errorClass: null,
    retryable: null,
    signatureHash: `0x${"4".repeat(64)}`,
    transactionHash: null,
    startedAt,
    completedAt: new Date("2026-07-20T10:00:01.000Z"),
    recordedAt: new Date("2026-07-20T10:00:01.000Z"),
  });

  const rows = await dbClient.execute({
    sql: `SELECT outcome, signer_role, key_arn, digest, purpose, aws_request_id,
                 error_class, retryable, signature_hash, transaction_hash
          FROM tokenless_evm_kms_signing_ledger
          WHERE attempt_id = ? ORDER BY recorded_at ASC`,
    args: [`kms_att_${"a".repeat(32)}`],
  });
  assert.deepEqual(
    rows.rows.map(row => ({ outcome: row.outcome, requestId: row.aws_request_id })),
    [
      { outcome: "attempted", requestId: null },
      { outcome: "succeeded", requestId: "aws-request-123" },
    ],
  );
  assert.equal(Object.hasOwn(rows.rows[1]!, "signature"), false);
  assert.equal(
    (await readEvmKmsSigningTerminalEvent(`kms_att_${"a".repeat(32)}`))?.eventId,
    `kms_evt_${"3".repeat(32)}`,
  );
});

test("0123 rejects a successful transaction event without its transaction hash", async () => {
  const startedAt = new Date("2026-07-20T12:00:00.000Z");
  const attemptId = `kms_att_${"b".repeat(32)}`;
  await appendEvmKmsSigningLedgerEvent({
    eventId: `kms_evt_${"6".repeat(32)}`,
    attemptId,
    outcome: "attempted",
    signerRole: "keeper",
    keyArn: KEY_ARN,
    digest: `0x${"7".repeat(64)}`,
    purpose: "evm_transaction",
    awsRequestId: null,
    errorClass: null,
    retryable: null,
    signatureHash: null,
    transactionHash: null,
    startedAt,
    completedAt: null,
    recordedAt: startedAt,
  });
  await assert.rejects(() =>
    appendEvmKmsSigningLedgerEvent({
      eventId: `kms_evt_${"8".repeat(32)}`,
      attemptId,
      outcome: "succeeded",
      signerRole: "keeper",
      keyArn: KEY_ARN,
      digest: `0x${"7".repeat(64)}`,
      purpose: "evm_transaction",
      awsRequestId: "aws-request-transaction",
      errorClass: null,
      retryable: null,
      signatureHash: `0x${"9".repeat(64)}`,
      transactionHash: null,
      startedAt,
      completedAt: new Date("2026-07-20T12:00:01.000Z"),
      recordedAt: new Date("2026-07-20T12:00:01.000Z"),
    }),
  );
});
