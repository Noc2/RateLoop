import { NextRequest, NextResponse } from "next/server";
import { agentRouteErrorResponse } from "~~/lib/agent/http";
import { listAgentAskSummaries } from "~~/lib/agent/policies";
import { normalizeAgentPoliciesReadInput } from "~~/lib/auth/agentPolicies";
import {
  AGENT_POLICIES_SIGNED_READ_SESSION_COOKIE_NAME,
  verifySignedReadSession,
} from "~~/lib/auth/signedReadSessions";
import { isBlankQueryNumber, parseStrictPositiveQueryNumber } from "~~/lib/http/queryNumbers";
import { checkRateLimit } from "~~/utils/rateLimit";

const READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const policyId = request.nextUrl.searchParams.get("policyId")?.trim();
  const limited = await checkRateLimit(request, READ_RATE_LIMIT, {
    extraKeyParts: [typeof address === "string" ? address : undefined, policyId],
  });
  if (limited) return limited;

  try {
    const normalized = normalizeAgentPoliciesReadInput({ address: typeof address === "string" ? address : undefined });
    if (!normalized.ok) {
      return agentRouteErrorResponse(normalized.error, 400);
    }
    if (!policyId) {
      return agentRouteErrorResponse("Invalid agent policy id", 400);
    }

    const hasSession = await verifySignedReadSession(
      request.cookies.get(AGENT_POLICIES_SIGNED_READ_SESSION_COOKIE_NAME)?.value,
      normalized.payload.normalizedAddress,
      "agent_policies",
    );
    if (!hasSession) {
      return agentRouteErrorResponse("Signed read required", 401);
    }

    const limitParam = request.nextUrl.searchParams.get("limit");
    const parsedLimit = isBlankQueryNumber(limitParam) ? 10 : parseStrictPositiveQueryNumber(limitParam);
    if (parsedLimit === null) {
      return agentRouteErrorResponse("limit must be a positive integer.", 400);
    }
    const limit = Math.min(parsedLimit, 100);
    const items = await listAgentAskSummaries({
      ownerWalletAddress: normalized.payload.normalizedAddress,
      policyId,
      limit,
    });
    return NextResponse.json({ items, count: items.length });
  } catch (error) {
    console.error("Error fetching recent agent asks:", error);
    return agentRouteErrorResponse("Failed to fetch recent agent asks", 500);
  }
}
