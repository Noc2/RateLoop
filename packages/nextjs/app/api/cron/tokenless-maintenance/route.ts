import { NextRequest, NextResponse } from "next/server";
import { authorizeTokenlessCron, runTokenlessScheduledMaintenance } from "~~/lib/tokenless/scheduledMaintenance";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    authorizeTokenlessCron(request.headers.get("authorization"));
    return NextResponse.json(await runTokenlessScheduledMaintenance({ appOrigin: request.nextUrl.origin }));
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
