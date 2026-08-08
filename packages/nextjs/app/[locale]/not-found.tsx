import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { RootRecoverySurface } from "~~/components/tokenless/RootRecoverySurface";
import { TokenlessShell } from "~~/components/tokenless/TokenlessShell";
import { Button } from "~~/components/tokenless/ui/Button";
import { DEFAULT_LOCALE, isLocale } from "~~/i18n/config";
import { Link } from "~~/i18n/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.recovery.notFound");
  return { title: t("title") };
}

export default async function LocalizedNotFound() {
  const [requestedLocale, t] = await Promise.all([getLocale(), getTranslations("common.recovery")]);
  const locale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;

  return (
    <TokenlessShell>
      <RootRecoverySurface
        eyebrow="404"
        title={t("notFound.title")}
        description={t("notFound.description")}
        locale={locale}
        navigationLabel={t("usefulDestinations")}
        destinationLabels={{
          search: t("search"),
          reviewWork: t("reviewWork"),
          manageAgents: t("manageAgents"),
          readDocs: t("readDocs"),
        }}
        actions={
          <Button as={Link} variant="secondary" size="none" className="min-h-11" href="/">
            {t("notFound.home")}
          </Button>
        }
      />
    </TokenlessShell>
  );
}
