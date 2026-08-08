import { cookies } from "next/headers";
import { completeWelcomeAction } from "./actions";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { PageHeading } from "~~/components/tokenless/ui/PageHeading";
import type { Locale } from "~~/i18n/config";
import { redirect } from "~~/i18n/navigation";
import { getPrincipalWelcomeState } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";

type WelcomeParams = Promise<{ locale: Locale }>;

export async function generateMetadata({ params }: { params: WelcomeParams }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.welcome" });
  return { title: t("metadataTitle"), description: t("metadataDescription") };
}

function ChoiceForm({
  choice,
  children,
  locale,
  secondary = false,
}: {
  choice: string;
  children: string;
  locale: Locale;
  secondary?: boolean;
}) {
  return (
    <form action={completeWelcomeAction}>
      <input type="hidden" name="choice" value={choice} />
      <input type="hidden" name="locale" value={locale} />
      <Button className="min-h-12 w-full" type="submit" variant={secondary ? "secondary" : "primary"}>
        {children}
      </Button>
    </form>
  );
}

export default async function WelcomePage({ params }: { params: WelcomeParams }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.welcome" });
  const cookieStore = await cookies();
  const session = await findAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
  if (!session) return redirect({ href: "/sign-in?returnTo=%2Fwelcome", locale });

  const welcome = await getPrincipalWelcomeState(session.principalId);
  if (!welcome.required) redirect({ href: "/", locale });

  return (
    <AppPageShell outerClassName="pb-12" contentClassName="mx-auto max-w-5xl">
      <PageHeading accent="blue" className="max-w-3xl" heading={t("heading")} />

      <div className="mt-9 grid gap-5 md:grid-cols-2">
        <Card as="section" className="flex flex-col rounded-2xl border-l-2 border-l-[var(--rateloop-green)] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold">{t("reviewTitle")}</h2>
          <p className="mt-3 text-base leading-7 text-base-content/65">{t("reviewDescription")}</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 md:mt-auto md:pt-8">
            <ChoiceForm choice="review" locale={locale}>
              {t("reviewAction")}
            </ChoiceForm>
            <ChoiceForm choice="invitation" locale={locale} secondary>
              {t("invitationAction")}
            </ChoiceForm>
          </div>
        </Card>

        <Card as="section" className="flex flex-col rounded-2xl border-l-2 border-l-[var(--rateloop-blue)] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold">{t("agentTitle")}</h2>
          <p className="mt-3 text-base leading-7 text-base-content/65">{t("agentDescription")}</p>
          <div className="mt-8 md:mt-auto md:pt-8">
            <ChoiceForm choice="agent" locale={locale}>
              {t("agentAction")}
            </ChoiceForm>
          </div>
        </Card>
      </div>
    </AppPageShell>
  );
}
