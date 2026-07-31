import { getMessagesForLocale } from "./messages";
import assert from "node:assert/strict";
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
