"use client";

import { useLocale, useTranslations } from "next-intl";
import { RootRecoverySurface } from "~~/components/tokenless/RootRecoverySurface";
import { RuntimeErrorActions } from "~~/components/tokenless/RuntimeErrorActions";
import { TokenlessShell } from "~~/components/tokenless/TokenlessShell";
import { DEFAULT_LOCALE, isLocale } from "~~/i18n/config";

export default function LocalizedError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const requestedLocale = useLocale();
  const locale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;
  const t = useTranslations("common.recovery");

  return (
    <TokenlessShell>
      <RootRecoverySurface
        eyebrow={t("error.eyebrow")}
        title={t("error.title")}
        description={t("error.description")}
        locale={locale}
        navigationLabel={t("usefulDestinations")}
        destinationLabels={{
          search: t("search"),
          reviewWork: t("reviewWork"),
          manageAgents: t("manageAgents"),
          readDocs: t("readDocs"),
        }}
        actions={
          <RuntimeErrorActions reset={reset} tryAgainLabel={t("error.tryAgain")} goBackLabel={t("error.goBack")} />
        }
      />
    </TokenlessShell>
  );
}
