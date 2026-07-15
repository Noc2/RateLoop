import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { assertAuthRequestOrigin } from "~~/lib/auth/session";
import { AgentOAuthError } from "~~/lib/tokenless/agentOAuth";
import { decideAgentOAuthDeviceAuthorization } from "~~/lib/tokenless/agentOAuthDevice";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const runtime = "nodejs";

function formField(form: FormData, key: string, max = 128) {
  const values = form.getAll(key);
  if (values.length !== 1 || typeof values[0] !== "string" || !values[0] || values[0].length > max) {
    throw new AgentOAuthError("invalid_request", `${key} must appear exactly once.`);
  }
  return values[0];
}

export async function POST(request: NextRequest) {
  try {
    try {
      assertAuthRequestOrigin(request.headers.get("origin"));
    } catch {
      throw new AgentOAuthError("invalid_request", "Cross-origin device approval denied.", 403);
    }
    const session = await requireBrowserSession(request);
    const form = await request.formData();
    const userCode = formField(form, "user_code", 32);
    const decision = formField(form, "decision", 16);
    if (decision !== "approve" && decision !== "deny") {
      throw new AgentOAuthError("invalid_request", "An approval decision is required.");
    }
    const result = await decideAgentOAuthDeviceAuthorization({
      userCode,
      subjectPrincipalId: session.principalId,
      decision,
    });
    const redirect = new URL("/agent/oauth/device", request.nextUrl.origin);
    redirect.searchParams.set("user_code", result.userCode);
    redirect.searchParams.set("result", result.status);
    return NextResponse.redirect(redirect, 303);
  } catch (error) {
    const oauth =
      error instanceof AgentOAuthError
        ? error
        : error instanceof TokenlessServiceError
          ? new AgentOAuthError(
              error.code === "authentication_required" ? "access_denied" : "invalid_request",
              error.message,
              error.status,
            )
          : new AgentOAuthError("server_error", "Device authorization could not be decided.", 500);
    return NextResponse.json(
      { error: oauth.code, error_description: oauth.message },
      { status: oauth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
