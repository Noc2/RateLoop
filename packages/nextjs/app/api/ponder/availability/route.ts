import { NextResponse } from "next/server";
import { getPonderAvailabilityStatus } from "~~/services/ponder/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getPonderAvailabilityStatus();

  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
