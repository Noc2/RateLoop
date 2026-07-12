import { NextRequest, NextResponse } from "next/server";
import { listPaidRaterTasks } from "~~/lib/tokenless/raterService";
import { requireRaterSession } from "~~/lib/tokenless/raterSession";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireRaterSession(request, false);
    return NextResponse.json({ tasks: await listPaidRaterTasks(session.address) });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
