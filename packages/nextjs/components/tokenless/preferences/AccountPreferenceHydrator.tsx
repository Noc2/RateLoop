"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { isLocale } from "~~/i18n/config";
import { usePathname, useRouter } from "~~/i18n/navigation";
import { parseThemePreference, serializeThemePreferenceCookie } from "~~/lib/ui/themePreference";

type AccountPreferences = {
  preferredLocale?: unknown;
  preferredTheme?: unknown;
};

type AuthSession = {
  authenticated?: unknown;
};

let preferenceSyncCompleted = false;

export async function loadAuthenticatedAccountPreferences({
  fetcher = fetch,
  signal,
}: {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
} = {}): Promise<AccountPreferences | null> {
  const requestInit: RequestInit = {
    cache: "no-store",
    credentials: "same-origin",
    ...(signal ? { signal } : {}),
  };
  const sessionResponse = await fetcher("/api/auth/session", requestInit);
  if (!sessionResponse.ok) return null;
  const session = (await sessionResponse.json()) as AuthSession;
  if (session.authenticated !== true) return null;

  const profileResponse = await fetcher("/api/account/profile", requestInit);
  if (!profileResponse.ok) return null;
  return (await profileResponse.json()) as AccountPreferences;
}

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
          document.documentElement.dataset.theme = theme;
          document.documentElement.style.colorScheme = theme;
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
