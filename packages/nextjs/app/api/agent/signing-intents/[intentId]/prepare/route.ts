import { NextRequest, NextResponse } from "next/server";
import {
  AGENT_WRITE_RATE_LIMIT,
  handlePublicAgentRoute,
  isJsonObjectBody,
  jsonBodyErrorResponse,
  parseJsonBody,
} from "~~/lib/agent/http";
import { prepareAgentSigningIntent } from "~~/lib/agent/signingIntents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await context.params;

  return handlePublicAgentRoute({
    handler: async () => {
      const body = await parseJsonBody(request);
      if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

      const { paymentAuthorization, token, walletAddress } = body as {
        paymentAuthorization?: unknown;
        token?: unknown;
        walletAddress?: unknown;
      };
      if (typeof token !== "string" || !token.trim()) {
        return NextResponse.json({ error: "token is required." }, { status: 400 });
      }

      return prepareAgentSigningIntent({
        intentId,
        paymentAuthorization,
        token,
        walletAddress,
      });
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
  });
}
