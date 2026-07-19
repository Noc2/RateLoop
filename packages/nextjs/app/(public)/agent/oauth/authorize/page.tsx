import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AgentOAuthConsentForm } from "~~/components/tokenless/agents/AgentOAuthConsentForm";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { AgentOAuthError, validateAgentOAuthAuthorizationRequest } from "~~/lib/tokenless/agentOAuth";

export const metadata: Metadata = {
  title: "Authorize agent",
  description: "Authorize a least-privilege RateLoop workspace connection.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const scopeLabels: Record<string, string> = {
  "connection:claim": "Finish this one-time workspace connection",
  "context:read": "Read its RateLoop connection policy and agent context",
  "evaluation:read": "Read the assurance state for this connected agent",
  "review:decide": "Check whether a piece of work needs human review",
};

export default async function AgentOAuthAuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  let authorization;
  try {
    authorization = await validateAgentOAuthAuthorizationRequest(raw);
  } catch (error) {
    const oauth =
      error instanceof AgentOAuthError
        ? error
        : new AgentOAuthError("invalid_request", "The authorization request is invalid.");
    return (
      <main className="flex grow items-start justify-center px-4 py-16 sm:py-24">
        <section className="surface-card w-full max-w-lg rounded-2xl p-6 sm:p-9" aria-labelledby="oauth-error-title">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-error">Cannot connect</p>
          <h1 id="oauth-error-title" className="mt-4 text-3xl font-semibold tracking-tight">
            This connection request is invalid
          </h1>
          <p className="mt-4 text-sm leading-6 text-base-content/65" role="alert">
            {oauth.message}
          </p>
          <p className="mt-6 text-sm leading-6 text-base-content/55">
            Return to the agent that opened this page and restart the connection.
          </p>
        </section>
      </main>
    );
  }

  const session = await findAuthSession((await cookies()).get(AUTH_SESSION_COOKIE)?.value);
  if (!session) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string") query.set(key, value);
    }
    const returnTo = `/agent/oauth/authorize?${query.toString()}`;
    redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  }

  const values: Record<string, string> = {
    client_id: authorization.clientId,
    redirect_uri: authorization.redirectUri,
    response_type: authorization.responseType,
    code_challenge: authorization.codeChallenge,
    code_challenge_method: authorization.codeChallengeMethod,
    resource: authorization.resource,
    scope: authorization.scopes.join(" "),
    ...(authorization.state ? { state: authorization.state } : {}),
  };

  return (
    <main className="flex grow items-start justify-center px-4 py-16 sm:py-24">
      <section className="surface-card w-full max-w-xl rounded-2xl p-6 sm:p-9" aria-labelledby="oauth-consent-title">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--rateloop-blue)]">Agent connection</p>
        <h1 id="oauth-consent-title" className="mt-4 text-4xl font-semibold tracking-tight">
          {authorization.autoAuthorize
            ? `Connecting ${authorization.clientName}`
            : `Allow ${authorization.clientName}?`}
        </h1>
        <p className="mt-4 text-base leading-7 text-base-content/65">
          {authorization.autoAuthorize
            ? "No action is needed unless the connection does not continue automatically."
            : "It can check when work needs human review and read resulting decisions. It cannot publish, spend, manage the workspace, or read private files."}
        </p>
        <section
          className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4 text-sm"
          aria-labelledby="scope-title"
        >
          <h2 id="scope-title" className="font-medium">
            This agent can
          </h2>
          <ul className="mt-3 space-y-2 text-base-content/65">
            {authorization.scopes.map(scope => (
              <li key={scope}>{scopeLabels[scope] ?? scope.replaceAll(":", " ")}</li>
            ))}
          </ul>
        </section>
        <AgentOAuthConsentForm autoAuthorize={authorization.autoAuthorize} values={values} />
      </section>
    </main>
  );
}
