import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getMessagesForLocale } from "~~/i18n/messages";

const source = readFileSync(new URL("./PaidWorkUnavailableNotice.tsx", import.meta.url), "utf8");

function namespaceValue(locale: "en" | "de", namespace: string): unknown {
  let node: unknown = getMessagesForLocale(locale);
  for (const key of namespace.split(".")) {
    if (!node || typeof node !== "object" || !(key in node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

test("the paid-work notice resolves a namespace that exists in both catalogues", () => {
  // next-intl namespaces every catalogue by its filename, so a top-level key in
  // human.json is reachable only as `human.<key>`. Getting this wrong renders the
  // raw key strings on screen rather than falling back to English, because
  // AgentsLocaleProvider and next-intl both surface the key on a miss.
  const namespace = source.match(/useTranslations\("([^"]+)"\)/u)?.[1];
  assert.equal(namespace, "human.paidWorkUnavailable");

  for (const locale of ["en", "de"] as const) {
    const node = namespaceValue(locale, namespace);
    assert.ok(node && typeof node === "object", `${locale} is missing the ${namespace} namespace`);
    for (const key of ["eyebrow", "title", "body"]) {
      const value: unknown = (node as Record<string, unknown>)[key];
      assert.equal(typeof value, "string", `${locale}.${namespace}.${key} must be a string`);
      assert.ok(String(value).trim().length > 0, `${locale}.${namespace}.${key} must not be empty`);
    }
  }
});

test("the notice does not publish internal release blockers to the reviewer", () => {
  // AGENTS.md keeps incomplete capabilities and release blockers in internal
  // engineering records. An earlier version passed configuredHumanReviewLaneMessage
  // straight through, which put untranslated engineering vocabulary on the profile
  // of a person the customer nominated.
  assert.doesNotMatch(source, /configuredHumanReviewLaneMessage|reason/u);

  for (const locale of ["en", "de"] as const) {
    const node = namespaceValue(locale, "human.paidWorkUnavailable") as Record<string, string>;
    assert.doesNotMatch(node.body, /release|blocker|terminal-evidence|decision-binding/iu);
  }
});
