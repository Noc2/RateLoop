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

function messageValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(messageValues);
}

test("English and German expose the same message contract", () => {
  const englishKeys = messageKeys(getMessagesForLocale("en")).toSorted();
  const germanKeys = messageKeys(getMessagesForLocale("de")).toSorted();

  assert.deepEqual(germanKeys, englishKeys);
  assert.ok(englishKeys.includes("shell.navigation.primary"));
  assert.ok(englishKeys.includes("home.loop.stages.policy.title"));
  assert.ok(englishKeys.includes("auth.signIn.alreadySignedIn"));
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

test("German copy uses the established plain-language review vocabulary", () => {
  const germanMessages = getMessagesForLocale("de");
  const germanCopy = messageValues(germanMessages)
    .map(value => value.replaceAll("{reviewer}", ""))
    .join("\n");

  assert.equal(germanMessages.shell.brandTagline, "Prüfung");
  assert.equal(
    [
      germanMessages.home.loop.titleLine1,
      germanMessages.home.loop.titleLine2,
      germanMessages.home.loop.titleLine3,
    ].join(" "),
    "Geprüft von Menschen.",
  );
  assert.equal(
    [
      germanMessages.public.site.phrases["The Human"],
      germanMessages.public.site.phrases.Assurance,
      germanMessages.public.site.phrases.Loop,
    ].join(" "),
    "Geprüft von Menschen.",
  );
  assert.doesNotMatch(germanCopy, /Absicher|Assurance|Evidenz|Review(?:er|s)?|eingefror|\bPrincipal\b/iu);
});

test("one English concept keeps one German noun", () => {
  // The setup wizard called it „Arbeitsbereich" 54 times while navigation and
  // every other surface said „Workspace" 204 times, so a visitor created one
  // thing and was then shown another. And "evidence packet" had two renderings —
  // „Belegpaket" (a receipt) and „Nachweispaket" (the compliance term). Both are
  // the kind of split a Mittelstand evaluator notices in the first five minutes.
  const germanCopy = messageValues(getMessagesForLocale("de")).join("\n");

  assert.doesNotMatch(germanCopy, /Arbeitsbereich/u, "the workspace is a Workspace everywhere");
  assert.doesNotMatch(
    germanCopy,
    /(?<!Standard)Belegpaket/u,
    "an evidence packet is a Nachweispaket; Standardbelegpaket survives only in the AVV, where wording is counsel's",
  );
  assert.match(germanCopy, /Nachweispaket/u, "and the surviving term is actually used");

  // A masculine loanword takes -s in the genitive. Dative and accusative
  // ("im Workspace", "den Workspace") are correct as they stand.
  assert.doesNotMatch(germanCopy, /\b(?:des|dieses|eines|jedes) Workspace\b(?!s)/u);

  // Decision packet and assurance archive are different English concepts, so
  // their distinct German nouns are correct and must not be collapsed into one.
  assert.match(germanCopy, /Entscheidungspaket/u);
  assert.match(germanCopy, /Prüfnachweisarchiv/u);
});
