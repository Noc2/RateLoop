import { NextRequest, NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";
import { JSON_BODY_TOO_LARGE, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { type WorldIdActionPurpose, getWorldIdServerConfig } from "~~/lib/world-id/config";
import { createWorldIdDiagnosticId } from "~~/lib/world-id/diagnostics";
import { checkRateLimit } from "~~/utils/rateLimit";

const JSON_BODY_MAX_BYTES = 4 * 1024;
const RP_CONTEXT_TTL_SECONDS = 5 * 60;
const INVALID_PURPOSE = Symbol("invalid_world_id_purpose");
// H-9 (2026-05-22 audit): rp-context issues signed World ID requests; without a per-IP cap
// it could be hammered to burn through the upstream World ID quota or be used as a free
// signing oracle. 20/min/IP is well above any legitimate enrollment flow.
const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

async function readPurpose(
  request: NextRequest,
): Promise<WorldIdActionPurpose | typeof INVALID_PURPOSE | typeof JSON_BODY_TOO_LARGE> {
  if (!request.body) {
    return "credential";
  }
  const body = await parseJsonBody(request, { maxBytes: JSON_BODY_MAX_BYTES });
  if (body === JSON_BODY_TOO_LARGE) {
    return JSON_BODY_TOO_LARGE;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return INVALID_PURPOSE;
  }
  const purpose = (body as { purpose?: unknown }).purpose;
  if (purpose === undefined) {
    return "credential";
  }
  return purpose === "credential" || purpose === "presence" ? purpose : INVALID_PURPOSE;
}

export async function POST(request: NextRequest): Promise<Response> {
  const limited = await checkRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  const purpose = await readPurpose(request);
  if (purpose === JSON_BODY_TOO_LARGE) {
    return jsonBodyErrorResponse(purpose);
  }
  if (purpose === INVALID_PURPOSE) {
    return jsonBodyErrorResponse(
      purpose,
      "Request body must be a JSON object with purpose set to credential or presence.",
    );
  }
  const config = getWorldIdServerConfig(purpose);

  if (purpose === "presence" && config.proofMode === "legacy") {
    console.warn("[world-id] rp-context unavailable", {
      action: config.action,
      appId: config.appId,
      environment: config.environment,
      proofMode: config.proofMode,
      purpose,
      reason: "legacy_presence_unsupported",
      rpId: config.rpId,
    });
    return NextResponse.json(
      { error: "World ID v3 does not support fresh recheck requests on this deployment." },
      { status: 400 },
    );
  }

  if (!config.rpId || config.rpIdError) {
    console.warn("[world-id] rp-context unavailable", {
      action: config.action,
      appId: config.appId,
      environment: config.environment,
      proofMode: config.proofMode,
      purpose,
      reason: config.rpIdError ?? "missing_rp_id",
      signingKeyConfigured: Boolean(config.signingKey),
    });
    return NextResponse.json(
      { error: config.rpIdError ?? "World ID relying-party ID is not configured for this deployment." },
      { status: 503 },
    );
  }

  if (!config.signingKey) {
    console.warn("[world-id] rp-context unavailable", {
      action: config.action,
      appId: config.appId,
      environment: config.environment,
      proofMode: config.proofMode,
      purpose,
      reason: "missing_signing_key",
      rpId: config.rpId,
      signingKeyConfigured: false,
    });
    return NextResponse.json({ error: "World ID signing key is not configured for this deployment." }, { status: 503 });
  }

  try {
    const diagnosticId = createWorldIdDiagnosticId();
    const signature = signRequest({
      action: config.action,
      signingKeyHex: config.signingKey,
      ttl: RP_CONTEXT_TTL_SECONDS,
    });

    console.info("[world-id] rp-context issued", {
      action: config.action,
      appId: config.appId,
      diagnosticId,
      environment: config.environment,
      expiresAt: signature.expiresAt,
      proofMode: config.proofMode,
      purpose,
      rpId: config.rpId,
    });

    return NextResponse.json({
      action: config.action,
      diagnosticId,
      environment: config.environment,
      proofMode: config.proofMode,
      purpose,
      rpContext: {
        rp_id: config.rpId,
        nonce: signature.nonce,
        created_at: signature.createdAt,
        expires_at: signature.expiresAt,
        signature: signature.sig,
      },
    });
  } catch (error) {
    console.error("[world-id] failed to sign request", {
      action: config.action,
      appId: config.appId,
      environment: config.environment,
      error,
      proofMode: config.proofMode,
      purpose,
      rpId: config.rpId,
    });
    return NextResponse.json({ error: "World ID request signing failed." }, { status: 500 });
  }
}
