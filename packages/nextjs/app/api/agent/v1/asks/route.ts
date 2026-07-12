import { NextRequest, NextResponse } from "next/server";
import {
  attachProductAsk,
  authenticateProductPrincipal,
  getProductSessionToken,
  prepareProductAsk,
  releasePreparedProductAsk,
} from "~~/lib/tokenless/productCore";
import { createTokenlessAsk, parseTokenlessAskRequest, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { subscribeAskWebhook } from "~~/lib/tokenless/transparency";

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
    const body = parseTokenlessAskRequest(await request.json(), request.headers.get("idempotency-key"));
    prepared = await prepareProductAsk({ principal, request: body });
    const response = await createTokenlessAsk(body, request.headers.get("idempotency-key"), request.nextUrl.origin);
    await attachProductAsk(prepared, response);
    const webhookAccepted = await subscribeAskWebhook({
      operationKey: response.operationKey,
      workspaceId: prepared.workspaceId,
      registration: body.webhook,
    });
    attached = true;
    return NextResponse.json({ ...response, webhookAccepted });
  } catch (error) {
    if (prepared && !attached) await releasePreparedProductAsk(prepared);
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
