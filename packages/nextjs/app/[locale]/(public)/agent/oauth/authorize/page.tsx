import { cookies } from "next/headers";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AgentOAuthConsentForm } from "~~/components/tokenless/agents/AgentOAuthConsentForm";
import { AgentsLocaleProvider } from "~~/components/tokenless/agents/AgentsLocaleProvider";
import { Card } from "~~/components/tokenless/ui/Card";
import { PageHeading } from "~~/components/tokenless/ui/PageHeading";
import type { Locale } from "~~/i18n/config";
import { redirect } from "~~/i18n/navigation";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { validateAgentOAuthAuthorizationRequest } from "~~/lib/tokenless/agentOAuth";

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agents.oauth" });
  return {
    title: t("authorizeMetadataTitle"),
    description: t("authorizeMetadataDescription"),
  };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AgentOAuthAuthorizePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agents.oauth" });
  const scopeLabels: Record<string, string> = {
    "connection:claim": t("scopeClaimThis"),
    "context:read": t("scopeContextThis"),
    "evaluation:read": t("scopeEvaluationThis"),
    "review:decide": t("scopeReview"),
  };
  const raw = await searchParams;
  let authorization;
  try {
    authorization = await validateAgentOAuthAuthorizationRequest(raw);
  } catch {
    return (
      <div className="flex grow items-start justify-center px-4 py-16 sm:py-24">
        <Card as="section" className="w-full max-w-lg rounded-2xl p-6 sm:p-9" aria-labelledby="oauth-error-title">
          <PageHeading
            accent="error"
            heading={t("invalidRequest")}
            headingId="oauth-error-title"
            subtitle={
              <span className="text-sm leading-6" role="alert">
                {t("invalidRequestDescription")}
              </span>
            }
          />
          <p className="mt-6 text-sm leading-6 text-base-content/55">{t("restartConnection")}</p>
        </Card>
      </div>
    );
  }

  const session = await findAuthSession((await cookies()).get(AUTH_SESSION_COOKIE)?.value);
  if (!session) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string") query.set(key, value);
    }
    const returnTo = `/agent/oauth/authorize?${query.toString()}`;
    redirect({ href: `/sign-in?returnTo=${encodeURIComponent(returnTo)}`, locale });
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
    <AgentsLocaleProvider locale={locale}>
      <div className="flex grow items-start justify-center px-4 py-16 sm:py-24">
        <Card as="section" className="w-full max-w-xl rounded-2xl p-6 sm:p-9" aria-labelledby="oauth-consent-title">
          <PageHeading
            accent="blue"
            heading={
              authorization.autoAuthorize
                ? t("connectingClient", { client: authorization.clientName })
                : t("allowClient", { client: authorization.clientName })
            }
            headingId="oauth-consent-title"
            subtitle={authorization.autoAuthorize ? t("automaticHelp") : t("leastPrivilege")}
          />
          <section
            className="mt-6 rounded-xl border border-base-content/10 bg-base-content/[0.04] p-4 text-sm"
            aria-labelledby="scope-title"
          >
            <h2 id="scope-title" className="font-medium">
              {t("thisAgentCan")}
            </h2>
            <ul className="mt-3 space-y-2 text-base-content/65">
              {authorization.scopes.map(scope => (
                <li key={scope}>{scopeLabels[scope] ?? scope.replaceAll(":", " ")}</li>
              ))}
            </ul>
          </section>
          <AgentOAuthConsentForm autoAuthorize={authorization.autoAuthorize} values={values} />
        </Card>
      </div>
    </AgentsLocaleProvider>
  );
}
