import type { EvmKmsSigningLedgerEvent } from "@rateloop/node-utils/aws-kms-signing-audit";
import { describe, expect, it, vi } from "vitest";
import { createKeeperEvmKmsSigningLedger } from "../kms-signing-ledger.js";

describe("keeper EVM KMS signing ledger adapter", () => {
  it("binds audit fields through parameterized SQL without secret signing material", async () => {
    const query = vi.fn(async (_text: string, _values: readonly unknown[]) => ({
      rows: [],
      rowCount: 1,
    }));
    const ledger = createKeeperEvmKmsSigningLedger({ query } as never);
    const event: EvmKmsSigningLedgerEvent = {
      eventId: `kms_evt_${"1".repeat(32)}`,
      attemptId: `kms_att_${"2".repeat(32)}`,
      outcome: "failed",
      signerRole: "keeper",
      keyArn:
        "arn:aws:kms:eu-central-1:123456789012:key/11111111-1111-1111-1111-111111111111",
      digest: `0x${"3".repeat(64)}`,
      purpose: "evm_transaction",
      awsRequestId: "aws-request-keeper-1",
      errorClass: "throttling",
      retryable: true,
      signatureHash: null,
      transactionHash: null,
      startedAt: new Date("2026-07-20T11:00:00.000Z"),
      completedAt: new Date("2026-07-20T11:00:01.000Z"),
      recordedAt: new Date("2026-07-20T11:00:01.000Z"),
    };

    await ledger.append(event);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO tokenless_evm_kms_signing_ledger");
    expect(sql).not.toMatch(/private_key|secret|signature_bytes/iu);
    expect(values).toEqual([
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
    ]);
  });
});
