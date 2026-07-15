import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { assertAuthRequestOrigin } from "~~/lib/auth/session";
import {
  AgentOAuthError,
  issueAgentOAuthAuthorizationCode,
  validateAgentOAuthAuthorizationRequest,
} from "~~/lib/tokenless/agentOAuth";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const runtime = "nodejs";

function authorizationValues(form: FormData) {
  const fields = [
    "client_id",
    "redirect_uri",
    "response_type",
    "code_challenge",
    "code_challenge_method",
    "resource",
    "scope",
    "state",
  ];
  const values: Record<string, string | undefined> = {};
  for (const field of fields) {
    const entries = form.getAll(field);
    if (entries.length > 1 || (entries.length === 1 && typeof entries[0] !== "string")) {
      throw new AgentOAuthError("invalid_request", `${field} must not be repeated.`);
    }
    if (typeof entries[0] === "string") values[field] = entries[0];
  }
  return values;
}

export async function POST(request: NextRequest) {
  try {
    try {
      assertAuthRequestOrigin(request.headers.get("origin"));
    } catch {
      throw new AgentOAuthError("invalid_request", "Cross-origin authorization request denied.", 403);
    }
    const form = await request.formData();
    const validated = await validateAgentOAuthAuthorizationRequest(authorizationValues(form));
    let session;
    try {
      session = await requireBrowserSession(request);
    } catch (error) {
      if (error instanceof TokenlessServiceError && error.code === "authentication_required") {
        const query = new URLSearchParams({
          client_id: validated.clientId,
          redirect_uri: validated.redirectUri,
          response_type: validated.responseType,
          code_challenge: validated.codeChallenge,
          code_challenge_method: validated.codeChallengeMethod,
          resource: validated.resource,
          scope: validated.scopes.join(" "),
          ...(validated.state ? { state: validated.state } : {}),
        });
        const returnTo = `/agent/oauth/authorize?${query.toString()}`;
        return NextResponse.redirect(
          new URL(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`, request.nextUrl.origin),
          303,
        );
      }
      throw error;
    }
    const decision = form.get("decision");
    if (decision === "deny") {
      const redirect = new URL(validated.redirectUri);
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set("error_description", "The resource owner denied authorization.");
      if (validated.state) redirect.searchParams.set("state", validated.state);
      return NextResponse.redirect(redirect, 303);
    }
    if (decision !== "approve") throw new AgentOAuthError("invalid_request", "An authorization decision is required.");
    const issued = await issueAgentOAuthAuthorizationCode({
      request: validated,
      subjectPrincipalId: session.principalId,
      consented: true,
    });
    return NextResponse.redirect(issued.redirectUri, 303);
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
          : new AgentOAuthError("server_error", "OAuth authorization failed.", 500);
    return NextResponse.json(
      { error: oauth.code, error_description: oauth.message },
      { status: oauth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
