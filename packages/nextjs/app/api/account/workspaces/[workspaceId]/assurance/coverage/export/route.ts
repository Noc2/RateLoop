import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { exportAdaptiveCoverage } from "~~/lib/tokenless/adaptiveCoverageExport";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = "private, no-store, max-age=0";
type Context = { params: Promise<{ workspaceId: string }> };

function boundary(request: NextRequest, name: "from" | "to") {
  const values = request.nextUrl.searchParams.getAll(name);
  if (values.length > 1) {
    throw new TokenlessServiceError(`${name} may be supplied only once.`, 400, "invalid_coverage_export_window");
  }
  return values[0] === undefined ? undefined : new Date(values[0]);
}

export async function GET(request: NextRequest, context: Context) {
  try {
    if ([...request.nextUrl.searchParams.keys()].some(key => key !== "from" && key !== "to")) {
      throw new TokenlessServiceError(
        "Coverage exports accept only from and to boundaries.",
        400,
        "invalid_coverage_export_window",
      );
    }
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    const exported = await exportAdaptiveCoverage({
      accountAddress: session.principalId,
      workspaceId,
      from: boundary(request, "from"),
      to: boundary(request, "to"),
    });
    return NextResponse.json(exported, {
      headers: {
        "Cache-Control": NO_STORE,
        "Content-Disposition": 'attachment; filename="rateloop-assurance-coverage.json"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      headers: { "Cache-Control": NO_STORE },
      status: response.status,
    });
  }
}
