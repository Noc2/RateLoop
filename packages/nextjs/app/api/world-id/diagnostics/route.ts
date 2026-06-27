import { NextRequest, NextResponse } from "next/server";
import { JSON_BODY_TOO_LARGE, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import {
  type WorldIdDiagnosticEvent,
  type WorldIdDiagnosticPayload,
  type WorldIdDiagnosticPhase,
  truncateWorldIdDiagnosticMessage,
} from "~~/lib/world-id/diagnostics";
import { checkRateLimit } from "~~/utils/rateLimit";

const JSON_BODY_MAX_BYTES = 4 * 1024;
const RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const ALLOWED_EVENTS = new Set<WorldIdDiagnosticEvent>([
  "request_created",
  "request_create_failed",
  "poll_failed",
  "request_exception",
]);
const ALLOWED_PHASES = new Set<WorldIdDiagnosticPhase>([
  "rp_context",
  "create_request",
  "poll",
  "submit_onchain",
  "unknown",
]);

function cleanString(value: unknown, maxLength = 160) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function cleanNumberOrString(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }

  return cleanString(value, 32);
}

function isWorldIdDiagnosticEvent(value: string | undefined): value is WorldIdDiagnosticEvent {
  return Boolean(value && ALLOWED_EVENTS.has(value as WorldIdDiagnosticEvent));
}

function isWorldIdDiagnosticPhase(value: string | undefined): value is WorldIdDiagnosticPhase {
  return Boolean(value && ALLOWED_PHASES.has(value as WorldIdDiagnosticPhase));
}

function normalizeDiagnosticPayload(value: unknown): WorldIdDiagnosticPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Record<string, unknown>;
  const event = cleanString(input.event, 48);
  if (!isWorldIdDiagnosticEvent(event)) {
    return null;
  }

  const phase = cleanString(input.phase, 48);

  return {
    action: cleanString(input.action),
    appId: cleanString(input.appId, 96),
    connectorScheme: cleanString(input.connectorScheme, 32),
    credential: cleanString(input.credential, 64),
    diagnosticId: cleanString(input.diagnosticId, 96),
    environment: cleanString(input.environment, 32),
    errorCode: cleanString(input.errorCode, 96),
    event,
    message: truncateWorldIdDiagnosticMessage(cleanString(input.message, 512)),
    phase: isWorldIdDiagnosticPhase(phase) ? phase : "unknown",
    proofMode: cleanString(input.proofMode, 32),
    purpose: cleanString(input.purpose, 32),
    requestId: cleanString(input.requestId, 128),
    rpContextExpiresAt: cleanNumberOrString(input.rpContextExpiresAt),
    rpId: cleanString(input.rpId, 96),
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  const limited = await checkRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  const body = await parseJsonBody(request, { maxBytes: JSON_BODY_MAX_BYTES });
  if (body === JSON_BODY_TOO_LARGE) {
    return jsonBodyErrorResponse(body);
  }

  const payload = normalizeDiagnosticPayload(body);
  if (!payload) {
    return NextResponse.json({ error: "Invalid World ID diagnostic payload." }, { status: 400 });
  }

  console.warn("[world-id] client diagnostic", payload);
  return NextResponse.json({ ok: true });
}
