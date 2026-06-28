import { NextRequest, NextResponse } from "next/server";
import { isFreeTransactionStoreUnavailableError } from "../session/fallback";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import {
  type FreeTransactionConfirmationOutcome,
  confirmFreeTransactionReservation,
} from "~~/lib/thirdweb/freeTransactions";
import { checkRateLimit } from "~~/utils/rateLimit";

const WRITE_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

type ConfirmFreeTransactionRequest = {
  address?: string;
  chainId?: number;
  operationKey?: string;
  reservationSessionToken?: string;
  transactionHashes?: string[];
};

function confirmationErrorMessage(outcome: FreeTransactionConfirmationOutcome) {
  if (outcome === "missing_reservation") {
    return "Free transaction reservation not found";
  }
  if (outcome === "reservation_mismatch") {
    return "Free transaction reservation session token is invalid";
  }
  if (outcome === "update_skipped") {
    return "Free transaction reservation could not be confirmed";
  }
  if (outcome.startsWith("ignored_")) {
    return "Free transaction reservation is not pending";
  }
  return "Free transaction reservation was not confirmed";
}

export async function POST(request: NextRequest) {
  const preParseLimited = await checkRateLimit(request, WRITE_RATE_LIMIT, {
    extraKeyParts: ["preparse"],
  });
  if (preParseLimited) return preParseLimited;

  const parsedBody = await parseJsonBody(request);
  if (!isJsonObjectBody(parsedBody)) return jsonBodyErrorResponse(parsedBody, "Invalid request body");
  const body = parsedBody as ConfirmFreeTransactionRequest;

  const limited = await checkRateLimit(request, WRITE_RATE_LIMIT, {
    extraKeyParts: [body?.address],
  });
  if (limited) return limited;

  try {
    const confirmation = await confirmFreeTransactionReservation({
      address: body?.address ?? "",
      chainId: typeof body?.chainId === "number" ? body.chainId : Number.NaN,
      operationKey: body?.operationKey ?? "",
      reservationSessionToken: body?.reservationSessionToken ?? "",
      transactionHashes: Array.isArray(body?.transactionHashes) ? body.transactionHashes : [],
    });

    if (!confirmation.confirmed) {
      const status =
        confirmation.outcome === "missing_reservation"
          ? 404
          : confirmation.outcome === "reservation_mismatch"
            ? 403
            : 409;
      return NextResponse.json(
        {
          error: confirmationErrorMessage(confirmation.outcome),
          ok: false,
          outcome: confirmation.outcome,
        },
        { status },
      );
    }

    return NextResponse.json({ ok: true, outcome: confirmation.outcome });
  } catch (error) {
    if (isFreeTransactionStoreUnavailableError(error)) {
      return NextResponse.json({ error: "Free transaction quota store unavailable" }, { status: 503 });
    }

    const message =
      error instanceof Error && error.message.trim() ? error.message : "Failed to confirm free transaction usage";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
