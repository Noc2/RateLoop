import { type WorldIdVerificationStep, formatWorldIdError, getWorldIdRequestPanelState } from "./verificationUiState";
import assert from "node:assert/strict";
import test from "node:test";

function assertStep(input: Parameters<typeof getWorldIdRequestPanelState>[0], expected: WorldIdVerificationStep) {
  assert.equal(getWorldIdRequestPanelState(input).step, expected);
}

test("formats World ID error codes for display", () => {
  assert.equal(formatWorldIdError("user_rejected"), "user rejected");
});

test("derives QR-first request states", () => {
  assertStep({}, "idle");
  assertStep({ isPreparing: true }, "preparing");
  assertStep({ connectorURI: "https://world.example/request" }, "qrReady");
  assertStep({ connectorURI: "https://world.example/request", isAwaitingUserConfirmation: true }, "awaitingApproval");
  assertStep({ hasResult: true, isAwaitingUserConfirmation: true }, "verified");
  assertStep({ hasResult: true, isHostSubmitting: true }, "submittingTx");
});

test("derives retryable terminal states", () => {
  const expired = getWorldIdRequestPanelState({ isError: true, errorCode: "timeout" });
  assert.equal(expired.step, "expired");
  assert.equal(expired.canRetry, true);

  const cancelled = getWorldIdRequestPanelState({ isError: true, errorCode: "user_rejected" });
  assert.equal(cancelled.step, "cancelled");
  assert.equal(cancelled.canRetry, true);

  const failed = getWorldIdRequestPanelState({ isError: true, errorCode: "invalid_rp_signature" });
  assert.equal(failed.step, "error");
  assert.equal(failed.canRetry, true);
});
