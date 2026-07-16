import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  type AssuranceEventType,
  createAssuranceEventStream,
  listAssuranceEventStreams,
} from "~~/lib/tokenless/assuranceEventStreaming";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(
      { streams: await listAssuranceEventStreams({ accountAddress: session.principalId, workspaceId }) },
      { headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new TokenlessServiceError("Event stream request is invalid.", 400, "invalid_assurance_event_stream");
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TokenlessServiceError("Event stream request is invalid.", 400, "invalid_assurance_event_stream");
    }
    const body = raw as Record<string, unknown>;
    if (
      Object.keys(body).some(key => key !== "url" && key !== "eventTypes") ||
      typeof body.url !== "string" ||
      !Array.isArray(body.eventTypes)
    ) {
      throw new TokenlessServiceError("Event stream request is invalid.", 400, "invalid_assurance_event_stream");
    }
    return NextResponse.json(
      await createAssuranceEventStream({
        accountAddress: session.principalId,
        workspaceId,
        url: body.url,
        eventTypes: body.eventTypes as AssuranceEventType[],
      }),
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}
