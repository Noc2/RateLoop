import { DEFAULT_LOCALE, LOCALE_COOKIE_MAX_AGE_SECONDS, LOCALE_COOKIE_NAME, SUPPORTED_LOCALES } from "./config";
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "as-needed",
  localeCookie: {
    name: LOCALE_COOKIE_NAME,
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
  localeDetection: true,
  alternateLinks: true,
});
