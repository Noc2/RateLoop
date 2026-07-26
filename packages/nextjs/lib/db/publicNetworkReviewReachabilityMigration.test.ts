import { createMemoryDatabaseResources } from "./testing/testMemory";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0145_public_network_review_reachability.sql", import.meta.url),
  "utf8",
);
const journal = readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8");

test("0145 journals the exact public-network reachability graph", () => {
  assert.match(journal, /"idx": 145[\s\S]*"tag": "0145_public_network_review_reachability"/u);
  assert.match(migration, /CREATE TABLE "tokenless_public_network_review_bindings"/u);
  assert.match(migration, /UNIQUE \("project_id","suite_id","version"\)/u);
  assert.match(migration, /UNIQUE \("workspace_id","integration_id"\)/u);
  assert.match(migration, /ADD COLUMN "network_managed" boolean DEFAULT false NOT NULL/u);
});

test("0145 permits only pristine foundation inserts and exact adjacent transitions", () => {
  assert.match(migration, /TG_OP = 'INSERT'/u);
  assert.match(migration, /NEW\.state <> 'foundation_preparing'/u);
  assert.match(migration, /public network review bindings must start at foundation_preparing/u);
  assert.match(migration, /OLD\.state = 'foundation_preparing' AND NEW\.state = 'foundation_ready'/u);
  assert.match(migration, /OLD\.state = 'foundation_ready' AND NEW\.state = 'ask_bound'/u);
  assert.match(migration, /OLD\.state = 'ask_bound' AND NEW\.state = 'round_bound'/u);
  assert.match(migration, /OLD\.state = 'round_bound' AND NEW\.state = 'audience_ready'/u);
});

test("0145 makes terminal rows and exact round identity immutable", () => {
  assert.match(migration, /OLD\.state IN \('audience_ready','abandoned','dead'\)/u);
  assert.match(migration, /terminal public network review bindings are immutable/u);
  assert.match(migration, /public network confirmed round identity is immutable/u);
  assert.match(migration, /public network review worker attempts are monotonic/u);
  assert.match(migration, /public network review identity is immutable/u);
  assert.match(migration, /"round_terms_hash" IS NOT NULL[\s\S]*"maximum_commits" IS NOT NULL/u);
});

test("the memory database applies the journal through public-network reachability", async () => {
  const resources = createMemoryDatabaseResources();
  try {
    const bindingTable = await resources.pool.query(
      "SELECT binding_id,state FROM tokenless_public_network_review_bindings LIMIT 0",
    );
    const membershipColumn = await resources.pool.query(
      "SELECT network_managed FROM tokenless_assurance_cohort_reviewers LIMIT 0",
    );
    assert.deepEqual(bindingTable.rows, []);
    assert.deepEqual(membershipColumn.rows, []);
  } finally {
    await resources.pool.end();
  }
});
