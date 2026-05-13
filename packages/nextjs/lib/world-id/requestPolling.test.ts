import { type WorldIdPollRequest, pollWorldIdRequest } from "./requestPolling";
import type { IDKitResult } from "@worldcoin/idkit";
import assert from "node:assert/strict";
import test from "node:test";

const TEST_RESULT = {
  action: "rateloop-test",
  environment: "staging",
  nonce: "nonce",
  protocol_version: "3.0",
  responses: [],
} satisfies IDKitResult;

function makeRequest(statuses: Awaited<ReturnType<WorldIdPollRequest["pollOnce"]>>[]): WorldIdPollRequest {
  return {
    async pollOnce() {
      return statuses.shift() ?? { type: "failed", error: "generic_error" };
    },
  };
}

test("pollWorldIdRequest reports awaiting confirmation and returns a completed proof", async () => {
  const controller = new AbortController();
  const awaitingConfirmationStates: boolean[] = [];

  const result = await pollWorldIdRequest(
    makeRequest([
      { type: "waiting_for_connection" },
      { type: "awaiting_confirmation" },
      { type: "confirmed", result: TEST_RESULT },
    ]),
    {
      onAwaitingConfirmation: value => awaitingConfirmationStates.push(value),
      pollIntervalMs: 0,
      signal: controller.signal,
      timeoutMs: 1_000,
    },
  );

  assert.deepEqual(awaitingConfirmationStates, [false, true]);
  assert.deepEqual(result, { success: true, result: TEST_RESULT });
});

test("pollWorldIdRequest returns failed World ID errors", async () => {
  const controller = new AbortController();

  const result = await pollWorldIdRequest(makeRequest([{ type: "failed", error: "invalid_rp_signature" }]), {
    onAwaitingConfirmation: () => undefined,
    pollIntervalMs: 0,
    signal: controller.signal,
    timeoutMs: 1_000,
  });

  assert.deepEqual(result, { success: false, error: "invalid_rp_signature" });
});

test("pollWorldIdRequest returns cancelled when aborted", async () => {
  const controller = new AbortController();
  controller.abort();

  const result = await pollWorldIdRequest(makeRequest([{ type: "confirmed", result: TEST_RESULT }]), {
    onAwaitingConfirmation: () => undefined,
    pollIntervalMs: 0,
    signal: controller.signal,
    timeoutMs: 1_000,
  });

  assert.deepEqual(result, { success: false, error: "cancelled" });
});
