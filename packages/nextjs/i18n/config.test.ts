import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isLocale, stripLocalePrefix } from "./config";
import { getMessagesForLocale } from "./messages";
import assert from "node:assert/strict";
import test from "node:test";

function messageKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, child]) => messageKeys(child, prefix ? `${prefix}.${key}` : key));
}

test("English and German expose the same message contract", () => {
  const englishKeys = messageKeys(getMessagesForLocale("en")).toSorted();
  const germanKeys = messageKeys(getMessagesForLocale("de")).toSorted();

  assert.deepEqual(germanKeys, englishKeys);
  assert.ok(englishKeys.includes("shell.navigation.primary"));
  assert.ok(englishKeys.includes("home.loop.stages.policy.title"));
  assert.ok(englishKeys.includes("auth.brandTitle"));
});

test("locale validation and URL normalization share the supported locale contract", () => {
  assert.equal(DEFAULT_LOCALE, "en");
  assert.deepEqual(SUPPORTED_LOCALES, ["en", "de"]);

  for (const locale of SUPPORTED_LOCALES) {
    assert.equal(isLocale(locale), true);
    assert.equal(stripLocalePrefix(`/${locale}`), "/");
    assert.equal(stripLocalePrefix(`/${locale}/docs`), "/docs");
  }

  assert.equal(isLocale("fr"), false);
  assert.equal(stripLocalePrefix("/debug"), "/debug");
  assert.equal(stripLocalePrefix("/deutsch"), "/deutsch");
});
