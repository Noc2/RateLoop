import {
  WORLD_ID_INVALID_CREDENTIAL_MESSAGE,
  WORLD_ID_NULLIFIER_ALREADY_ASSIGNED_MESSAGE,
  WORLD_ID_RATE_LIMITED_MESSAGE,
  WORLD_ID_WALLET_TRANSACTION_CANCELLED_MESSAGE,
  type WorldIdVerificationStep,
  formatWorldIdError,
  getWorldIdCredentialAttestationErrorMessage,
  getWorldIdRequestPanelState,
  isWorldIdCredentialAttestationRejectedError,
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
      'The contract function "attestHumanCredentialWithV4Proof" reverted. Error: NullifierAlreadyAssigned()',
    ),
    WORLD_ID_NULLIFIER_ALREADY_ASSIGNED_MESSAGE,
  );
});

test("formats invalid World ID credential reverts as fresh retry guidance", () => {
  assert.equal(
    getWorldIdCredentialAttestationErrorMessage(
      'The contract function "attestHumanCredentialWithV4Proof" reverted. Error: InvalidCredential()',
    ),
    WORLD_ID_INVALID_CREDENTIAL_MESSAGE,
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

test("formats user-rejected wallet signatures without exposing request arguments", () => {
  const error = new Error(
    "User rejected the request. Request Arguments: from: 0x7726D7Cb007f56512F52f700013884595fc27e31 to: 0xd5feC5936306651A916d4066BAc6B39bc2FB3FC1 data: 0xffbe1221 Details: MetaMask Tx Signature: User denied transaction signature.",
  );

  assert.equal(isWorldIdCredentialAttestationRejectedError(error), true);
  assert.equal(getWorldIdCredentialAttestationErrorMessage(error), WORLD_ID_WALLET_TRANSACTION_CANCELLED_MESSAGE);
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
  assert.equal(cancelled.title, "Verification cancelled");
  assert.equal(cancelled.detail, "The wallet transaction was cancelled before the credential was recorded.");

  const failed = getWorldIdRequestPanelState({ isError: true, errorCode: "invalid_rp_signature" });
  assert.equal(failed.step, "error");
  assert.equal(failed.canRetry, true);
});
