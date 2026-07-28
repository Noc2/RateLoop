import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Card } from "~~/components/tokenless/ui/Card";
import { PageHeading } from "~~/components/tokenless/ui/PageHeading";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { AgentOAuthError } from "~~/lib/tokenless/agentOAuth";
import { getAgentOAuthDeviceApproval } from "~~/lib/tokenless/agentOAuthDevice";

export const metadata: Metadata = {
  title: "Connect agent",
  description: "Approve a least-privilege RateLoop workspace connection from an agent host.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const scopeLabels: Record<string, string> = {
  "connection:claim": "Finish the one-time workspace connection",
  "context:read": "Read the workspace's RateLoop connection policy and agent context",
  "evaluation:read": "Read assurance state for the connected agent",
  "review:decide": "Check whether a piece of work needs human review",
};

function CodeEntry({ message }: { message?: string }) {
  return (
    <Card as="section" className="w-full max-w-lg rounded-2xl p-6 sm:p-9" aria-labelledby="device-code-title">
      <PageHeading
        accent="blue"
        heading="Enter your connection code"
        headingId="device-code-title"
        subtitle="Find the code in your agent host. It expires after ten minutes."
      />
      <form method="get" className="mt-7 space-y-4">
        <label className="block text-sm font-medium" htmlFor="user_code">
          Verification code
        </label>
        <input
          id="user_code"
          name="user_code"
          required
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          maxLength={9}
          placeholder="ABCD-EFGH"
          aria-describedby={message ? "device-code-error" : undefined}
          className="input input-bordered w-full bg-black/20 font-mono text-lg uppercase tracking-[0.16em]"
        />
        {message ? (
          <p id="device-code-error" role="alert" className="text-sm text-error">
            {message}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary w-full">
          Continue
        </button>
      </form>
    </Card>
  );
}

export default async function AgentOAuthDevicePage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const userCode = typeof raw.user_code === "string" ? raw.user_code : null;
  if (!userCode) {
    return (
      <div className="flex grow items-start justify-center px-4 py-16 sm:py-24">
        <CodeEntry />
      </div>
    );
  }

  const session = await findAuthSession((await cookies()).get(AUTH_SESSION_COOKIE)?.value);
  if (!session) {
    const returnTo = `/agent/oauth/device?user_code=${encodeURIComponent(userCode)}`;
    redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  }

  let approval;
  try {
    approval = await getAgentOAuthDeviceApproval(userCode);
  } catch (error) {
    const message =
      error instanceof AgentOAuthError
        ? "That code is invalid or expired. Check it and try again, or return to your agent for a new code."
        : "We couldn't check that code. Try again.";
    return (
      <div className="flex grow items-start justify-center px-4 py-16 sm:py-24">
        <CodeEntry message={message} />
      </div>
    );
  }

  const terminalCopy = {
    approved: {
      title: "Authorization approved",
      message: "Return to the same agent task. RateLoop will show the connection after verification.",
    },
    denied: {
      title: "Connection denied",
      message: "You can close this page.",
    },
    consumed: {
      title: "Authentication complete",
      message: "Return to the same agent task. RateLoop will show the connection after verification.",
    },
    expired: {
      title: "Connection code expired",
      message: "Return to your agent and restart authorization.",
    },
  } as const;
  const terminal = approval.status === "pending" ? null : terminalCopy[approval.status];

  return (
    <div className="flex grow items-start justify-center px-4 py-16 sm:py-24">
      <Card as="section" className="w-full max-w-xl rounded-2xl p-6 sm:p-9" aria-labelledby="device-approval-title">
        <PageHeading
          accent="blue"
          heading={terminal?.title ?? `Allow ${approval.clientName}?`}
          headingId="device-approval-title"
          subtitle={
            terminal ? (
              <span role="status">{terminal.message}</span>
            ) : (
              "It can check when work needs human review and read resulting decisions. It cannot publish, spend, manage the workspace, or read private files."
            )
          }
        />
        {!terminal ? (
          <>
            <section
              className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4 text-sm"
              aria-labelledby="device-scope-title"
            >
              <p className="text-xs uppercase tracking-wider text-base-content/45">Verification code</p>
              <p className="mt-1 font-mono text-base-content">{approval.userCode}</p>
              <h2 id="device-scope-title" className="mt-4 font-medium">
                This agent can
              </h2>
              <ul className="mt-3 space-y-2 text-base-content/65">
                {approval.scopes.map(scope => (
                  <li key={scope}>{scopeLabels[scope] ?? scope.replaceAll(":", " ")}</li>
                ))}
              </ul>
            </section>
            <form
              action="/api/agent/oauth/device/authorize"
              method="post"
              className="mt-7 flex flex-col gap-3 sm:flex-row"
            >
              <input type="hidden" name="user_code" value={approval.userCode} />
              <button type="submit" name="decision" value="approve" className="btn btn-primary flex-1">
                Allow connection
              </button>
              <button type="submit" name="decision" value="deny" className="btn rateloop-secondary-action flex-1">
                Deny
              </button>
            </form>
          </>
        ) : null}
      </Card>
    </div>
  );
}
