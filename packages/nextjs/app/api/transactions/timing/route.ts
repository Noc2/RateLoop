import { NextRequest, NextResponse } from "next/server";
import { isJsonObjectBody, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 600, windowMs: 60_000 };
const MAX_STRING_LENGTH = 120;
const MAX_METADATA_STRING_LENGTH = 240;
const MAX_CALL_TYPES = 12;
const SENSITIVE_METADATA_KEY_PATTERN =
  /(args?|authorization|body|calldata|data|payload|secret|signature|token|typeddata|userop)/iu;

type SanitizedTimingPayload = {
  action: string;
  attemptIndex?: number;
  bundlerInfrastructureError?: boolean;
  callCount?: number;
  callTypes?: string[];
  chainId?: number;
  contentRegistryAddress?: string;
  deltaMs?: number;
  deploymentKey?: string;
  elapsedMs?: number;
  event: string;
  fallback?: string | boolean;
  feedbackRegistryAddress?: string;
  message?: string;
  metadata?: Record<string, string | number | boolean | null>;
  parentRunId?: string;
  pollCount?: number;
  receiptCount?: number;
  route?: string;
  runId: string;
  segmentIndex?: number;
  sendCallsDurationMs?: number;
  sendCallsSlowThresholdMs?: number;
  source: string;
  sponsorshipMode?: string;
  status?: string;
  statusCode?: number;
  statusToastSuppressed?: boolean;
  thirdwebCallsId?: string;
  transactionHashCount?: number;
  transport?: string;
  walletExecutionMode?: string;
  walletId?: string;
};

function readString(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, MAX_STRING_LENGTH) : fallback;
}

function readFiniteNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value));
}

function readOptionalString(value: unknown) {
  const normalized = readString(value);
  return normalized || undefined;
}

function readOptionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalFallback(value: unknown) {
  if (typeof value === "boolean") return value;
  return readOptionalString(value);
}

function sanitizeCallTypes(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const callTypes = value
    .map(item => readString(item))
    .filter(Boolean)
    .slice(0, MAX_CALL_TYPES);
  return callTypes.length > 0 ? callTypes : undefined;
}

function sanitizeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const metadata: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = readString(rawKey, "");
    if (!key || SENSITIVE_METADATA_KEY_PATTERN.test(key)) continue;

    if (typeof rawValue === "string") {
      metadata[key] = rawValue.slice(0, MAX_METADATA_STRING_LENGTH);
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      metadata[key] = rawValue;
    } else if (typeof rawValue === "boolean" || rawValue === null) {
      metadata[key] = rawValue;
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function sanitizeTimingPayload(body: Record<string, unknown>): SanitizedTimingPayload | null {
  const source = readString(body.source);
  const runId = readString(body.runId);
  const event = readString(body.event);
  if (!source || !runId || !event) return null;

  const chainId = readFiniteNumber(body.chainId);
  return {
    action: readString(body.action, "transaction"),
    attemptIndex: readFiniteNumber(body.attemptIndex),
    bundlerInfrastructureError: readOptionalBoolean(body.bundlerInfrastructureError),
    callCount: readFiniteNumber(body.callCount),
    callTypes: sanitizeCallTypes(body.callTypes),
    chainId,
    contentRegistryAddress: readOptionalString(body.contentRegistryAddress),
    deltaMs: readFiniteNumber(body.deltaMs),
    deploymentKey: readOptionalString(body.deploymentKey),
    elapsedMs: readFiniteNumber(body.elapsedMs),
    event,
    fallback: readOptionalFallback(body.fallback),
    feedbackRegistryAddress: readOptionalString(body.feedbackRegistryAddress),
    message: readOptionalString(body.message),
    metadata: sanitizeMetadata(body.metadata),
    parentRunId: readOptionalString(body.parentRunId),
    pollCount: readFiniteNumber(body.pollCount),
    receiptCount: readFiniteNumber(body.receiptCount),
    route: readOptionalString(body.route),
    runId,
    segmentIndex: readFiniteNumber(body.segmentIndex),
    sendCallsDurationMs: readFiniteNumber(body.sendCallsDurationMs),
    sendCallsSlowThresholdMs: readFiniteNumber(body.sendCallsSlowThresholdMs),
    source,
    sponsorshipMode: readOptionalString(body.sponsorshipMode),
    status: readOptionalString(body.status),
    statusCode: readFiniteNumber(body.statusCode),
    statusToastSuppressed: readOptionalBoolean(body.statusToastSuppressed),
    thirdwebCallsId: readOptionalString(body.thirdwebCallsId),
    transactionHashCount: readFiniteNumber(body.transactionHashCount),
    transport: readOptionalString(body.transport),
    walletExecutionMode: readOptionalString(body.walletExecutionMode),
    walletId: readOptionalString(body.walletId),
  };
}

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(request, RATE_LIMIT, { allowOnStoreUnavailable: false });
  if (limited) return limited;

  const parsedBody = await parseJsonBody(request);
  if (!isJsonObjectBody(parsedBody)) {
    return NextResponse.json({ error: "Invalid timing payload." }, { status: 400 });
  }

  const payload = sanitizeTimingPayload(parsedBody);
  if (!payload) {
    return NextResponse.json({ error: "Invalid timing payload." }, { status: 400 });
  }

  console.info("[transaction-timing]", payload);
  return new NextResponse(null, { status: 204 });
}
