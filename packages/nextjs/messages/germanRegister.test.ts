import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/**
 * German address form.
 *
 * The public marketing and legal copy has always used the formal register, and
 * the signed-in product used the informal one, so a buyer was addressed as *Sie*
 * on the website and as *du* the moment they signed in. For a Mittelstand
 * audience that reads as unprofessional at exactly the wrong moment, and it is
 * the kind of thing that gets noticed and not mentioned.
 *
 * Formal is the target everywhere. This is a linguistic rule, not a phrase list,
 * so the patterns below look for the grammatical markers rather than for
 * sentences somebody happened to write.
 */
const INFORMAL_PRONOUNS = /(?<![\p{L}])(?:du|dich|dir|dein(?:e|em|en|er|es)?)(?![\p{L}])/giu;

/**
 * Bare second-person-singular imperatives. German imperatives drop the pronoun,
 * so "Wähle eine Antwort" is informal with nothing to match on but the verb.
 * Only sentence-initial forms count — "Lade" mid-sentence is usually a noun
 * ("Ladezustand") or another part of speech.
 */
const INFORMAL_IMPERATIVES =
  /(?:^|[.!?…]\s+|\n)(?:Wähle|Gib|Prüfe|Melde|Füge|Trage|Lade|Kopiere|Öffne|Sende|Erstelle|Bestätige|Verwende|Wechsle|Speichere|Entferne|Klicke|Starte|Beende|Schließe|Wiederhole|Versuche|Nimm|Gehe|Sieh|Lies)(?![\p{L}])/u;

/**
 * Words that merely contain a pronoun as a substring, or where the match is a
 * different part of speech entirely. Each is a real string from the catalogues.
 */
const NOT_SECOND_PERSON = [
  /\bdu(?:rch|al|plikat|rchschnitt)/iu, // durch, dual, Duplikat, Durchschnitt
  /\bdein(?:st)/iu,
];

function catalogueStrings(path: string) {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const found: { key: string; value: string }[] = [];
  const walk = (node: unknown, key: string) => {
    if (typeof node === "string") found.push({ key, value: node });
    else if (Array.isArray(node)) node.forEach((entry, index) => walk(entry, `${key}[${index}]`));
    else if (node && typeof node === "object") {
      for (const [name, value] of Object.entries(node)) walk(value, `${key}.${name}`);
    }
  };
  walk(parsed, "");
  return found;
}

test("every German string addresses the reader formally", () => {
  const root = new URL("./de/", import.meta.url);
  const offenders: string[] = [];
  for (const file of readdirSync(root).filter(name => name.endsWith(".json"))) {
    for (const { key, value } of catalogueStrings(new URL(file, root).pathname)) {
      if (NOT_SECOND_PERSON.some(pattern => pattern.test(value))) continue;
      const pronoun = value.match(INFORMAL_PRONOUNS);
      const imperative = INFORMAL_IMPERATIVES.test(value);
      if (pronoun || imperative) {
        offenders.push(`${file}${key}: ${value.slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `these still address the reader informally:\n${offenders.join("\n")}`);
});

test("the formal register is actually present, so the check cannot pass vacuously", () => {
  // A regex that matches nothing would satisfy the test above. Assert the
  // catalogues really do address the reader, and formally.
  const root = new URL("./de/", import.meta.url);
  let formal = 0;
  for (const file of readdirSync(root).filter(name => name.endsWith(".json"))) {
    for (const { value } of catalogueStrings(new URL(file, root).pathname)) {
      if (/(?<![\p{L}])(?:Sie|Ihre(?:m|n|r|s)?|Ihnen)(?![\p{L}])/u.test(value)) formal += 1;
    }
  }
  assert.ok(formal > 150, `expected the catalogues to address the reader formally, found ${formal} strings`);
});
