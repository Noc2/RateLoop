"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { loadAuthenticatedAccountPreferences } from "./authenticatedAccountPreferences";
import { useLocale } from "next-intl";
import { isLocale } from "~~/i18n/config";
import { usePathname, useRouter } from "~~/i18n/navigation";
import { applyThemePreference, parseThemePreference, serializeThemePreferenceCookie } from "~~/lib/ui/themePreference";

let preferenceSyncCompleted = false;

export function AccountPreferenceHydrator() {
  const activeLocale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    if (preferenceSyncCompleted) return;
    const controller = new AbortController();

    void loadAuthenticatedAccountPreferences({ signal: controller.signal })
      .then(preferences => {
        if (!preferences || controller.signal.aborted) return;
        preferenceSyncCompleted = true;

        const theme =
          typeof preferences.preferredTheme === "string" ? parseThemePreference(preferences.preferredTheme) : undefined;
        if (theme) {
          applyThemePreference(document.documentElement, theme);
          document.cookie = serializeThemePreferenceCookie(theme, window.location.protocol === "https:");
        }

        const locale =
          typeof preferences.preferredLocale === "string" && isLocale(preferences.preferredLocale)
            ? preferences.preferredLocale
            : undefined;
        if (locale && locale !== activeLocale) {
          router.replace(`${pathname}${search ? `?${search}` : ""}${window.location.hash}`, {
            locale,
            scroll: false,
          });
        }
      })
      .catch(() => {
        // Signed-out, offline, and interrupted requests keep the local URL and theme behavior.
      });

    return () => controller.abort();
  }, [activeLocale, pathname, router, search]);

  return null;
}

export function __resetAccountPreferenceHydratorForTests() {
  preferenceSyncCompleted = false;
}
