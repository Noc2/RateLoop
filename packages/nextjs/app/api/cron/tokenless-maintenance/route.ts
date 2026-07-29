import { NextRequest, NextResponse } from "next/server";
import { authorizeTokenlessCron, runTokenlessScheduledMaintenance } from "~~/lib/tokenless/scheduledMaintenance";
import { hasRepeatedScheduledProcessorFailure } from "~~/lib/tokenless/scheduledProcessorHealth";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export function scheduledMaintenanceResponse(result: unknown, repeatedProcessorFailure: boolean) {
  if (repeatedProcessorFailure) {
    return NextResponse.json(
      {
        code: "scheduled_processor_repeated_failure",
        message: "Scheduled maintenance requires operator attention.",
      },
      { status: 503 },
    );
  }
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  try {
    authorizeTokenlessCron(request.headers.get("authorization"));
    const result = await runTokenlessScheduledMaintenance({ appOrigin: request.nextUrl.origin });
    return scheduledMaintenanceResponse(result, await hasRepeatedScheduledProcessorFailure());
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
