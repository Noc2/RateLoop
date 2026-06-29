import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { parsePositiveIntegerChainId } from "~~/lib/chainId";
import { getServerTargetNetworkById } from "~~/lib/env/server";
import { getPendingReservationSessionToken } from "~~/lib/thirdweb/freeTransactions";
import { checkRateLimit } from "~~/utils/rateLimit";

const READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const chainIdParam = request.nextUrl.searchParams.get("chainId");
  const operationKey = request.nextUrl.searchParams.get("operationKey")?.trim() ?? "";

  const limited = await checkRateLimit(request, READ_RATE_LIMIT, {
    allowOnStoreUnavailable: false,
    extraKeyParts: [typeof address === "string" ? address : undefined, operationKey || undefined],
  });
  if (limited) return limited;

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const chainId = parsePositiveIntegerChainId(chainIdParam);
  if (chainId === null) {
    return NextResponse.json({ error: "Invalid chain" }, { status: 400 });
  }
  if (!getServerTargetNetworkById(chainId)) {
    return NextResponse.json({ error: "Unsupported chain" }, { status: 400 });
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(operationKey)) {
    return NextResponse.json({ error: "Invalid operation key" }, { status: 400 });
  }

  const reservationSessionToken = await getPendingReservationSessionToken({
    address,
    chainId,
    operationKey,
  });

  if (!reservationSessionToken) {
    return NextResponse.json({ error: "Pending reservation not found" }, { status: 404 });
  }

  return NextResponse.json({ reservationSessionToken });
}
