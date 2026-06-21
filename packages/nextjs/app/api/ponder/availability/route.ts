import { NextResponse } from "next/server";
import { getPonderAvailabilityStatus } from "~~/services/ponder/client";

export const dynamic = "force-dynamic";

export async function GET(request?: Request) {
  const deploymentKey = request ? new URL(request.url).searchParams.get("deploymentKey") : null;
  const status = await getPonderAvailabilityStatus(deploymentKey);

  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
