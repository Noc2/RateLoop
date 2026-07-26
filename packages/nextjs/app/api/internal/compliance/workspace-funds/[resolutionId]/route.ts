import { type NextRequest, NextResponse } from "next/server";
import { recordWorkspaceFundResolution } from "~~/lib/privacy/workspaceDeletion";
import { authorizeComplianceOperator } from "~~/lib/tokenless/paidEligibility";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ resolutionId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    authorizeComplianceOperator(request.headers.get("authorization"));
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !["refunded", "manual_review"].includes(String(body.status))) {
      throw new TokenlessServiceError("Fund-resolution body is invalid.", 400, "invalid_fund_resolution");
    }
    const { resolutionId } = await context.params;
    return NextResponse.json(
      await recordWorkspaceFundResolution({
        resolutionId,
        status: body.status as "refunded" | "manual_review",
        resolutionReference: String(body.resolutionReference ?? ""),
        resolvedBy: String(body.resolvedBy ?? ""),
      }),
      { headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}
