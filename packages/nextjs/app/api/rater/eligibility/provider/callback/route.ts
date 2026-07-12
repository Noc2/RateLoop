import { type NextRequest, NextResponse } from "next/server";
import { completeEligibilityProviderHandoff } from "~~/lib/tokenless/paidEligibility";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    let body: {
      state?: string;
      provider?: string;
      payload?: string;
      signature?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      throw new TokenlessServiceError("Provider callback must be valid JSON.", 400, "invalid_provider_result");
    }
    if (!body.state || !body.provider || !body.payload || !body.signature) {
      throw new TokenlessServiceError("Provider callback fields are incomplete.", 400, "invalid_provider_result");
    }
    return NextResponse.json(
      await completeEligibilityProviderHandoff({
        state: body.state,
        providerResult: { provider: body.provider, payload: body.payload, signature: body.signature },
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }
}
