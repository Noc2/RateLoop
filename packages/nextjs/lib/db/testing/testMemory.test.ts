import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readJournalMigrationFiles } from "~~/lib/db/testing/testMemory";

type Journal = { entries: Array<{ idx: number; tag: string }> };

function scratchMigrationDirectory(journal: unknown, files: string[]) {
  const directory = mkdtempSync(join(tmpdir(), "rateloop-journal-"));
  mkdirSync(join(directory, "meta"));
  writeFileSync(join(directory, "meta", "_journal.json"), JSON.stringify(journal));
  for (const file of files) {
    writeFileSync(join(directory, file), "SELECT 1;");
  }
  return directory;
}

test("the memory migrator applies exactly the migrations the journal declares, in journal order", () => {
  const drizzleDirectory = join(process.cwd(), "drizzle");
  const journal = JSON.parse(readFileSync(join(drizzleDirectory, "meta", "_journal.json"), "utf8")) as Journal;

  assert.deepEqual(
    readJournalMigrationFiles(drizzleDirectory),
    journal.entries.map(entry => `${entry.tag}.sql`),
  );
});

test("the memory migrator ignores SQL files the journal does not declare and honours journal order", () => {
  const directory = scratchMigrationDirectory(
    {
      entries: [
        { idx: 1, tag: "0001_second" },
        { idx: 0, tag: "0000_first" },
      ],
    },
    ["0000_first.sql", "0001_second.sql", "0066_excised.sql", "9999_stray.sql"],
  );
  try {
    assert.deepEqual(readJournalMigrationFiles(directory), ["0001_second.sql", "0000_first.sql"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the memory migrator fails loudly when the journal declares a missing migration", () => {
  const directory = scratchMigrationDirectory({ entries: [{ idx: 0, tag: "0000_first" }] }, []);
  try {
    assert.throws(
      () => readJournalMigrationFiles(directory),
      /Drizzle journal declares 0000_first\.sql, but that migration file does not exist\./,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the memory migrator fails loudly when the journal is missing or malformed", () => {
  const missingJournal = mkdtempSync(join(tmpdir(), "rateloop-journal-"));
  const untaggedJournal = scratchMigrationDirectory({ entries: [{ idx: 0 }] }, []);
  const entrylessJournal = scratchMigrationDirectory({}, []);
  try {
    assert.throws(() => readJournalMigrationFiles(missingJournal), /Drizzle journal is missing/);
    assert.throws(() => readJournalMigrationFiles(untaggedJournal), /entry without a tag/);
    assert.throws(() => readJournalMigrationFiles(entrylessJournal), /declares no migration entries/);
  } finally {
    for (const directory of [missingJournal, untaggedJournal, entrylessJournal]) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
