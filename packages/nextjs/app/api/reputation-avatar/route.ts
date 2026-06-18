import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { normalizeAvatarAccentHex } from "~~/lib/avatar/avatarAccent";
import { renderLogoRingAvatarSvg } from "~~/lib/avatar/logoRingAvatar";
import { getReputationAvatarPayload } from "~~/lib/avatar/server";
import { parsePositiveIntegerChainId } from "~~/lib/chainId";
import { getPrimaryServerTargetNetwork, getServerTargetNetworkById } from "~~/lib/env/server";
import { checkRateLimit } from "~~/utils/rateLimit";

const CACHE_SECONDS = 300;
const RATE_LIMIT = { limit: 180, windowMs: 60_000 };

function parseRequestedSize(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, RATE_LIMIT, { allowOnStoreUnavailable: true });
  if (limited) return limited;

  const address = request.nextUrl.searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Missing or invalid address parameter" }, { status: 400 });
  }

  const chainIdRaw = request.nextUrl.searchParams.get("chainId");
  const fallbackChainId = getPrimaryServerTargetNetwork()?.id;
  const parsedChainId = chainIdRaw === null ? fallbackChainId : parsePositiveIntegerChainId(chainIdRaw);
  if (parsedChainId === null || parsedChainId === undefined) {
    return NextResponse.json({ error: "Valid chainId is required" }, { status: 400 });
  }
  if (!getServerTargetNetworkById(parsedChainId)) {
    return NextResponse.json({ error: "Unsupported chainId" }, { status: 400 });
  }

  const payload = await getReputationAvatarPayload(address, {
    chainId: parsedChainId,
    cacheKey: request.nextUrl.searchParams.get("v"),
  });
  const size = parseRequestedSize(request.nextUrl.searchParams.get("size"));
  const previewAccentHex = normalizeAvatarAccentHex(request.nextUrl.searchParams.get("accent"));
  const svg = renderLogoRingAvatarSvg(
    {
      ...payload,
      avatarAccentHex: previewAccentHex ?? payload.avatarAccentHex,
    },
    { size },
  );

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 6}`,
    },
  });
}
