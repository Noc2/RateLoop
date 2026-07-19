import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

type JournalEntry = {
  idx: number;
  tag: string;
};

type Journal = {
  entries: JournalEntry[];
};

type Excisions = {
  schemaVersion: string;
  exclusions: Array<{ idx: number; reason: string }>;
};

test("Drizzle journal covers every numbered SQL migration", () => {
  const drizzleDir = join(process.cwd(), "drizzle");
  const sqlMigrations = readdirSync(drizzleDir)
    .filter(file => /^\d{4}_.+\.sql$/.test(file))
    .map(file => file.replace(/\.sql$/, ""))
    .sort();

  const journal = JSON.parse(readFileSync(join(drizzleDir, "meta", "_journal.json"), "utf8")) as Journal;
  const journalTags = new Set(journal.entries.map(entry => entry.tag));
  const missingTags = sqlMigrations.filter(migration => !journalTags.has(migration));

  assert.deepEqual(missingTags, []);
});

test("Drizzle journal indices are contiguous except for immutable declared excisions", () => {
  const drizzleDir = join(process.cwd(), "drizzle");
  const journal = JSON.parse(readFileSync(join(drizzleDir, "meta", "_journal.json"), "utf8")) as Journal;
  const excisions = JSON.parse(readFileSync(join(drizzleDir, "meta", "excised-migrations.json"), "utf8")) as Excisions;

  assert.equal(excisions.schemaVersion, "rateloop.migration-excisions.v1");
  assert.deepEqual(excisions.exclusions, [
    {
      idx: 66,
      reason: "Reserved during development and never shipped; no SQL migration or journal entry exists.",
    },
  ]);
  const excisedIndices = new Set(excisions.exclusions.map(exclusion => exclusion.idx));
  const actualIndices = new Set(journal.entries.map(entry => entry.idx));
  const expectedIndices = Array.from({ length: journal.entries.at(-1)!.idx + 1 }, (_, idx) => idx).filter(
    idx => !excisedIndices.has(idx),
  );

  assert.deepEqual(
    journal.entries.map(entry => entry.idx),
    expectedIndices,
  );
  for (const exclusion of excisions.exclusions) {
    assert.equal(actualIndices.has(exclusion.idx), false);
    assert.equal(
      readdirSync(drizzleDir).some(file => file.startsWith(`${String(exclusion.idx).padStart(4, "0")}_`)),
      false,
    );
  }
});

test("the hosted product cleanup releases question foreign keys before deleting obsolete quotes", () => {
  const migration = readFileSync(join(process.cwd(), "drizzle", "0048_remove_sandbox_product.sql"), "utf8");
  const releaseMedia = migration.indexOf('UPDATE "tokenless_public_question_media"');
  const deleteQuestions = migration.indexOf('DELETE FROM "tokenless_question_records"');
  const deleteQuotes = migration.indexOf('DELETE FROM "tokenless_agent_quotes"');

  assert.ok(releaseMedia >= 0);
  assert.ok(deleteQuestions > releaseMedia);
  assert.ok(deleteQuotes > deleteQuestions);
  assert.match(migration, /WHERE "quote_id" IN \(SELECT "quote_id" FROM "tokenless_removed_sandbox_quotes"\)/);
});
