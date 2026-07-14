import { NextRequest, NextResponse } from "next/server";
import { authenticateAgentMcpPrincipal, getAgentRegistrationStatus } from "~~/lib/tokenless/agentIntegrations";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ pairingId: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    const principal = await authenticateAgentMcpPrincipal(request.headers.get("authorization"));
    const { pairingId } = await context.params;
    if (principal.kind !== "pairing" || principal.pairingId !== pairingId)
      throw new TokenlessServiceError("Registration not found.", 404, "registration_not_found");
    return NextResponse.json(await getAgentRegistrationStatus(principal));
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
