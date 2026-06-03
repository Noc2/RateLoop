import {
  WORLD_ID_NULLIFIER_ALREADY_ASSIGNED_MESSAGE,
  WORLD_ID_RATE_LIMITED_MESSAGE,
  type WorldIdVerificationStep,
  formatWorldIdError,
  getWorldIdCredentialAttestationErrorMessage,
  getWorldIdRequestPanelState,
} from "./verificationUiState";
import assert from "node:assert/strict";
import test from "node:test";

function assertStep(input: Parameters<typeof getWorldIdRequestPanelState>[0], expected: WorldIdVerificationStep) {
  assert.equal(getWorldIdRequestPanelState(input).step, expected);
}

test("formats World ID error codes for display", () => {
  assert.equal(formatWorldIdError("user_rejected"), "user rejected");
});

test("formats already-used World ID attestation reverts for display", () => {
  assert.equal(
    getWorldIdCredentialAttestationErrorMessage(
      'The contract function "attestHumanCredentialWithProof" reverted. Error: NullifierAlreadyAssigned()',
    ),
    WORLD_ID_NULLIFIER_ALREADY_ASSIGNED_MESSAGE,
  );
});

test("formats RPC rate-limit errors as retry guidance", () => {
  assert.equal(
    getWorldIdCredentialAttestationErrorMessage(
      "Request exceeds defined limit. Request Arguments: from: 0xf51BA40d80c7687A6A46c6A279ec145069A9da10 to: 0x8eB8B6eF4B7D4C862DE727777994Be7e6a96fa4F Details: Request is being rate limited.",
    ),
    WORLD_ID_RATE_LIMITED_MESSAGE,
  );
});

test("formats stale wallet connector errors as reconnect guidance", () => {
  assert.equal(
    getWorldIdCredentialAttestationErrorMessage("connection.connector.getChainId is not a function"),
    "Your wallet session is still reconnecting. Wait a moment, then try verifying again. If this keeps happening, disconnect and sign in again.",
  );
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
