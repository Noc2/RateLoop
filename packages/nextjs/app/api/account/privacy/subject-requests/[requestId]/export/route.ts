import { type NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { readSubjectRequestExport } from "~~/lib/privacy/lifecycle";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ requestId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { requestId } = await context.params;
    const value = await readSubjectRequestExport({ principalId: session.principalId, requestId });
    return NextResponse.json(value, {
      headers: {
        ...NO_STORE,
        "Content-Disposition": `attachment; filename="rateloop-subject-export-${requestId}.json"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}
