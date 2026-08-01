import { NextRequest, NextResponse } from "next/server";
import { readApiJsonRequestBody } from "~~/lib/tokenless/apiRequestBody";
import {
  type BenchmarkResearchPersistence,
  createBenchmarkResearchPersistence,
} from "~~/lib/tokenless/benchmarkResearchPersistence";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const COMPLIANCE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export function complianceJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: COMPLIANCE_NO_STORE_HEADERS });
}

export function complianceError(error: unknown) {
  const response = tokenlessErrorResponse(error);
  return complianceJson(response.body, response.status);
}

export async function complianceBody(request: NextRequest, maxBytes = 1024 * 1024) {
  const value = await readApiJsonRequestBody(request, maxBytes);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("Request body must be an object.", 400, "invalid_compliance_request");
  }
  return value as Record<string, unknown>;
}

export function exactBody(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = allowed,
) {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some(key => !allowedSet.has(key)) || required.some(key => !(key in value))) {
    throw new TokenlessServiceError(
      "Request body contains missing or unsupported fields.",
      400,
      "invalid_compliance_request",
    );
  }
  return value;
}

export function canonicalDate(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw new TokenlessServiceError(`${field} must be a canonical UTC timestamp.`, 400, "invalid_compliance_request");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TokenlessServiceError(`${field} must be a canonical UTC timestamp.`, 400, "invalid_compliance_request");
  }
  return parsed;
}

export function bearerSecret(request: NextRequest, notFound: { message: string; code: string }) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._-]{32,512})$/u.exec(authorization);
  if (!match) throw new TokenlessServiceError(notFound.message, 404, notFound.code);
  return match[1]!;
}

type ResearchKey = Readonly<{ keyId: string; secret: Uint8Array }>;

function decodeKey(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43,}$/u.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength >= 32 && decoded.toString("base64url") === value ? new Uint8Array(decoded) : null;
}

function researchKeys(kind: "TOKEN_LOOKUP" | "RECIPIENT_BINDING") {
  const prefix = `TOKENLESS_BENCHMARK_RESEARCH_${kind}_KEY`;
  const currentId = process.env[`${prefix}_VERSION`]?.trim();
  const currentEncoded = process.env[prefix]?.trim();
  const currentSecret = decodeKey(currentEncoded);
  const keys = new Map<string, ResearchKey>();
  if (
    (currentId !== undefined || currentEncoded !== undefined) &&
    (!currentId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(currentId) || !currentSecret)
  ) {
    throw new TokenlessServiceError(
      "Benchmark research access is unavailable.",
      503,
      "benchmark_research_keys_unavailable",
      true,
    );
  }
  if (currentId && currentSecret) keys.set(currentId, { keyId: currentId, secret: currentSecret });
  const keyring = process.env[`${prefix}S_JSON`]?.trim();
  if (keyring) {
    try {
      const parsed = JSON.parse(keyring) as unknown;
      if (!Array.isArray(parsed)) throw new Error("invalid keyring");
      for (const entry of parsed) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("invalid keyring entry");
        const candidate = entry as Record<string, unknown>;
        const secret = decodeKey(candidate.secret);
        if (
          Object.keys(candidate).some(key => key !== "keyId" && key !== "secret") ||
          typeof candidate.keyId !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(candidate.keyId) ||
          !secret
        ) {
          throw new Error("invalid keyring entry");
        }
        keys.set(candidate.keyId, { keyId: candidate.keyId, secret });
      }
    } catch {
      throw new TokenlessServiceError(
        "Benchmark research access is unavailable.",
        503,
        "benchmark_research_keys_unavailable",
        true,
      );
    }
  }
  return { currentId: currentId && keys.has(currentId) ? currentId : null, keys: [...keys.values()] };
}

export function benchmarkResearchApplication(options: { requireKeys?: boolean } = {}): {
  persistence: BenchmarkResearchPersistence;
  currentTokenLookupKeyId: string | null;
  currentRecipientBindingKeyId: string | null;
} {
  if (!options.requireKeys) {
    return {
      persistence: createBenchmarkResearchPersistence(),
      currentTokenLookupKeyId: null,
      currentRecipientBindingKeyId: null,
    };
  }
  const token = researchKeys("TOKEN_LOOKUP");
  const recipient = researchKeys("RECIPIENT_BINDING");
  if (options.requireKeys && (!token.currentId || !recipient.currentId)) {
    throw new TokenlessServiceError(
      "Benchmark research access is unavailable.",
      503,
      "benchmark_research_keys_unavailable",
      true,
    );
  }
  return {
    persistence: createBenchmarkResearchPersistence({
      tokenLookupKeys: token.keys,
      recipientBindingKeys: recipient.keys,
    }),
    currentTokenLookupKeyId: token.currentId,
    currentRecipientBindingKeyId: recipient.currentId,
  };
}

export function benchmarkTokenLookupKeyId(request: NextRequest) {
  const keyId = request.headers.get("x-rateloop-benchmark-key-id")?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(keyId)) {
    throw new TokenlessServiceError("Benchmark research grant not found.", 404, "benchmark_research_grant_not_found");
  }
  return keyId;
}
