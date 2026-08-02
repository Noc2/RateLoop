import { getIntlMessagesForLocale, getMessagesForLocale } from "./messages";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type Catalog = Record<string, unknown>;

function flattenCatalog(value: Catalog, prefix = ""): Map<string, string> {
  const leaves = new Map<string, string>();

  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "string") {
      leaves.set(path, entry);
      continue;
    }
    assert.ok(entry && typeof entry === "object" && !Array.isArray(entry), `${path} must be a message or namespace`);
    for (const [nestedPath, nestedValue] of flattenCatalog(entry as Catalog, path)) {
      leaves.set(nestedPath, nestedValue);
    }
  }

  return leaves;
}

function placeholderNames(message: string) {
  return [...message.matchAll(/\{([\w]+)(?:,|\})/gu)].map(match => match[1]).sort();
}

function assertNoDottedKeys(value: Catalog, prefix = "") {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    assert.equal(key.includes("."), false, `${path} contains a dotted next-intl key`);
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      assertNoDottedKeys(entry as Catalog, path);
    }
  }
}

test("English and German catalogs have the same non-empty messages and placeholders", () => {
  const english = flattenCatalog(getMessagesForLocale("en"));
  const german = flattenCatalog(getMessagesForLocale("de"));

  assert.deepEqual([...german.keys()].sort(), [...english.keys()].sort());
  for (const [path, englishMessage] of english) {
    const germanMessage = german.get(path);
    assert.ok(englishMessage.trim(), `${path} has English copy`);
    if (typeof germanMessage !== "string") throw new Error(`${path} has no German copy`);
    assert.ok(germanMessage.trim(), `${path} has German copy`);
    assert.deepEqual(placeholderNames(germanMessage), placeholderNames(englishMessage), `${path} placeholders match`);
  }
});

test("the next-intl payload excludes phrase dictionaries and dotted namespace keys", () => {
  for (const locale of ["en", "de"] as const) {
    const intlMessages = getIntlMessagesForLocale(locale);
    assert.equal("public" in intlMessages, false);
    assert.equal("shared" in intlMessages, false);
    assertNoDottedKeys(intlMessages);
  }
});

test("both next-intl providers use the safe message selector", () => {
  for (const file of ["request.ts", "../app/[locale]/layout.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /\bgetIntlMessagesForLocale\b/u, file);
    assert.doesNotMatch(source, /\bgetMessagesForLocale\b/u, file);
  }
});
