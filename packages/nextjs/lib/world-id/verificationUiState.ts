import { isUserRejectedTransactionError } from "~~/lib/transactionErrors";

export type WorldIdVerificationStep =
  | "idle"
  | "preparing"
  | "qrReady"
  | "awaitingApproval"
  | "submittingTx"
  | "verified"
  | "expired"
  | "cancelled"
  | "error";

type WorldIdRequestStateInput = {
  connectorURI?: string | null;
  errorCode?: string | null;
  hasResult?: boolean;
  isAwaitingUserConfirmation?: boolean;
  isAwaitingUserConnection?: boolean;
  isError?: boolean;
  isHostSubmitting?: boolean;
  isOpen?: boolean;
  isPreparing?: boolean;
};

type WorldIdRequestPanelState = {
  canCancel: boolean;
  canRetry: boolean;
  detail: string;
  step: WorldIdVerificationStep;
  title: string;
};

export function formatWorldIdError(errorCode: string) {
  return errorCode.replace(/_/g, " ");
}

export const WORLD_ID_NULLIFIER_ALREADY_ASSIGNED_MESSAGE =
  "This World ID has already been used to verify another wallet. Use a different World ID or continue with the wallet that was already verified.";

export const WORLD_ID_RATE_LIMITED_MESSAGE =
  "The network is busy right now. Please wait a moment, then try verifying with World ID again.";

export const WORLD_ID_INVALID_CREDENTIAL_MESSAGE =
  "This World ID proof expired or is no longer valid for the connected wallet. Try again with a fresh World ID request.";

export const WORLD_ID_WALLET_TRANSACTION_CANCELLED_MESSAGE =
  "You cancelled the wallet transaction. No World ID credential was recorded.";

export const WORLD_ID_WALLET_SESSION_RECONNECTING_MESSAGE =
  "Your wallet session is still reconnecting. Wait a moment, then try verifying again. If this keeps happening, disconnect and sign in again.";

export const WORLD_ID_SIMULATOR_MAINNET_MESSAGE =
  "World ID simulator proofs cannot be verified on mainnet. Use the production World App, or switch to staging/local for simulator testing.";

const WORLD_ID_WALLET_SESSION_ERROR_CODE = "wallet_session_expired";

function isWorldIdAttestationCallMessage(message: string) {
  return (
    message.includes("attestHumanCredentialWithProof") ||
    message.includes("attestHumanCredentialWithV4Proof") ||
    message.includes("attestWorldCredentialWithV4Proof") ||
    message.includes("attestHumanPresenceWithV4Proof")
  );
}

function getErrorText(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const maybeWalk = (error as { walk?: () => unknown }).walk;
    if (typeof maybeWalk === "function") {
      const walked = maybeWalk.call(error);
      if (walked !== error) {
        return getErrorText(walked);
      }
    }

    const maybeShortMessage = (error as { shortMessage?: unknown }).shortMessage;
    if (typeof maybeShortMessage === "string") {
      return maybeShortMessage;
    }

    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      return maybeMessage;
    }
  }

  return "";
}

export function isWorldIdCredentialAttestationRejectedError(error: unknown) {
  const message = getErrorText(error);

  return (
    isUserRejectedTransactionError(error) ||
    message === WORLD_ID_WALLET_TRANSACTION_CANCELLED_MESSAGE ||
    message.toLowerCase().includes("transaction cancelled")
  );
}

export function isWorldIdCredentialAttestationWalletSessionError(error: unknown) {
  const message = getErrorText(error).toLowerCase();

  return (
    message.includes("connection.connector.getchainid is not a function") ||
    message.includes("your wallet session is still reconnecting") ||
    message.includes("no auth token found when signing message") ||
    message.includes("no auth token found when signing transaction") ||
    message.includes("no auth token found when signing typed data") ||
    message.includes("no auth token provided and no stored auth token found")
  );
}

export function getWorldIdCredentialAttestationErrorMessage(
  error: unknown,
  fallback = "World ID credential attestation failed.",
) {
  const message = getErrorText(error);

  if (isWorldIdCredentialAttestationRejectedError(error)) {
    return WORLD_ID_WALLET_TRANSACTION_CANCELLED_MESSAGE;
  }

  if (message.includes("NullifierAlreadyAssigned")) {
    return WORLD_ID_NULLIFIER_ALREADY_ASSIGNED_MESSAGE;
  }

  if (message.includes("InvalidCredential") && isWorldIdAttestationCallMessage(message)) {
    return WORLD_ID_INVALID_CREDENTIAL_MESSAGE;
  }

  if (
    isWorldIdAttestationCallMessage(message) &&
    (message.includes('Unable to decode signature "0xddae3b71"') ||
      message.includes("with the following signature:\n0xddae3b71"))
  ) {
    return WORLD_ID_SIMULATOR_MAINNET_MESSAGE;
  }

  if (message.includes("Request exceeds defined limit") || message.includes("Request is being rate limited")) {
    return WORLD_ID_RATE_LIMITED_MESSAGE;
  }

  if (isWorldIdCredentialAttestationWalletSessionError(error)) {
    return WORLD_ID_WALLET_SESSION_RECONNECTING_MESSAGE;
  }

  return message || fallback;
}

export function getWorldIdRequestPanelState(input: WorldIdRequestStateInput): WorldIdRequestPanelState {
  if (input.isHostSubmitting) {
    return {
      canCancel: false,
      canRetry: false,
      detail: "Keep this tab open while your wallet submits the on-chain credential transaction.",
      step: "submittingTx",
      title: "Submitting credential",
    };
  }

  if (input.hasResult) {
    return {
      canCancel: false,
      canRetry: false,
      detail: "World ID approved the proof. Your wallet will finish the on-chain attestation.",
      step: "verified",
      title: "Proof approved",
    };
  }

  if (input.isError) {
    const errorCode = input.errorCode ?? "generic_error";
    const isExpired = errorCode === "timeout";
    const isCancelled = errorCode === "cancelled" || errorCode === "user_rejected";
    const isWalletSessionExpired = errorCode === WORLD_ID_WALLET_SESSION_ERROR_CODE;

    return {
      canCancel: false,
      canRetry: true,
      detail: isWalletSessionExpired
        ? "Your wallet session expired before the credential transaction could be signed. Disconnect and sign in again, then retry."
        : isCancelled
          ? "The wallet transaction was cancelled before the credential was recorded."
          : `World ID returned ${formatWorldIdError(errorCode)}.`,
      step: isExpired ? "expired" : isCancelled ? "cancelled" : "error",
      title: isExpired
        ? "Request expired"
        : isCancelled
          ? "Verification cancelled"
          : isWalletSessionExpired
            ? "Wallet session expired"
            : "Verification failed",
    };
  }

  if (input.isAwaitingUserConfirmation) {
    return {
      canCancel: true,
      canRetry: false,
      detail: "Approve the proof request in World App, then return here for the wallet transaction.",
      step: "awaitingApproval",
      title: "Waiting for approval",
    };
  }

  if (input.connectorURI) {
    return {
      canCancel: true,
      canRetry: false,
      detail: "Scan with World App from your phone. This request expires after a short window.",
      step: "qrReady",
      title: "Scan with World App",
    };
  }

  if (input.isPreparing || input.isAwaitingUserConnection || input.isOpen) {
    return {
      canCancel: true,
      canRetry: false,
      detail: "Preparing a signed World ID request for this wallet.",
      step: "preparing",
      title: "Preparing request",
    };
  }

  return {
    canCancel: false,
    canRetry: false,
    detail: "Start a World ID request from this wallet.",
    step: "idle",
    title: "Ready to verify",
  };
}
