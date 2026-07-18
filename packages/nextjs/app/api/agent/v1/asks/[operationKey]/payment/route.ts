import { NextRequest, NextResponse } from "next/server";
import {
  attachX402Authorization,
  confirmWalletChainPayment,
  executeServerChainPayment,
  prepareChainPayment,
} from "~~/lib/tokenless/chain/payments";
import {
  authenticateProductPrincipal,
  authorizeAskAccess,
  authorizeAskPaymentMutation,
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
  await authorizeAskAccess(principal, operationKey);
  return operationKey;
}

async function authorizedPaymentMutation(request: NextRequest, context: { params: Promise<{ operationKey: string }> }) {
  const principal = await authenticateProductPrincipal({
    authorization: request.headers.get("authorization"),
    sessionToken: getProductSessionToken(request),
  });
  const { operationKey } = await context.params;
  await authorizeAskPaymentMutation(principal, operationKey);
  return operationKey;
}

export async function GET(request: NextRequest, context: { params: Promise<{ operationKey: string }> }) {
  try {
    const operationKey = await authorizedOperation(request, context);
    return NextResponse.json(await prepareChainPayment(operationKey));
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ operationKey: string }> }) {
  try {
    const operationKey = await authorizedPaymentMutation(request, context);
    const prepared = await prepareChainPayment(operationKey);
    if (prepared.paymentMode === "wallet") {
      const body = (await request.json()) as { transactionHash?: unknown };
      if (typeof body.transactionHash !== "string") {
        throw new TokenlessServiceError(
          "transactionHash is required for wallet confirmation.",
          400,
          "invalid_transaction_hash",
        );
      }
      return NextResponse.json(await confirmWalletChainPayment(operationKey, body.transactionHash));
    }
    if (prepared.paymentMode === "x402") {
      const body = (await request.json().catch(() => ({}))) as { authorization?: unknown };
      if (body.authorization !== undefined) await attachX402Authorization(operationKey, body.authorization);
    }
    return NextResponse.json(await executeServerChainPayment(operationKey));
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
