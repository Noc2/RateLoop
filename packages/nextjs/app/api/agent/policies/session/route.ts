import { NextRequest, NextResponse } from "next/server";
import { agentRouteErrorResponse } from "~~/lib/agent/http";
import { normalizeAgentPoliciesReadInput } from "~~/lib/auth/agentPolicies";
import {
  AGENT_POLICIES_SIGNED_READ_SESSION_COOKIE_NAME,
  verifySignedReadSession,
} from "~~/lib/auth/signedReadSessions";
import { checkRateLimit } from "~~/utils/rateLimit";

const READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const limited = await checkRateLimit(request, READ_RATE_LIMIT, {
    extraKeyParts: [typeof address === "string" ? address : undefined],
  });
  if (limited) return limited;

  const normalized = normalizeAgentPoliciesReadInput({ address: typeof address === "string" ? address : undefined });
  if (!normalized.ok) {
    return agentRouteErrorResponse(normalized.error, 400);
  }

  try {
    const hasSession = await verifySignedReadSession(
      request.cookies.get(AGENT_POLICIES_SIGNED_READ_SESSION_COOKIE_NAME)?.value,
      normalized.payload.normalizedAddress,
      "agent_policies",
    );
    return NextResponse.json({ hasSession });
  } catch (error) {
    console.error("Error checking agent policy signed read session:", error);
    return agentRouteErrorResponse("Failed to check agent policy session", 500);
  }
}
