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
  callCount?: number;
  callTypes?: string[];
  chainId?: number;
  deltaMs?: number;
  elapsedMs?: number;
  event: string;
  metadata?: Record<string, string | number | boolean | null>;
  route?: string;
  runId: string;
  source: string;
  sponsorshipMode?: string;
  status?: string;
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
    callCount: readFiniteNumber(body.callCount),
    callTypes: sanitizeCallTypes(body.callTypes),
    chainId,
    deltaMs: readFiniteNumber(body.deltaMs),
    elapsedMs: readFiniteNumber(body.elapsedMs),
    event,
    metadata: sanitizeMetadata(body.metadata),
    route: readOptionalString(body.route),
    runId,
    source,
    sponsorshipMode: readOptionalString(body.sponsorshipMode),
    status: readOptionalString(body.status),
  };
}

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(request, RATE_LIMIT, { allowOnStoreUnavailable: true });
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
