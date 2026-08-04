import { NextRequest } from "next/server";
import { JsonRequestBodyError, readJsonRequestBody } from "~~/lib/mcp/requestBody";
import { privateNoStoreJson } from "~~/lib/tokenless/privateHttpResponse";
import {
  attachProductAsk,
  authenticateProductRequestPrincipal,
  prepareProductAsk,
  releasePreparedProductAsk,
} from "~~/lib/tokenless/productCore";
import {
  TokenlessServiceError,
  createTokenlessAsk,
  parseTokenlessAskMediaPreviewGrants,
  parseTokenlessAskRequest,
  preflightTokenlessAskIdempotency,
  tokenlessErrorResponse,
} from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readAskBody(request: NextRequest) {
  try {
    return await readJsonRequestBody(request);
  } catch (error) {
    if (error instanceof JsonRequestBodyError) {
      throw new TokenlessServiceError("Ask body must be valid JSON.", 400, "invalid_ask");
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  let prepared: Awaited<ReturnType<typeof prepareProductAsk>> | null = null;
  let attached = false;
  try {
    const principal = await authenticateProductRequestPrincipal(request, { mutation: true });
    const rawBody = await readAskBody(request);
    const body = parseTokenlessAskRequest(rawBody, request.headers.get("idempotency-key"));
    const mediaPreviews = parseTokenlessAskMediaPreviewGrants(rawBody);
    prepared = await prepareProductAsk({ mediaPreviews, principal, request: body });
    await preflightTokenlessAskIdempotency(body, request.headers.get("idempotency-key"), prepared.idempotencyScope);
    const response = await createTokenlessAsk(
      body,
      request.headers.get("idempotency-key"),
      request.nextUrl.origin,
      prepared.idempotencyScope,
    );
    await attachProductAsk(prepared, response);
    attached = true;
    return privateNoStoreJson(response);
  } catch (error) {
    if (prepared && !attached) await releasePreparedProductAsk(prepared);
    const response = tokenlessErrorResponse(error);
    return privateNoStoreJson(response.body, { status: response.status });
  }
}
