import { NextRequest, NextResponse } from "next/server";
import { buildUnavailableFreeTransactionSummary, isFreeTransactionStoreUnavailableError } from "./fallback";
import { isAddress } from "viem";
import { parsePositiveIntegerChainId } from "~~/lib/chainId";
import { getPrimaryServerTargetNetwork, getServerTargetNetworkById } from "~~/lib/env/server";
import { getFreeTransactionAllowanceSummary } from "~~/lib/thirdweb/freeTransactions";
import { checkRateLimit } from "~~/utils/rateLimit";

const READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const limited = await checkRateLimit(request, READ_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    extraKeyParts: [typeof address === "string" ? address : undefined],
  });
  if (limited) return limited;

  const chainIdRaw = request.nextUrl.searchParams.get("chainId");
  const fallbackChainId = getPrimaryServerTargetNetwork()?.id;
  const parsedChainId = chainIdRaw === null ? fallbackChainId : parsePositiveIntegerChainId(chainIdRaw);

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  if (parsedChainId === null || parsedChainId === undefined) {
    return NextResponse.json({ error: "Invalid chain" }, { status: 400 });
  }
  if (!getServerTargetNetworkById(parsedChainId)) {
    return NextResponse.json({ error: "Unsupported chain" }, { status: 400 });
  }

  try {
    const summary = await getFreeTransactionAllowanceSummary({
      address,
      chainId: parsedChainId,
    });

    return NextResponse.json(summary);
  } catch (error) {
    if (isFreeTransactionStoreUnavailableError(error)) {
      console.warn("Free transaction store unavailable; falling back to self-funded mode.", error);
      return NextResponse.json(
        buildUnavailableFreeTransactionSummary({
          address,
          chainId: parsedChainId,
        }),
      );
    }

    console.error("Failed to read free transaction summary; falling back to self-funded mode:", error);
    return NextResponse.json(
      buildUnavailableFreeTransactionSummary({
        address,
        chainId: parsedChainId,
      }),
    );
  }
}
