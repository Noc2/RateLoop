import { __setDatabaseResourcesForTests, dbClient } from ".";
import { appendEvmSigningLedgerEvent, readEvmSigningTerminalEvent } from "../tokenless/chain/signingLedger";
import { createMemoryDatabaseResources } from "./testing/testMemory";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { afterEach, beforeEach } from "node:test";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("historical KMS ledger migrations remain immutable and append-only", () => {
  const createMigration = readFileSync(join(process.cwd(), "drizzle", "0122_evm_kms_signing_ledger.sql"), "utf8");
  const integrityMigration = readFileSync(
    join(process.cwd(), "drizzle", "0123_evm_kms_signing_ledger_integrity.sql"),
    "utf8",
  );
  assert.match(createMigration, /BEFORE UPDATE OR DELETE/u);
  assert.match(integrityMigration, /terminal_unique/u);
  assert.match(integrityMigration, /BEFORE TRUNCATE/u);
  assert.doesNotMatch(`${createMigration}\n${integrityMigration}`, /private_key|secret|signature_bytes/iu);
});

test("0156 installs a provider-neutral ledger and migrates historical receipts", () => {
  const migration = readFileSync(
    join(process.cwd(), "drizzle", "0156_provider_neutral_evm_signing_ledger.sql"),
    "utf8",
  );
  assert.match(migration, /"provider" text NOT NULL/u);
  assert.match(migration, /"key_id" text NOT NULL/u);
  assert.match(migration, /"provider_request_id" text/u);
  assert.match(migration, /SELECT[\s\S]*'aws-kms', "key_arn"/u);
  assert.match(migration, /EVM signing ledger is append-only/u);
  assert.match(migration, /terminal event does not match its attempted event/u);
  assert.doesNotMatch(migration, /private_key|signature_bytes/iu);
});

test("the web adapter persists provider-neutral attempted and terminal events", async () => {
  const startedAt = new Date("2026-07-20T10:00:00.000Z");
  const attemptId = `sig_att_${"a".repeat(32)}`;
  await appendEvmSigningLedgerEvent({
    eventId: `sig_evt_${"1".repeat(32)}`,
    attemptId,
    outcome: "attempted",
    signerRole: "credential_issuer",
    provider: "platform-secret",
    keyId: "platform-secret:credential_issuer:vercel-v1",
    digest: `0x${"2".repeat(64)}`,
    purpose: "eip712_typed_data",
    providerRequestId: null,
    errorClass: null,
    retryable: null,
    signatureHash: null,
    transactionHash: null,
    startedAt,
    completedAt: null,
    recordedAt: startedAt,
  });
  await appendEvmSigningLedgerEvent({
    eventId: `sig_evt_${"3".repeat(32)}`,
    attemptId,
    outcome: "succeeded",
    signerRole: "credential_issuer",
    provider: "platform-secret",
    keyId: "platform-secret:credential_issuer:vercel-v1",
    digest: `0x${"2".repeat(64)}`,
    purpose: "eip712_typed_data",
    providerRequestId: null,
    errorClass: null,
    retryable: null,
    signatureHash: `0x${"4".repeat(64)}`,
    transactionHash: null,
    startedAt,
    completedAt: new Date("2026-07-20T10:00:01.000Z"),
    recordedAt: new Date("2026-07-20T10:00:01.000Z"),
  });

  const rows = await dbClient.execute({
    sql: `SELECT outcome, signer_role, provider, key_id, provider_request_id,
                 digest, purpose, error_class, retryable, signature_hash, transaction_hash
          FROM tokenless_evm_signing_ledger
          WHERE attempt_id = ? ORDER BY recorded_at ASC`,
    args: [attemptId],
  });
  assert.deepEqual(
    rows.rows.map(row => ({
      outcome: row.outcome,
      provider: row.provider,
      requestId: row.provider_request_id,
    })),
    [
      {
        outcome: "attempted",
        provider: "platform-secret",
        requestId: null,
      },
      {
        outcome: "succeeded",
        provider: "platform-secret",
        requestId: null,
      },
    ],
  );
  assert.equal(Object.hasOwn(rows.rows[1]!, "signature"), false);
  assert.equal((await readEvmSigningTerminalEvent(attemptId))?.eventId, `sig_evt_${"3".repeat(32)}`);
});

test("0156 rejects a successful transaction event without its transaction hash", async () => {
  const startedAt = new Date("2026-07-20T12:00:00.000Z");
  const attemptId = `sig_att_${"b".repeat(32)}`;
  const base = {
    attemptId,
    signerRole: "keeper" as const,
    provider: "platform-secret",
    keyId: "platform-secret:keeper:railway-v1",
    digest: `0x${"7".repeat(64)}` as const,
    purpose: "evm_transaction" as const,
    providerRequestId: null,
    startedAt,
  };
  await appendEvmSigningLedgerEvent({
    ...base,
    eventId: `sig_evt_${"6".repeat(32)}`,
    outcome: "attempted",
    errorClass: null,
    retryable: null,
    signatureHash: null,
    transactionHash: null,
    completedAt: null,
    recordedAt: startedAt,
  });
  await assert.rejects(() =>
    appendEvmSigningLedgerEvent({
      ...base,
      eventId: `sig_evt_${"8".repeat(32)}`,
      outcome: "succeeded",
      errorClass: null,
      retryable: null,
      signatureHash: `0x${"9".repeat(64)}`,
      transactionHash: null,
      completedAt: new Date("2026-07-20T12:00:01.000Z"),
      recordedAt: new Date("2026-07-20T12:00:01.000Z"),
    }),
  );
});
