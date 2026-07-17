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

const BROWSER_RELAY_HEADER = "x-rateloop-oauth-callback-relay";

function isLoopbackRedirect(value: string) {
  const url = new URL(value);
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1")
  );
}

function oauthRedirect(
  request: NextRequest,
  destination: URL,
  delivery: "callback" | "navigate",
  relayAllowed: boolean,
  outcome?: "approved" | "denied",
) {
  const headers = { "Cache-Control": "no-store", Pragma: "no-cache" };
  if (relayAllowed && request.headers.get(BROWSER_RELAY_HEADER) === "1") {
    return NextResponse.json({ redirectTo: destination.href, delivery, ...(outcome ? { outcome } : {}) }, { headers });
  }
  const response = NextResponse.redirect(destination, 303);
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

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
    const relayAllowed = isLoopbackRedirect(validated.redirectUri);
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
        return oauthRedirect(
          request,
          new URL(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`, request.nextUrl.origin),
          "navigate",
          relayAllowed,
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
      return oauthRedirect(request, redirect, "callback", relayAllowed, "denied");
    }
    if (decision !== "approve") throw new AgentOAuthError("invalid_request", "An authorization decision is required.");
    const issued = await issueAgentOAuthAuthorizationCode({
      request: validated,
      subjectPrincipalId: session.principalId,
      consented: true,
    });
    return oauthRedirect(request, new URL(issued.redirectUri), "callback", relayAllowed, "approved");
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
      { status: oauth.status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  }
}
