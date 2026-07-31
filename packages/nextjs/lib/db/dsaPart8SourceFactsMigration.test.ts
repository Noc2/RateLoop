import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0169_dsa_part8_source_facts.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0169 binds exactly one immutable Part 8 fact to an exact 0168 decision version", () => {
  assert.match(migration, /CREATE TABLE "tokenless_dsa_moderation_measure_facts"/u);
  assert.match(migration, /PRIMARY KEY \("workspace_id", "provider_decision_id", "decision_version"\)/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "provider_decision_id", "decision_version"\)[\s\S]*REFERENCES "tokenless_dsa_source_decision_versions"/u,
  );
  assert.match(migration, /UNIQUE \("workspace_id", "moderation_measure_id"\)/u);
  assert.match(migration, /tokenless_dsa_moderation_measure_facts_append_only/u);
});

test("0169 constrains origin, automation, classifier, notice, and coded language shapes", () => {
  for (const value of [
    "authority_order",
    "article16_notice",
    "own_initiative",
    "solely_automated",
    "not_solely_automated",
    "trusted_flagger",
    "other",
    "no_linguistic_content",
    "language_undetermined",
    "not_applicable",
  ]) {
    assert.match(migration, new RegExp(`'${value}'`, "u"), value);
  }
  assert.match(migration, /"origin" = 'article16_notice'[\s\S]*"article16_notice_id" ~/u);
  assert.match(migration, /"origin" <> 'article16_notice'[\s\S]*"article16_notice_id" IS NULL/u);
  assert.match(migration, /"automation_processing" = 'solely_automated'[\s\S]*"classifier_system_id" ~/u);
  assert.match(migration, /"automation_processing" = 'not_solely_automated'[\s\S]*"classifier_system_id" IS NULL/u);
  assert.match(migration, /"language_codes_json" = '\[\]'[\s\S]*"no_language_reason" IN/u);
});

test("0169 validates a unique canonical array from the complete EU official-language allowlist", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION tokenless_dsa_part8_language_codes_are_canonical\(candidate text\)/u,
  );
  assert.match(migration, /jsonb_typeof\(parsed\) <> 'array'/u);
  assert.match(migration, /jsonb_typeof\(item\) <> 'string'/u);
  assert.match(migration, /count\(DISTINCT code\)/u);
  assert.match(migration, /string_agg\(code, '","' ORDER BY code\)/u);
  for (const code of [
    "bg",
    "cs",
    "da",
    "de",
    "el",
    "en",
    "es",
    "et",
    "fi",
    "fr",
    "ga",
    "hr",
    "hu",
    "it",
    "lt",
    "lv",
    "mt",
    "nl",
    "pl",
    "pt",
    "ro",
    "sk",
    "sl",
    "sv",
  ]) {
    assert.match(migration, new RegExp(`'${code}'`, "u"), code);
  }
  assert.match(migration, /tokenless_dsa_part8_language_codes_are_canonical\("language_codes_json"\)/u);
});

test("0169 is the journal head after the reconciled population ledger", () => {
  assert.deepEqual(
    journal.entries.slice(-2).map(entry => ({ idx: entry.idx, tag: entry.tag })),
    [
      { idx: 168, tag: "0168_dsa_population_ledger" },
      { idx: 169, tag: "0169_dsa_part8_source_facts" },
    ],
  );
});
