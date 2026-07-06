import { NextRequest, NextResponse } from "next/server";
import { getPonderAvailabilityStatus } from "~~/services/ponder/client";
import { checkRateLimit } from "~~/utils/rateLimit";

export const dynamic = "force-dynamic";

const READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, READ_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    routeKey: "/api/ponder/availability",
  });
  if (limited) return limited;

  const status = await getPonderAvailabilityStatus();

  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
