import { NextRequest, NextResponse } from "next/server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { processDueAgentCallbackDeliveries } from "~~/lib/agent-callbacks";
import { sweepAgentLifecycleCallbacks } from "~~/lib/agent-callbacks/lifecycle";
import { getAgentCallbackSweepRouteTestOverrides } from "~~/lib/agent-callbacks/route-test-overrides";
import { sweepExpiredHandoffIntents } from "~~/lib/agent/handoffs";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CALLBACK_SWEEP_ROUTE_RATE_LIMIT = {
  limit: 30,
  windowMs: 60_000,
};

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

function parseLimit(request: NextRequest) {
  const value = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 100) : 25;
}

function isAuthorizedCallbackRequest(token: string, secret: string) {
  const tokenBuffer = Buffer.from(token);
  const secretBuffer = Buffer.from(secret);
  return tokenBuffer.length === secretBuffer.length && timingSafeEqual(tokenBuffer, secretBuffer);
}

function getCallbackSweepSecrets() {
  return [process.env.RATELOOP_AGENT_CALLBACK_DELIVERY_SECRET?.trim(), process.env.CRON_SECRET?.trim()].filter(
    (secret): secret is string => Boolean(secret),
  );
}

async function handleSweep(request: NextRequest) {
  const secrets = getCallbackSweepSecrets();
  if (secrets.length === 0) {
    return NextResponse.json({ error: "Callback delivery is not configured." }, { status: 503 });
  }

  const rateLimitResponse = await checkRateLimit(request, CALLBACK_SWEEP_ROUTE_RATE_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  const token = request.headers.get("x-rateloop-agent-callback-secret")?.trim() || readBearerToken(request);
  if (!secrets.some(secret => isAuthorizedCallbackRequest(token, secret))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const overrides = getAgentCallbackSweepRouteTestOverrides();
  const sweepCallbacks = overrides?.sweepAgentLifecycleCallbacks ?? sweepAgentLifecycleCallbacks;
  const sweepHandoffs = overrides?.sweepExpiredHandoffIntents ?? sweepExpiredHandoffIntents;
  const processDeliveries = overrides?.processDueAgentCallbackDeliveries ?? processDueAgentCallbackDeliveries;
  const createRandomUUID = overrides?.randomUUID ?? randomUUID;

  const limit = parseLimit(request);
  const [callbacks, handoffs] = await Promise.all([sweepCallbacks({ limit }), sweepHandoffs(limit)]);
  const deliveries = await processDeliveries({
    limit,
    workerId: `sweep:${createRandomUUID()}`,
  });

  return NextResponse.json({ ...callbacks, handoffs, deliveries });
}

export async function GET(request: NextRequest) {
  return handleSweep(request);
}

export async function POST(request: NextRequest) {
  return handleSweep(request);
}
