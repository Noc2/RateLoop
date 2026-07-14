import { NextRequest, NextResponse } from "next/server";
import { authenticateAgentMcpPrincipal, submitAgentRegistration } from "~~/lib/tokenless/agentIntegrations";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const principal = await authenticateAgentMcpPrincipal(request.headers.get("authorization"));
    if (principal.kind !== "pairing")
      throw new TokenlessServiceError("This credential is already active.", 409, "agent_already_active");
    return NextResponse.json(
      await submitAgentRegistration({ pairing: principal, registration: await request.json() }),
      { status: 202 },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
