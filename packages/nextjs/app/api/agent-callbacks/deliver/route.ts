import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { processDueAgentCallbackDeliveries } from "~~/lib/agent-callbacks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AgentCallbackDeliverRouteTestOverrides = {
  processDueAgentCallbackDeliveries?: typeof processDueAgentCallbackDeliveries;
  randomUUID?: typeof randomUUID;
};

let agentCallbackDeliverRouteTestOverrides: AgentCallbackDeliverRouteTestOverrides | null = null;

export function __setAgentCallbackDeliverRouteTestOverridesForTests(
  overrides: AgentCallbackDeliverRouteTestOverrides | null,
) {
  agentCallbackDeliverRouteTestOverrides = overrides;
}

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

function parseLimit(request: NextRequest) {
  const value = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 100) : 25;
}

export async function POST(request: NextRequest) {
  const secret = process.env.CURYO_AGENT_CALLBACK_DELIVERY_SECRET?.trim() ?? "";
  if (!secret) {
    return NextResponse.json({ error: "Callback delivery is not configured." }, { status: 503 });
  }

  const token = request.headers.get("x-curyo-agent-callback-secret")?.trim() || readBearerToken(request);
  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const processDeliveries =
    agentCallbackDeliverRouteTestOverrides?.processDueAgentCallbackDeliveries ?? processDueAgentCallbackDeliveries;
  const createRandomUUID = agentCallbackDeliverRouteTestOverrides?.randomUUID ?? randomUUID;

  const result = await processDeliveries({
    limit: parseLimit(request),
    workerId: `route:${createRandomUUID()}`,
  });

  return NextResponse.json(result);
}
