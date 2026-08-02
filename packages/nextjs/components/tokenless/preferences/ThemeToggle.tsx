"use client";

import { useEffect, useState } from "react";
import { persistAuthenticatedAccountPreference } from "./authenticatedAccountPreferences";
import {
  type Theme,
  parseThemePreference,
  readThemePreferenceFromCookie,
  resolveThemePreference,
  serializeThemePreferenceCookie,
} from "~~/lib/ui/themePreference";

type ThemeToggleProps = {
  className?: string;
  darkActiveLabel?: string;
  lightActiveLabel?: string;
  switchToDarkLabel?: string;
  switchToLightLabel?: string;
};

function currentSystemTheme(): Theme {
  return resolveThemePreference(undefined, window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function applyExplicitTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

async function persistAuthenticatedTheme(theme: Theme) {
  try {
    await persistAuthenticatedAccountPreference({ preferredTheme: theme });
  } catch {
    // The theme cookie remains authoritative for signed-out or offline visitors.
  }
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.72 5.28l-1.42 1.42M6.7 17.3l-1.42 1.42M18.72 18.72 17.3 17.3M6.7 6.7 5.28 5.28" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M20.5 15.25A8.5 8.5 0 0 1 8.75 3.5a8.5 8.5 0 1 0 11.75 11.75Z" />
    </svg>
  );
}

export function ThemeToggle({
  className = "",
  darkActiveLabel = "Dark theme active",
  lightActiveLabel = "Light theme active",
  switchToDarkLabel = "Switch to dark theme",
  switchToLightLabel = "Switch to light theme",
}: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>();

  useEffect(() => {
    const explicitTheme = readThemePreferenceFromCookie(document.cookie);
    if (explicitTheme) {
      applyExplicitTheme(explicitTheme);
      setTheme(explicitTheme);
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateFromSystem = () => {
      if (readThemePreferenceFromCookie(document.cookie)) return;
      setTheme(resolveThemePreference(undefined, media.matches));
    };
    updateFromSystem();
    media.addEventListener("change", updateFromSystem);
    return () => media.removeEventListener("change", updateFromSystem);
  }, []);

  const toggleTheme = () => {
    const renderedTheme = theme ?? parseThemePreference(document.documentElement.dataset.theme) ?? currentSystemTheme();
    const nextTheme = renderedTheme === "dark" ? "light" : "dark";
    applyExplicitTheme(nextTheme);
    document.cookie = serializeThemePreferenceCookie(nextTheme, window.location.protocol === "https:");
    setTheme(nextTheme);
    void persistAuthenticatedTheme(nextTheme);
  };

  const nextTheme = theme === "dark" ? "light" : "dark";
  const nextThemeLabel = nextTheme === "dark" ? switchToDarkLabel : switchToLightLabel;

  return (
    <button
      type="button"
      className={`rateloop-theme-toggle ${className}`.trim()}
      onClick={toggleTheme}
      aria-label={nextThemeLabel}
      title={nextThemeLabel}
    >
      <span className="rateloop-theme-toggle__sun">
        <SunIcon />
      </span>
      <span className="rateloop-theme-toggle__moon">
        <MoonIcon />
      </span>
      <span className="sr-only" aria-live="polite">
        {theme ? (theme === "dark" ? darkActiveLabel : lightActiveLabel) : ""}
      </span>
    </button>
  );
}
