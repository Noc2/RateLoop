import { NextRequest } from "next/server";
import { apiRequestBodyFallback, readApiJsonRequestBody } from "~~/lib/tokenless/apiRequestBody";
import {
  attachX402Authorization,
  confirmWalletChainPayment,
  executeServerChainPayment,
  prepareChainPayment,
} from "~~/lib/tokenless/chain/payments";
import { privateNoStoreJson } from "~~/lib/tokenless/privateHttpResponse";
import {
  authenticateProductPrincipal,
  authenticateProductRequestPrincipal,
  authorizeAskPaymentAccess,
  getProductSessionToken,
} from "~~/lib/tokenless/productCore";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authorizedOperation(request: NextRequest, context: { params: Promise<{ operationKey: string }> }) {
  const principal = await authenticateProductPrincipal({
    authorization: request.headers.get("authorization"),
    sessionToken: getProductSessionToken(request),
  });
  const { operationKey } = await context.params;
  await authorizeAskPaymentAccess(principal, operationKey);
  return operationKey;
}

async function authorizedPaymentMutation(request: NextRequest, context: { params: Promise<{ operationKey: string }> }) {
  const principal = await authenticateProductRequestPrincipal(request, { mutation: true });
  const { operationKey } = await context.params;
  await authorizeAskPaymentAccess(principal, operationKey);
  return operationKey;
}

export async function GET(request: NextRequest, context: { params: Promise<{ operationKey: string }> }) {
  try {
    const operationKey = await authorizedOperation(request, context);
    return privateNoStoreJson(await prepareChainPayment(operationKey));
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return privateNoStoreJson(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ operationKey: string }> }) {
  try {
    const operationKey = await authorizedPaymentMutation(request, context);
    const prepared = await prepareChainPayment(operationKey);
    if (prepared.paymentMode === "wallet") {
      const body = (await readApiJsonRequestBody(request)) as { transactionHash?: unknown };
      if (typeof body.transactionHash !== "string") {
        throw new TokenlessServiceError(
          "transactionHash is required for wallet confirmation.",
          400,
          "invalid_transaction_hash",
        );
      }
      return privateNoStoreJson(await confirmWalletChainPayment(operationKey, body.transactionHash));
    }
    if (prepared.paymentMode === "x402") {
      const body = (await readApiJsonRequestBody(request).catch(error => apiRequestBodyFallback(error, {}))) as {
        authorization?: unknown;
      };
      if (body.authorization !== undefined) await attachX402Authorization(operationKey, body.authorization);
    }
    return privateNoStoreJson(await executeServerChainPayment(operationKey));
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return privateNoStoreJson(response.body, { status: response.status });
  }
}
