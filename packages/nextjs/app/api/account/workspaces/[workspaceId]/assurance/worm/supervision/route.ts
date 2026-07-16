import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { buildAssuranceSupervisionReport } from "~~/lib/tokenless/assuranceWormExports";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ workspaceId: string }> };

function date(value: string | null, name: string) {
  if (value === null) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TokenlessServiceError(`${name} must be an ISO timestamp.`, 400, "invalid_supervision_period");
  }
  return parsed;
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    const from = date(request.nextUrl.searchParams.get("from"), "from");
    const to = date(request.nextUrl.searchParams.get("to"), "to");
    if ([...request.nextUrl.searchParams.keys()].some(key => key !== "from" && key !== "to")) {
      throw new TokenlessServiceError("Unsupported report query parameter.", 400, "invalid_supervision_period");
    }
    return NextResponse.json(
      await buildAssuranceSupervisionReport({ accountAddress: session.principalId, workspaceId, from, to }),
      { headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}
