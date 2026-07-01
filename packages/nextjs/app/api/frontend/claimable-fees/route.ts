import { NextRequest, NextResponse } from "next/server";
import { listClaimableFrontendFeeRoundsForRequest } from "./dependencies";
import { isAddress } from "viem";
import { parsePositiveIntegerChainId } from "~~/lib/chainId";
import { getPrimaryServerTargetNetwork, getServerTargetNetworkById } from "~~/lib/env/server";
import { checkRateLimit } from "~~/utils/rateLimit";

const ROUTE_RATE_LIMIT = { limit: 120, windowMs: 60_000 };
const LOOKUP_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

function buildDegradedFrontendFeeResponse(offset: number) {
  return {
    items: [],
    hasMore: false,
    nextOffset: offset,
    scannedRounds: 0,
    totalRounds: 0,
    degraded: true,
  };
}

export async function GET(request: NextRequest) {
  const frontend = request.nextUrl.searchParams.get("frontend");
  const chainIdRaw = request.nextUrl.searchParams.get("chainId");
  const routeLimited = await checkRateLimit(request, ROUTE_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    routeKey: "/api/frontend/claimable-fees",
  });
  if (routeLimited) return routeLimited;

  if (!frontend || !isAddress(frontend)) {
    return NextResponse.json({ error: "Valid frontend address is required" }, { status: 400 });
  }

  const fallbackChainId = getPrimaryServerTargetNetwork()?.id;
  const parsedChainId = chainIdRaw === null ? fallbackChainId : parsePositiveIntegerChainId(chainIdRaw);
  if (parsedChainId === null || parsedChainId === undefined) {
    return NextResponse.json({ error: "Valid chainId is required" }, { status: 400 });
  }

  if (!getServerTargetNetworkById(parsedChainId)) {
    return NextResponse.json({ error: "Unsupported chainId" }, { status: 400 });
  }

  const limited = await checkRateLimit(request, LOOKUP_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    extraKeyParts: [frontend.toLowerCase(), parsedChainId],
    routeKey: "/api/frontend/claimable-fees/lookup",
  });
  if (limited) return limited;

  const limit = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get("limit") ?? "10") || 10, 1), 50);
  const offset = Math.max(parseInt(request.nextUrl.searchParams.get("offset") ?? "0") || 0, 0);

  try {
    const result = await listClaimableFrontendFeeRoundsForRequest(frontend, { chainId: parsedChainId, limit, offset });
    return NextResponse.json(result);
  } catch (error) {
    console.warn("Failed to fetch claimable frontend fees; returning degraded empty response:", error);
    return NextResponse.json(buildDegradedFrontendFeeResponse(offset));
  }
}
