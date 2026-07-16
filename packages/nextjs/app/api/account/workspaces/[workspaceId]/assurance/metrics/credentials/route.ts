import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { issueAssuranceMetricsCredential, listAssuranceMetricsCredentials } from "~~/lib/tokenless/assuranceMetrics";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string }> };
const NO_STORE = "private, no-store, max-age=0";

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    const credentials = await listAssuranceMetricsCredentials({
      accountAddress: session.principalId,
      workspaceId,
    });
    return NextResponse.json({ credentials }, { headers: { "Cache-Control": NO_STORE } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: { "Cache-Control": NO_STORE }, status: response.status });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const body = (await request.json().catch(() => null)) as { label?: unknown } | null;
    const created = await issueAssuranceMetricsCredential({
      accountAddress: session.principalId,
      workspaceId,
      label: body?.label,
    });
    return NextResponse.json(created, { headers: { "Cache-Control": NO_STORE }, status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: { "Cache-Control": NO_STORE }, status: response.status });
  }
}
