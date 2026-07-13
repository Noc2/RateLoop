import { NextRequest, NextResponse } from "next/server";
import {
  ASSURANCE_API_RESPONSE_HEADERS,
  authenticateAssuranceApiPrincipal,
  getAssuranceApiRunStatus,
} from "~~/lib/tokenless/assuranceIntegrations";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const principal = await authenticateAssuranceApiPrincipal(request.headers.get("authorization"));
    const { runId } = await context.params;
    return NextResponse.json(await getAssuranceApiRunStatus({ principal, runId }), {
      headers: ASSURANCE_API_RESPONSE_HEADERS,
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: ASSURANCE_API_RESPONSE_HEADERS, status: response.status });
  }
}
