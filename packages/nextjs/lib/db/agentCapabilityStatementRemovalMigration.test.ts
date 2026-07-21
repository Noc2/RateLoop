import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const migration = readFileSync(
  new URL("../../drizzle/0127_remove_agent_capability_statements.sql", import.meta.url),
  "utf8",
);

test("0127 removes capability-statement storage and its audit event", async () => {
  assert.match(migration, /DROP COLUMN IF EXISTS "intended_purpose"/u);
  assert.match(migration, /DROP COLUMN IF EXISTS "known_limitations"/u);
  assert.match(migration, /DROP COLUMN IF EXISTS "do_not_use_conditions"/u);
  assert.match(migration, /DELETE FROM "tokenless_agent_audit_events"/u);
  assert.doesNotMatch(migration.slice(migration.lastIndexOf("ADD CONSTRAINT")), /agent\.capability_statement_updated/u);

  const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
    entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
  };
  assert.deepEqual(
    journal.entries.find(entry => entry.idx === 127),
    {
      idx: 127,
      version: "7",
      when: 1784397600000,
      tag: "0127_remove_agent_capability_statements",
      breakpoints: true,
    },
  );

  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  const columns = await dbClient.execute(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'tokenless_agents'
       AND column_name IN ('intended_purpose', 'known_limitations', 'do_not_use_conditions',
                           'capability_statement_updated_at', 'capability_statement_updated_by')`,
  );
  assert.deepEqual(columns.rows, []);
});

afterEach(() => __setDatabaseResourcesForTests(null));
