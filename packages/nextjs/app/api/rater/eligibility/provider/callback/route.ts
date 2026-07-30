import { type NextRequest, NextResponse } from "next/server";
import { BoundedRequestBodyError, readBoundedJsonRequestBody } from "~~/lib/tokenless/boundedRequestBody";
import { completeEligibilityProviderHandoff } from "~~/lib/tokenless/paidEligibility";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const ELIGIBILITY_PROVIDER_CALLBACK_BODY_MAX_BYTES = 64 * 1_024;

type EligibilityProviderCallbackBody = {
  state?: string;
  provider?: string;
  payload?: string;
  signature?: string;
};

export async function readEligibilityProviderCallbackBody(
  request: Pick<Request, "body" | "headers">,
): Promise<EligibilityProviderCallbackBody> {
  try {
    return (await readBoundedJsonRequestBody(
      request,
      ELIGIBILITY_PROVIDER_CALLBACK_BODY_MAX_BYTES,
    )) as EligibilityProviderCallbackBody;
  } catch (error) {
    if (error instanceof BoundedRequestBodyError) {
      throw new TokenlessServiceError(
        error.reason === "body_too_large"
          ? "Provider callback is too large."
          : error.reason === "invalid_content_length"
            ? "Content-Length is invalid."
            : "Provider callback must be valid JSON.",
        error.reason === "body_too_large" ? 413 : 400,
        "invalid_provider_result",
      );
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readEligibilityProviderCallbackBody(request);
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
