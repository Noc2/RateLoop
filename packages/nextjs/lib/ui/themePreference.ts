export const THEME_COOKIE_NAME = "rateloop-theme";
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const THEMES = ["light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

type ThemeRoot = {
  dataset: DOMStringMap;
  style: CSSStyleDeclaration;
};

export function parseThemePreference(value: string | null | undefined): Theme | undefined {
  return THEMES.find(theme => theme === value);
}

export function readThemePreferenceFromCookie(cookieHeader: string | null | undefined): Theme | undefined {
  if (!cookieHeader) return undefined;

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1) continue;
    const name = cookie.slice(0, separatorIndex).trim();
    if (name !== THEME_COOKIE_NAME) continue;

    const value = cookie.slice(separatorIndex + 1).trim();
    try {
      return parseThemePreference(decodeURIComponent(value));
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function resolveThemePreference(preference: Theme | undefined, prefersDark: boolean): Theme {
  return preference ?? (prefersDark ? "dark" : "light");
}

export function applyThemePreference(root: ThemeRoot, theme: Theme): Theme {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  return theme;
}

export function createThemeBootstrapScript(): string {
  const themes = JSON.stringify(THEMES);
  const resolveTheme = resolveThemePreference.toString();
  const applyTheme = applyThemePreference.toString();

  return `(() => { const root = document.documentElement; const themes = ${themes}; const current = root.dataset.theme; const preference = themes.includes(current) ? current : undefined; const theme = (${resolveTheme})(preference, window.matchMedia("(prefers-color-scheme: dark)").matches); (${applyTheme})(root, theme); })();`;
}

export function serializeThemePreferenceCookie(theme: Theme, secure: boolean): string {
  return [
    `${THEME_COOKIE_NAME}=${encodeURIComponent(theme)}`,
    "Path=/",
    `Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    secure ? "Secure" : undefined,
  ]
    .filter(Boolean)
    .join("; ");
}
