import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

type JournalEntry = {
  tag: string;
};

type Journal = {
  entries: JournalEntry[];
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
