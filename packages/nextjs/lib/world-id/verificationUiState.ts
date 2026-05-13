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

export type WorldIdRequestPanelState = {
  canCancel: boolean;
  canRetry: boolean;
  detail: string;
  step: WorldIdVerificationStep;
  title: string;
};

export function formatWorldIdError(errorCode: string) {
  return errorCode.replace(/_/g, " ");
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

    return {
      canCancel: false,
      canRetry: true,
      detail: `World ID returned ${formatWorldIdError(errorCode)}.`,
      step: isExpired ? "expired" : isCancelled ? "cancelled" : "error",
      title: isExpired ? "Request expired" : isCancelled ? "Verification cancelled" : "Verification failed",
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
