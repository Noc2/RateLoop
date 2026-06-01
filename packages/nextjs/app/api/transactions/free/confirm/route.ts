import { NextRequest, NextResponse } from "next/server";
import { isFreeTransactionStoreUnavailableError } from "../session/fallback";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { confirmFreeTransactionReservation } from "~~/lib/thirdweb/freeTransactions";
import { checkRateLimit } from "~~/utils/rateLimit";

const WRITE_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

type ConfirmFreeTransactionRequest = {
  address?: string;
  chainId?: number;
  operationKey?: string;
  transactionHashes?: string[];
};

export async function POST(request: NextRequest) {
  const preParseLimited = await checkRateLimit(request, WRITE_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    extraKeyParts: ["preparse"],
  });
  if (preParseLimited) return preParseLimited;

  const parsedBody = await parseJsonBody(request);
  if (!isJsonObjectBody(parsedBody)) return jsonBodyErrorResponse(parsedBody, "Invalid request body");
  const body = parsedBody as ConfirmFreeTransactionRequest;

  const limited = await checkRateLimit(request, WRITE_RATE_LIMIT, {
    // This is post-transaction quota accounting, so keep serving if only the
    // shared rate-limit store is temporarily unavailable.
    allowOnStoreUnavailable: true,
    extraKeyParts: [body?.address],
  });
  if (limited) return limited;

  try {
    await confirmFreeTransactionReservation({
      address: body?.address ?? "",
      chainId: typeof body?.chainId === "number" ? body.chainId : Number.NaN,
      operationKey: body?.operationKey ?? "",
      transactionHashes: Array.isArray(body?.transactionHashes) ? body.transactionHashes : [],
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isFreeTransactionStoreUnavailableError(error)) {
      return NextResponse.json({ error: "Free transaction quota store unavailable" }, { status: 503 });
    }

    const message =
      error instanceof Error && error.message.trim() ? error.message : "Failed to confirm free transaction usage";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
