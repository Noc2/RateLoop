import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { ponderApi } from "~~/services/ponder/client";
import { checkRateLimit } from "~~/utils/rateLimit";

const READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

function parseLimit(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

function parseOffset(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(parsed, 0);
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const limited = await checkRateLimit(request, READ_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    extraKeyParts: [typeof address === "string" ? address : undefined],
  });
  if (limited) return limited;

  if (typeof address !== "string" || !isAddress(address)) {
    return NextResponse.json({ error: "Valid address is required" }, { status: 400 });
  }
  const normalizedAddress = address.toLowerCase() as `0x${string}`;

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"), 200, 500);
  const offset = parseOffset(request.nextUrl.searchParams.get("offset"));

  try {
    const follows = await ponderApi.getFollows(normalizedAddress, {
      limit: String(limit),
      offset: String(offset),
    });
    return NextResponse.json(follows);
  } catch (error) {
    console.error("Failed to fetch public follows:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch public follows from the configured indexer",
      },
      { status: 503 },
    );
  }
}
