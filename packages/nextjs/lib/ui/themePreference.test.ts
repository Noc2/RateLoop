import {
  THEMES,
  THEME_COOKIE_MAX_AGE_SECONDS,
  THEME_COOKIE_NAME,
  parseThemePreference,
  readThemePreferenceFromCookie,
  resolveThemePreference,
  serializeThemePreferenceCookie,
} from "./themePreference";
import assert from "node:assert/strict";
import test from "node:test";

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
