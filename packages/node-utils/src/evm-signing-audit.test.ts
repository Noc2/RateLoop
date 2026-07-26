import assert from "node:assert/strict";
import test from "node:test";
import {
  EvmSigningError,
  appendOrReconcileEvmSigningTerminalEvent,
  classifyEvmSigningFailure,
  isEvmSigningFailureRetryable,
  providerRequestId,
  type EvmSigningTerminalEvent,
} from "./evm-signing-audit";

test("shared signing taxonomy distinguishes retryable incidents from operator action", () => {
  assert.equal(classifyEvmSigningFailure({ name: "TimeoutError" }), "timeout");
  assert.equal(
    classifyEvmSigningFailure({ name: "ThrottlingException" }),
    "throttling",
  );
  assert.equal(
    classifyEvmSigningFailure({ name: "AccessDeniedException" }),
    "access_or_key_configuration",
  );
  assert.equal(classifyEvmSigningFailure(new Error("network")), "outage");
  assert.equal(isEvmSigningFailureRetryable("outage"), true);
  assert.equal(
    isEvmSigningFailureRetryable("access_or_key_configuration"),
    false,
  );
});

test("shared signing errors carry provider request identity without provider coupling", () => {
  const providerError = {
    requestId: "provider-request-123",
    name: "ThrottlingException",
  };
  const error = new EvmSigningError(
    "unavailable",
    classifyEvmSigningFailure(providerError),
    { cause: providerError },
  );
  assert.equal(providerRequestId(providerError), "provider-request-123");
  assert.equal(error.providerRequestId, "provider-request-123");
  assert.equal(error.retryable, true);
});

test("terminal reconciliation accepts only the exact durable event", async () => {
  const event: EvmSigningTerminalEvent = {
    eventId: "sig_evt_0123456789abcdef0123456789abcdef",
    attemptId: "sig_att_0123456789abcdef0123456789abcdef",
    outcome: "succeeded",
    signerRole: "keeper",
    provider: "platform-secret",
    keyId: "platform-secret:keeper:v1",
    digest: `0x${"11".repeat(32)}`,
    purpose: "raw_hash",
    providerRequestId: null,
    errorClass: null,
    retryable: null,
    signatureHash: `0x${"22".repeat(32)}`,
    transactionHash: null,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: new Date("2026-01-01T00:00:01.000Z"),
    recordedAt: new Date("2026-01-01T00:00:01.000Z"),
  };
  await appendOrReconcileEvmSigningTerminalEvent(
    {
      append: async () => {
        throw new Error("ack lost");
      },
      readTerminal: async () => event,
    },
    event,
  );

  await assert.rejects(
    appendOrReconcileEvmSigningTerminalEvent(
      {
        append: async () => {
          throw new Error("ack lost");
        },
        readTerminal: async () => ({ ...event, keyId: "wrong" }),
      },
      event,
    ),
    /ledger is unavailable/iu,
  );
});
