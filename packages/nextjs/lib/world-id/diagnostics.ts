import type { WorldIdProofPurpose } from "./credentials";

export type WorldIdDiagnosticEvent = "request_created" | "request_create_failed" | "poll_failed" | "request_exception";

export type WorldIdDiagnosticPhase = "rp_context" | "create_request" | "poll" | "submit_onchain" | "unknown";

export type WorldIdDiagnosticPayload = {
  action?: string;
  appId?: string | null;
  connectorScheme?: string | null;
  credential?: string;
  diagnosticId?: string | null;
  environment?: "production" | "staging" | string;
  errorCode?: string | null;
  event: WorldIdDiagnosticEvent;
  message?: string | null;
  phase?: WorldIdDiagnosticPhase;
  purpose?: WorldIdProofPurpose | "credential" | "presence" | string;
  requestId?: string | null;
  rpContextExpiresAt?: number | string | null;
  rpId?: string | null;
};

const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 240;

export function createWorldIdDiagnosticId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `world-id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getWorldIdRequestId(request: unknown): string | null {
  if (!request || typeof request !== "object") {
    return null;
  }

  const requestId = (request as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.trim() ? requestId : null;
}

export function getConnectorScheme(connectorURI: string | null | undefined): string | null {
  if (!connectorURI) {
    return null;
  }

  try {
    return new URL(connectorURI).protocol.replace(/:$/, "") || "unknown";
  } catch {
    const match = connectorURI.match(/^([a-z][a-z0-9+.-]*):/i);
    return match?.[1]?.toLowerCase() ?? "unknown";
  }
}

export function getWorldIdErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return "Unknown World ID error";
}

export function truncateWorldIdDiagnosticMessage(message: string | null | undefined) {
  if (!message) {
    return null;
  }

  return message.length > MAX_DIAGNOSTIC_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH - 1)}...`
    : message;
}

export async function reportWorldIdDiagnostic(payload: WorldIdDiagnosticPayload) {
  if (typeof fetch !== "function") {
    return;
  }

  try {
    await fetch("/api/world-id/diagnostics", {
      body: JSON.stringify({
        ...payload,
        message: truncateWorldIdDiagnosticMessage(payload.message),
      }),
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
    });
  } catch {
    // Diagnostics must never block the verification flow.
  }
}
