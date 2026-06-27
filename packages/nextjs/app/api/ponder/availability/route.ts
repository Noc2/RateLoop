import { NextRequest, NextResponse } from "next/server";
import { getPonderAvailabilityStatus, normalizeSupportedPonderDeploymentKey } from "~~/services/ponder/client";
import { checkRateLimit } from "~~/utils/rateLimit";

export const dynamic = "force-dynamic";

const READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, READ_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    routeKey: "/api/ponder/availability",
  });
  if (limited) return limited;

  const rawDeploymentKey = request.nextUrl.searchParams.get("deploymentKey");
  const deploymentKey = normalizeSupportedPonderDeploymentKey(rawDeploymentKey);
  if (rawDeploymentKey?.trim() && !deploymentKey) {
    return NextResponse.json({ error: "Unsupported Ponder deployment key" }, { status: 400 });
  }

  const status = await getPonderAvailabilityStatus(deploymentKey);

  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
