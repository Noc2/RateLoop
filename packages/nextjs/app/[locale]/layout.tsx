import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AgentsLocaleProvider } from "~~/components/tokenless/agents/AgentsLocaleProvider";
import { DocumentLocale } from "~~/components/tokenless/preferences/DocumentLocale";
import { DEFAULT_LOCALE, isLocale } from "~~/i18n/config";
import { getIntlMessagesForLocale } from "~~/i18n/messages";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

type LocaleLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

/**
 * The root layout can only state one language, so a localized default title and
 * description have to be resolved here, where the requested locale is known.
 * Pages below still override the title; without this segment they would also
 * inherit the English description.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: requestedLocale } = await params;
  const locale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "shell.siteMetadata" });
  return getMetadata({
    title: t("title"),
    description: t("description"),
    ignoreInheritedTitleTemplate: true,
  });
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  setRequestLocale(locale);

  return (
    <NextIntlClientProvider locale={locale} messages={getIntlMessagesForLocale(locale)} timeZone="UTC">
      <DocumentLocale locale={locale} />
      <AgentsLocaleProvider locale={locale}>{children}</AgentsLocaleProvider>
    </NextIntlClientProvider>
  );
}
