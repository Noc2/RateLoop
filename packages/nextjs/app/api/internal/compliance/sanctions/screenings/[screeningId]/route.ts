import { type NextRequest, NextResponse } from "next/server";
import { authorizeComplianceOperator, recordSanctionsScreening } from "~~/lib/tokenless/paidEligibility";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ screeningId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    authorizeComplianceOperator(request.headers.get("authorization"));
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !["clear", "review", "match"].includes(String(body.status))) {
      throw new TokenlessServiceError("Screening decision body is invalid.", 400, "invalid_screening_request");
    }
    const { screeningId } = await context.params;
    const result = await recordSanctionsScreening({
      screeningId,
      status: body.status as "clear" | "review" | "match",
      listSnapshotHash: String(body.listSnapshotHash) as `sha256:${string}`,
      screenedBy: String(body.screenedBy ?? ""),
      expiresAt: new Date(String(body.expiresAt ?? "")),
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}
