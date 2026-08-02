import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { AgentsLocaleProvider } from "~~/components/tokenless/agents/AgentsLocaleProvider";
import { DocumentLocale } from "~~/components/tokenless/preferences/DocumentLocale";
import { isLocale } from "~~/i18n/config";
import { getIntlMessagesForLocale } from "~~/i18n/messages";

type LocaleLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

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
