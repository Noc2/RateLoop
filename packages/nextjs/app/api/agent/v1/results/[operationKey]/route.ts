import { NextRequest } from "next/server";
import { privateNoStoreJson } from "~~/lib/tokenless/privateHttpResponse";
import { authenticateProductPrincipal, authorizeAskAccess, getProductSessionToken } from "~~/lib/tokenless/productCore";
import { getTokenlessResult, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ operationKey: string }> }) {
  try {
    const principal = await authenticateProductPrincipal({
      authorization: request.headers.get("authorization"),
      sessionToken: getProductSessionToken(request),
    });
    const { operationKey } = await context.params;
    await authorizeAskAccess(principal, operationKey);
    return privateNoStoreJson(await getTokenlessResult(operationKey));
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return privateNoStoreJson(response.body, { status: response.status });
  }
}
