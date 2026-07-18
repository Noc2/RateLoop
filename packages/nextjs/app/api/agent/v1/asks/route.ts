import { NextRequest, NextResponse } from "next/server";
import {
  attachProductAsk,
  authenticateProductPrincipal,
  getProductSessionToken,
  prepareProductAsk,
  releasePreparedProductAsk,
} from "~~/lib/tokenless/productCore";
import {
  createTokenlessAsk,
  parseTokenlessAskMediaPreviewGrants,
  preflightTokenlessAskIdempotency,
  tokenlessErrorResponse,
} from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let prepared: Awaited<ReturnType<typeof prepareProductAsk>> | null = null;
  let attached = false;
  try {
    const principal = await authenticateProductPrincipal({
      authorization: request.headers.get("authorization"),
      sessionToken: getProductSessionToken(request),
    });
    const rawBody = await request.json();
    const body = await preflightTokenlessAskIdempotency(rawBody, request.headers.get("idempotency-key"));
    const mediaPreviews = parseTokenlessAskMediaPreviewGrants(rawBody);
    prepared = await prepareProductAsk({ mediaPreviews, principal, request: body });
    const response = await createTokenlessAsk(body, request.headers.get("idempotency-key"), request.nextUrl.origin);
    await attachProductAsk(prepared, response);
    attached = true;
    return NextResponse.json(response);
  } catch (error) {
    if (prepared && !attached) await releasePreparedProductAsk(prepared);
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
