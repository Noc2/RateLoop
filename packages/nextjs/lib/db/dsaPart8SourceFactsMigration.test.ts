import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DSA_PART8_EMPTY_AUTOMATED_MEANS_EVALUATION_SET_ROOT } from "~~/lib/tokenless/dsaPart8SourceFacts";

const migration = readFileSync(new URL("../../drizzle/0169_dsa_part8_source_facts.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0169 binds exactly one immutable v3 Part 8 decision fact to an exact 0168 decision version", () => {
  assert.match(migration, /CREATE TABLE "tokenless_dsa_content_moderation_decision_facts"/u);
  assert.match(migration, /PRIMARY KEY \("workspace_id", "provider_decision_id", "decision_version"\)/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "provider_decision_id", "decision_version"\)[\s\S]*REFERENCES "tokenless_dsa_source_decision_versions"/u,
  );
  assert.match(migration, /UNIQUE \("workspace_id", "moderation_measure_id"\)/u);
  assert.match(migration, /tokenless_dsa_content_moderation_decision_facts_append_only/u);
  assert.match(migration, /"schema_version" = 'rateloop\.dsa-part8-content-moderation-decision\.v3'/u);
  assert.match(migration, /"measure_taken" = false AND "moderation_measure_id" IS NULL/u);
  assert.doesNotMatch(migration, /automatic_removal|classifier_system_id|classifier_version|classifier_machine_class/u);
  assert.match(migration, /tokenless_guard_dsa_no_measure_non_required_basis/u);
});

test("0169 constrains decision-level origin, automation, notice, and coded language shapes", () => {
  for (const value of [
    "authority_order",
    "article16_notice",
    "own_initiative",
    "solely_automated",
    "partially_automated",
    "not_automated",
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
  assert.match(migration, /"automation_processing" IN \('solely_automated', 'partially_automated', 'not_automated'\)/u);
  assert.match(migration, /"language_codes_json" = '\[\]'[\s\S]*"no_language_reason" IN/u);
});

test("0169 normalizes immutable automated-means evaluations under the exact decision fact", () => {
  assert.match(migration, /CREATE TABLE "tokenless_dsa_automated_means_evaluations"/u);
  assert.match(migration, /PRIMARY KEY \("workspace_id", "evaluation_id"\)/u);
  assert.match(migration, /UNIQUE \("workspace_id", "provider_decision_id", "decision_version", "evaluation_id"\)/u);
  assert.match(
    migration,
    /UNIQUE \("workspace_id", "provider_decision_id", "decision_version", "system_id", "system_version"\)/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "provider_decision_id", "decision_version"\)[\s\S]*REFERENCES "tokenless_dsa_content_moderation_decision_facts"/u,
  );
  assert.match(migration, /rateloop\.dsa-part8-automated-means-evaluation\.v1/u);
  assert.match(migration, /"automated_outcome" IN \('pass', 'fail'\)/u);
  assert.match(migration, /"public_designation" = btrim\("public_designation"\)/u);
  assert.match(migration, /NOT \("public_designation" ~ '\^\[=\+@-\]'\)/u);
  assert.match(migration, /tokenless_dsa_automated_means_evaluations_append_only/u);
});

test("0169 binds and defers exact evaluation-set completeness to transaction commit", () => {
  assert.match(migration, /"expected_evaluation_count" integer NOT NULL/u);
  assert.match(migration, /"evaluation_set_root" text NOT NULL/u);
  assert.ok(migration.includes(`"evaluation_set_root" = '${DSA_PART8_EMPTY_AUTOMATED_MEANS_EVALUATION_SET_ROOT}'`));
  assert.match(migration, /"automation_processing" = 'not_automated'[\s\S]*"expected_evaluation_count" = 0/u);
  assert.match(migration, /CREATE OR REPLACE FUNCTION tokenless_enforce_dsa_evaluation_set_completeness/u);
  assert.match(migration, /actual_count <> expected_count/u);
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER tokenless_dsa_decision_evaluation_set_completeness[\s\S]*DEFERRABLE INITIALLY DEFERRED/u,
  );
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER tokenless_dsa_evaluation_set_completeness[\s\S]*DEFERRABLE INITIALLY DEFERRED/u,
  );
});

test("0169 rejects evaluations for a not-automated or missing exact decision at the database boundary", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION tokenless_guard_dsa_automated_means_evaluation/u);
  assert.match(migration, /d\.automation_processing IN \('solely_automated', 'partially_automated'\)/u);
  assert.match(migration, /USING ERRCODE = '23514'/u);
  assert.match(migration, /tokenless_dsa_automated_means_evaluations_decision_guard/u);
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

test("0169 immediately follows the reconciled population ledger", () => {
  const part8Index = journal.entries.findIndex(entry => entry.tag === "0169_dsa_part8_source_facts");
  assert.deepEqual(
    journal.entries.slice(part8Index - 1, part8Index + 1).map(entry => ({ idx: entry.idx, tag: entry.tag })),
    [
      { idx: 168, tag: "0168_dsa_population_ledger" },
      { idx: 169, tag: "0169_dsa_part8_source_facts" },
    ],
  );
});
