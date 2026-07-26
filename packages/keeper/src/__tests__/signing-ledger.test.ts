import type { EvmSigningLedgerEvent } from "@rateloop/node-utils/evm-signing-audit";
import { describe, expect, it, vi } from "vitest";
import { createKeeperEvmSigningLedger } from "../signing-ledger.js";

describe("keeper EVM signing ledger adapter", () => {
  it("binds provider-neutral audit fields without secret signing material", async () => {
    const query = vi.fn(
      async (_text: string, _values: readonly unknown[]) => ({
        rows: [],
        rowCount: 1,
      }),
    );
    const ledger = createKeeperEvmSigningLedger({ query } as never);
    const event: EvmSigningLedgerEvent = {
      eventId: `sig_evt_${"1".repeat(32)}`,
      attemptId: `sig_att_${"2".repeat(32)}`,
      outcome: "failed",
      signerRole: "keeper",
      provider: "platform-secret",
      keyId: "platform-secret:keeper:railway-tokenless-v1",
      digest: `0x${"3".repeat(64)}`,
      purpose: "evm_transaction",
      providerRequestId: null,
      errorClass: "malformed_response_or_recovery",
      retryable: false,
      signatureHash: null,
      transactionHash: null,
      startedAt: new Date("2026-07-20T11:00:00.000Z"),
      completedAt: new Date("2026-07-20T11:00:01.000Z"),
      recordedAt: new Date("2026-07-20T11:00:01.000Z"),
    };

    await ledger.append(event);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO tokenless_evm_signing_ledger");
    expect(sql).not.toMatch(/private_key|secret|signature_bytes/iu);
    expect(values).toEqual([
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
    ]);
  });

  it("reads a terminal event for lost-write acknowledgement reconciliation", async () => {
    const row = {
      event_id: `sig_evt_${"1".repeat(32)}`,
      attempt_id: `sig_att_${"2".repeat(32)}`,
      outcome: "succeeded",
      signer_role: "keeper",
      provider: "platform-secret",
      key_id: "platform-secret:keeper:railway-tokenless-v1",
      digest: `0x${"3".repeat(64)}`,
      purpose: "evm_transaction",
      provider_request_id: null,
      error_class: null,
      retryable: null,
      signature_hash: `0x${"4".repeat(64)}`,
      transaction_hash: `0x${"5".repeat(64)}`,
      started_at: new Date("2026-07-20T11:00:00.000Z"),
      completed_at: new Date("2026-07-20T11:00:01.000Z"),
      recorded_at: new Date("2026-07-20T11:00:01.000Z"),
    };
    const query = vi.fn(
      async (_text: string, _values: readonly unknown[]) => ({
        rows: [row],
        rowCount: 1,
      }),
    );
    const ledger = createKeeperEvmSigningLedger({ query } as never);

    await expect(ledger.readTerminal(row.attempt_id)).resolves.toMatchObject({
      eventId: row.event_id,
      outcome: "succeeded",
      provider: row.provider,
      keyId: row.key_id,
      providerRequestId: null,
      transactionHash: row.transaction_hash,
    });
    expect(query.mock.calls[0]?.[0]).toContain(
      "outcome IN ('succeeded', 'failed')",
    );
  });
});
