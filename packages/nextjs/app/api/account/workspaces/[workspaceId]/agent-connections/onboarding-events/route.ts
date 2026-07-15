import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  parseConnectionMessageCopiedPayload,
  recordConnectionMessageCopied,
} from "~~/lib/tokenless/onboardingObservability";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new TokenlessServiceError("Onboarding event body must be valid JSON.", 400, "invalid_onboarding_event");
    }
    parseConnectionMessageCopiedPayload(body);
    await recordConnectionMessageCopied({ accountAddress: session.principalId, workspaceId });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
