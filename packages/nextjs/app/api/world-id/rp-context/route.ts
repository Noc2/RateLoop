import { NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";
import { getWorldIdServerConfig } from "~~/lib/world-id/config";

const RP_CONTEXT_TTL_SECONDS = 5 * 60;

export async function POST(): Promise<Response> {
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
