import { NextRequest, NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";
import { type WorldIdActionPurpose, getWorldIdServerConfig } from "~~/lib/world-id/config";
import { createWorldIdDiagnosticId } from "~~/lib/world-id/diagnostics";
import { checkRateLimit } from "~~/utils/rateLimit";

const RP_CONTEXT_TTL_SECONDS = 5 * 60;
// H-9 (2026-05-22 audit): rp-context issues signed World ID requests; without a per-IP cap
// it could be hammered to burn through the upstream World ID quota or be used as a free
// signing oracle. 20/min/IP is well above any legitimate enrollment flow.
const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

async function readPurpose(request: NextRequest): Promise<WorldIdActionPurpose> {
  const body = (await request.json().catch(() => ({}))) as { purpose?: string };
  return body.purpose === "presence" ? "presence" : "credential";
}

export async function POST(request: NextRequest): Promise<Response> {
  const limited = await checkRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  const purpose = await readPurpose(request);
  const config = getWorldIdServerConfig(purpose);

  if (!config.rpId || config.rpIdError) {
    console.warn("[world-id] rp-context unavailable", {
      action: config.action,
      appId: config.appId,
      environment: config.environment,
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
      purpose,
      rpId: config.rpId,
    });

    return NextResponse.json({
      action: config.action,
      diagnosticId,
      environment: config.environment,
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
      purpose,
      rpId: config.rpId,
    });
    return NextResponse.json({ error: "World ID request signing failed." }, { status: 500 });
  }
}
