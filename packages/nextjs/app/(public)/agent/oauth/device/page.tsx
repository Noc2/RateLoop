import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
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
    <section className="surface-card w-full max-w-lg rounded-2xl p-6 sm:p-9" aria-labelledby="device-code-title">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--rateloop-blue)]">Agent connection</p>
      <h1 id="device-code-title" className="mt-4 text-4xl font-semibold tracking-tight">
        Enter your connection code
      </h1>
      <p className="mt-4 text-sm leading-6 text-base-content/65">
        Find the code in your agent host. It expires after ten minutes.
      </p>
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
    </section>
  );
}

export default async function AgentOAuthDevicePage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const userCode = typeof raw.user_code === "string" ? raw.user_code : null;
  if (!userCode) {
    return (
      <main className="flex grow items-start justify-center px-4 py-16 sm:py-24">
        <CodeEntry />
      </main>
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
    const message = error instanceof AgentOAuthError ? error.message : "That verification code could not be checked.";
    return (
      <main className="flex grow items-start justify-center px-4 py-16 sm:py-24">
        <CodeEntry message={message} />
      </main>
    );
  }

  const terminalCopy = {
    approved: {
      eyebrow: "Approved",
      title: "Authorization approved",
      message: "Return to the same agent task. RateLoop will show the connection after verification.",
    },
    denied: {
      eyebrow: "Denied",
      title: "Connection denied",
      message: "You can close this page.",
    },
    consumed: {
      eyebrow: "Authenticated",
      title: "Authentication complete",
      message: "Return to the same agent task. RateLoop will show the connection after verification.",
    },
    expired: {
      eyebrow: "Expired",
      title: "Connection code expired",
      message: "Return to your agent and restart authorization.",
    },
  } as const;
  const terminal = approval.status === "pending" ? null : terminalCopy[approval.status];

  return (
    <main className="flex grow items-start justify-center px-4 py-16 sm:py-24">
      <section className="surface-card w-full max-w-xl rounded-2xl p-6 sm:p-9" aria-labelledby="device-approval-title">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--rateloop-blue)]">
          {terminal?.eyebrow ?? "Agent connection"}
        </p>
        <h1 id="device-approval-title" className="mt-4 text-4xl font-semibold tracking-tight">
          {terminal?.title ?? `Allow ${approval.clientName}?`}
        </h1>
        {terminal ? (
          <p className="mt-4 text-base leading-7 text-base-content/65" role="status">
            {terminal.message}
          </p>
        ) : (
          <>
            <p className="mt-4 text-base leading-7 text-base-content/65">
              It can check when work needs human review and read resulting decisions. It cannot publish, spend, manage
              the workspace, or read private files.
            </p>
            <details className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
              <summary className="cursor-pointer font-medium">Connection details</summary>
              <p className="mt-3 font-mono text-base-content/65">Code {approval.userCode}</p>
              <ul className="mt-3 space-y-2 text-base-content/65">
                {approval.scopes.map(scope => (
                  <li key={scope}>{scopeLabels[scope] ?? scope.replaceAll(":", " ")}</li>
                ))}
              </ul>
            </details>
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
        )}
      </section>
    </main>
  );
}
