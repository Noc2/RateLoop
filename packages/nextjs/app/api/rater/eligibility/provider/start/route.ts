import { type NextRequest, NextResponse } from "next/server";
import { createEligibilityProviderHandoff } from "~~/lib/tokenless/paidEligibility";
import { requireRaterSession } from "~~/lib/tokenless/raterSession";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await requireRaterSession(request, true);
    return NextResponse.json(
      await createEligibilityProviderHandoff({
        principalId: session.principalId,
        payoutAccount: session.payoutAddress,
      }),
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }
}
