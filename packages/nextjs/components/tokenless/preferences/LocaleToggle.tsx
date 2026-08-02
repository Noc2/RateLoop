"use client";

import { useSearchParams } from "next/navigation";
import { persistAuthenticatedAccountPreference } from "./authenticatedAccountPreferences";
import { useLocale, useTranslations } from "next-intl";
import { type Locale, isLocale } from "~~/i18n/config";
import { usePathname, useRouter } from "~~/i18n/navigation";

async function persistAuthenticatedLocale(locale: Locale) {
  try {
    await persistAuthenticatedAccountPreference({ preferredLocale: locale });
  } catch {
    // The locale cookie and URL remain authoritative for signed-out or offline visitors.
  }
}

export function LocaleToggle({ className = "" }: { className?: string }) {
  const currentLocale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("shell.preferences");
  const locale: Locale = isLocale(currentLocale) ? currentLocale : "en";
  const nextLocale: Locale = locale === "de" ? "en" : "de";
  const nextLabel = nextLocale === "de" ? t("german") : t("english");

  function switchLocale() {
    void persistAuthenticatedLocale(nextLocale);
    const query = searchParams.toString();
    const hash = window.location.hash;
    router.replace(`${pathname}${query ? `?${query}` : ""}${hash}`, { locale: nextLocale, scroll: false });
  }

  return (
    <button
      type="button"
      className={`btn btn-ghost btn-sm min-h-9 px-2.5 font-mono text-xs font-semibold ${className}`}
      aria-label={`${t("language")}: ${nextLabel}`}
      title={`${t("language")}: ${nextLabel}`}
      onClick={switchLocale}
    >
      {nextLocale.toUpperCase()}
    </button>
  );
}
