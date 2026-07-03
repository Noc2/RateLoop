import { NextRequest, NextResponse } from "next/server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { processDueAgentCallbackDeliveries } from "~~/lib/agent-callbacks";
import { getAgentCallbackDeliverRouteTestOverrides } from "~~/lib/agent-callbacks/route-test-overrides";
import { isBlankQueryNumber, parseStrictPositiveQueryNumber } from "~~/lib/http/queryNumbers";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CALLBACK_DELIVERY_ROUTE_RATE_LIMIT = {
  limit: 30,
  windowMs: 60_000,
};

type LimitParseResult = { limit: number; ok: true } | { ok: false; response: NextResponse };

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

function parseLimit(request: NextRequest): LimitParseResult {
  const value = request.nextUrl.searchParams.get("limit");
  if (isBlankQueryNumber(value)) return { limit: 25, ok: true };
  const parsed = parseStrictPositiveQueryNumber(value);
  if (parsed === null) {
    return {
      ok: false,
      response: NextResponse.json({ error: "limit must be a positive integer." }, { status: 400 }),
    };
  }
  return { limit: Math.min(parsed, 100), ok: true };
}

function isAuthorizedCallbackRequest(token: string, secret: string) {
  const tokenBuffer = Buffer.from(token);
  const secretBuffer = Buffer.from(secret);
  return tokenBuffer.length === secretBuffer.length && timingSafeEqual(tokenBuffer, secretBuffer);
}

export async function POST(request: NextRequest) {
  const secret = process.env.RATELOOP_AGENT_CALLBACK_DELIVERY_SECRET?.trim() ?? "";
  if (!secret) {
    return NextResponse.json({ error: "Callback delivery is not configured." }, { status: 503 });
  }

  const rateLimitResponse = await checkRateLimit(request, CALLBACK_DELIVERY_ROUTE_RATE_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  const token = request.headers.get("x-rateloop-agent-callback-secret")?.trim() || readBearerToken(request);
  if (!isAuthorizedCallbackRequest(token, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const overrides = getAgentCallbackDeliverRouteTestOverrides();
  const processDeliveries = overrides?.processDueAgentCallbackDeliveries ?? processDueAgentCallbackDeliveries;
  const createRandomUUID = overrides?.randomUUID ?? randomUUID;

  const parsedLimit = parseLimit(request);
  if (!parsedLimit.ok) return parsedLimit.response;

  const result = await processDeliveries({
    limit: parsedLimit.limit,
    workerId: `route:${createRandomUUID()}`,
  });

  return NextResponse.json(result);
}
