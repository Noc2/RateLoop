import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const migration = readFileSync(new URL("../../drizzle/0148_subject_export_v4.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("subject export v4 is forward-only and journaled after hybrid request-profile semantics", () => {
  assert.equal(journal.entries.find(value => value.tag === "0148_subject_export_v4")?.idx, 148);
  assert.match(migration, /DROP CONSTRAINT "tokenless_subject_request_exports_lifetime_check"/u);
  assert.match(migration, /"schema_version" IN \(1, 3, 4\)/u);
  assert.doesNotMatch(migration, /UPDATE "tokenless_subject_request_exports"|DROP TABLE/u);
});

test("the memory database applies the v4 export constraint", async () => {
  const resources = createMemoryDatabaseResources();
  try {
    await resources.pool.query(
      `INSERT INTO tokenless_subject_requests
       (request_id,principal_id,request_type,status,scope_json,identity_assurance,
        received_at,due_at,completed_at)
       VALUES ('dsr_export_v4_migration','subject_export_v4','export','completed','{}',
               'test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    );
    await resources.pool.query(
      `INSERT INTO tokenless_subject_request_exports
       (request_id,principal_id,schema_version,payload_json,payload_hash,generated_at,delete_after)
       VALUES ('dsr_export_v4_migration','subject_export_v4',4,
               '{"schemaVersion":"rateloop.subject-export.v4"}',
               $1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + INTERVAL '1 day')`,
      [`sha256:${"a".repeat(64)}`],
    );
    const stored = await resources.pool.query(
      "SELECT schema_version FROM tokenless_subject_request_exports WHERE request_id='dsr_export_v4_migration'",
    );
    assert.equal(Number(stored.rows[0]?.schema_version), 4);
  } finally {
    await resources.pool.end();
  }
});
