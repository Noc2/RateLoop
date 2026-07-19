import { type NextRequest, NextResponse } from "next/server";
import { requireRaterSession } from "~~/lib/tokenless/raterSession";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { createWorldIdAssuranceContext } from "~~/lib/tokenless/worldIdAssurance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await requireRaterSession(request, true);
    const context = await createWorldIdAssuranceContext({
      principalId: session.principalId,
      payoutAccount: session.payoutAddress,
    });
    return NextResponse.json(context, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }
}
