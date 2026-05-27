import { NextRequest, NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";
import { getWorldIdServerConfig } from "~~/lib/world-id/config";
import { checkRateLimit } from "~~/utils/rateLimit";

const RP_CONTEXT_TTL_SECONDS = 5 * 60;
// H-9 (2026-05-22 audit): rp-context issues signed World ID requests; without a per-IP cap
// it could be hammered to burn through the upstream World ID quota or be used as a free
// signing oracle. 20/min/IP is well above any legitimate enrollment flow.
const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export async function POST(request: NextRequest): Promise<Response> {
  const limited = await checkRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  const config = getWorldIdServerConfig();

  if (!config.rpId || !config.signingKey) {
    return NextResponse.json({ error: "World ID is not configured for this deployment." }, { status: 503 });
  }

  try {
    const signature = signRequest({
      action: config.action,
      signingKeyHex: config.signingKey,
      ttl: RP_CONTEXT_TTL_SECONDS,
    });

    return NextResponse.json({
      action: config.action,
      environment: config.environment,
      proofMode: config.proofMode,
      rpContext: {
        rp_id: config.rpId,
        nonce: signature.nonce,
        created_at: signature.createdAt,
        expires_at: signature.expiresAt,
        signature: signature.sig,
      },
    });
  } catch (error) {
    console.error("[world-id] failed to sign request", error);
    return NextResponse.json({ error: "World ID request signing failed." }, { status: 500 });
  }
}
