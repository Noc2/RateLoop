import {
  THEMES,
  THEME_COOKIE_MAX_AGE_SECONDS,
  THEME_COOKIE_NAME,
  applyThemePreference,
  createThemeBootstrapScript,
  parseThemePreference,
  readThemePreferenceFromCookie,
  resolveThemePreference,
  serializeThemePreferenceCookie,
} from "./themePreference";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

test("theme preference accepts only explicit light and dark values", () => {
  assert.deepEqual(THEMES, ["light", "dark"]);
  assert.equal(parseThemePreference("light"), "light");
  assert.equal(parseThemePreference("dark"), "dark");
  assert.equal(parseThemePreference("system"), undefined);
  assert.equal(parseThemePreference(""), undefined);
  assert.equal(parseThemePreference(undefined), undefined);
});

test("missing preference resolves from the operating-system preference", () => {
  assert.equal(resolveThemePreference(undefined, false), "light");
  assert.equal(resolveThemePreference(undefined, true), "dark");
  assert.equal(resolveThemePreference("light", true), "light");
  assert.equal(resolveThemePreference("dark", false), "dark");
});

test("the pre-hydration bootstrap resolves every initial state to the shared light or dark theme", () => {
  for (const boundary of [
    { explicit: undefined, prefersDark: false, expected: "light" },
    { explicit: undefined, prefersDark: true, expected: "dark" },
    { explicit: "light", prefersDark: true, expected: "light" },
    { explicit: "dark", prefersDark: false, expected: "dark" },
  ] as const) {
    const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
    if (boundary.explicit) root.dataset.theme = boundary.explicit;

    vm.runInNewContext(createThemeBootstrapScript(), {
      document: { documentElement: root },
      window: { matchMedia: () => ({ matches: boundary.prefersDark }) },
    });

    assert.equal(root.dataset.theme, boundary.expected);
    assert.equal(root.style.colorScheme, boundary.expected);
  }
});

test("all theme consumers share the same document application invariant", () => {
  const root = { dataset: {} as DOMStringMap, style: {} as CSSStyleDeclaration };
  assert.equal(applyThemePreference(root, "light"), "light");
  assert.equal(root.dataset.theme, "light");
  assert.equal(root.style.colorScheme, "light");
  assert.equal(applyThemePreference(root, "dark"), "dark");
  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.style.colorScheme, "dark");
});

test("theme preference is read without accepting similarly named or invalid cookies", () => {
  assert.equal(readThemePreferenceFromCookie("session=abc; rateloop-theme=dark; locale=de"), "dark");
  assert.equal(readThemePreferenceFromCookie("rateloop-theme=light"), "light");
  assert.equal(readThemePreferenceFromCookie("other-rateloop-theme=dark"), undefined);
  assert.equal(readThemePreferenceFromCookie("rateloop-theme=system"), undefined);
  assert.equal(readThemePreferenceFromCookie("rateloop-theme=%E0%A4%A"), undefined);
});

test("explicit preference cookie is durable, same-site, and secure on HTTPS", () => {
  assert.equal(
    serializeThemePreferenceCookie("dark", true),
    `${THEME_COOKIE_NAME}=dark; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax; Secure`,
  );
  assert.equal(
    serializeThemePreferenceCookie("light", false),
    `${THEME_COOKIE_NAME}=light; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`,
  );
});
