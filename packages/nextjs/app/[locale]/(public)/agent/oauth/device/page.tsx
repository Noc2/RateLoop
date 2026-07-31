import { cookies } from "next/headers";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Card } from "~~/components/tokenless/ui/Card";
import { PageHeading } from "~~/components/tokenless/ui/PageHeading";
import type { Locale } from "~~/i18n/config";
import { redirect } from "~~/i18n/navigation";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { AgentOAuthError } from "~~/lib/tokenless/agentOAuth";
import { getAgentOAuthDeviceApproval } from "~~/lib/tokenless/agentOAuthDevice";

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agents.oauth" });
  return {
    title: t("deviceMetadataTitle"),
    description: t("deviceMetadataDescription"),
  };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type CodeEntryCopy = {
  title: string;
  help: string;
  code: string;
  continue: string;
};

function CodeEntry({ copy, message }: { copy: CodeEntryCopy; message?: string }) {
  return (
    <Card as="section" className="w-full max-w-lg rounded-2xl p-6 sm:p-9" aria-labelledby="device-code-title">
      <PageHeading accent="blue" heading={copy.title} headingId="device-code-title" subtitle={copy.help} />
      <form method="get" className="mt-7 space-y-4">
        <label className="block text-sm font-medium" htmlFor="user_code">
          {copy.code}
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
          className="input input-bordered w-full bg-base-content/[0.04] font-mono text-lg uppercase tracking-[0.16em]"
        />
        {message ? (
          <p id="device-code-error" role="alert" className="text-sm text-error">
            {message}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary w-full">
          {copy.continue}
        </button>
      </form>
    </Card>
  );
}

export default async function AgentOAuthDevicePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agents.oauth" });
  const codeEntryCopy = {
    title: t("enterCode"),
    help: t("codeHelp"),
    code: t("verificationCode"),
    continue: t("continue"),
  };
  const scopeLabels: Record<string, string> = {
    "connection:claim": t("scopeClaim"),
    "context:read": t("scopeContext"),
    "evaluation:read": t("scopeEvaluation"),
    "review:decide": t("scopeReview"),
  };
  const raw = await searchParams;
  const userCode = typeof raw.user_code === "string" ? raw.user_code : null;
  if (!userCode) {
    return (
      <div className="flex grow items-start justify-center px-4 py-16 sm:py-24">
        <CodeEntry copy={codeEntryCopy} />
      </div>
    );
  }

  const session = await findAuthSession((await cookies()).get(AUTH_SESSION_COOKIE)?.value);
  if (!session) {
    const returnTo = `/agent/oauth/device?user_code=${encodeURIComponent(userCode)}`;
    redirect({ href: `/sign-in?returnTo=${encodeURIComponent(returnTo)}`, locale });
  }

  let approval;
  try {
    approval = await getAgentOAuthDeviceApproval(userCode);
  } catch (error) {
    const message = error instanceof AgentOAuthError ? t("invalidCode") : t("checkCodeFailed");
    return (
      <div className="flex grow items-start justify-center px-4 py-16 sm:py-24">
        <CodeEntry copy={codeEntryCopy} message={message} />
      </div>
    );
  }

  const terminalCopy = {
    approved: {
      title: t("approved"),
      message: t("approvedMessage"),
    },
    denied: {
      title: t("denied"),
      message: t("closePage"),
    },
    consumed: {
      title: t("complete"),
      message: t("approvedMessage"),
    },
    expired: {
      title: t("codeExpired"),
      message: t("restartAuthorization"),
    },
  } as const;
  const terminal = approval.status === "pending" ? null : terminalCopy[approval.status];

  return (
    <div className="flex grow items-start justify-center px-4 py-16 sm:py-24">
      <Card as="section" className="w-full max-w-xl rounded-2xl p-6 sm:p-9" aria-labelledby="device-approval-title">
        <PageHeading
          accent="blue"
          heading={terminal?.title ?? t("allowClient", { client: approval.clientName })}
          headingId="device-approval-title"
          subtitle={terminal ? <span role="status">{terminal.message}</span> : t("leastPrivilege")}
        />
        {!terminal ? (
          <>
            <section
              className="mt-6 rounded-xl border border-base-content/10 bg-base-content/[0.04] p-4 text-sm"
              aria-labelledby="device-scope-title"
            >
              <p className="text-xs uppercase tracking-wider text-base-content/45">{t("verificationCode")}</p>
              <p className="mt-1 font-mono text-base-content">{approval.userCode}</p>
              <h2 id="device-scope-title" className="mt-4 font-medium">
                {t("thisAgentCan")}
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
                {t("allow")}
              </button>
              <button type="submit" name="decision" value="deny" className="btn rateloop-secondary-action flex-1">
                {t("deny")}
              </button>
            </form>
          </>
        ) : null}
      </Card>
    </div>
  );
}
