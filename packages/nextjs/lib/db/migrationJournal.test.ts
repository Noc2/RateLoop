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
