"use client";

import { useEffect } from "react";
import type { Locale } from "~~/i18n/config";

export function DocumentLocale({ locale }: { locale: Locale }) {
  useEffect(() => {
    const previousLocale = document.documentElement.lang;
    document.documentElement.lang = locale;
    return () => {
      document.documentElement.lang = previousLocale;
    };
  }, [locale]);

  return null;
}
