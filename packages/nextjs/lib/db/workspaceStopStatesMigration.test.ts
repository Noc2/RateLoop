import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0093_workspace_stop_states.sql", import.meta.url), "utf8");

test("workspace stop states are workspace-bound with a required reason and paired release fields", () => {
  assert.match(migration, /CREATE TABLE "tokenless_workspace_stop_states"/u);
  assert.match(migration, /"workspace_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_workspaces"/u);
  assert.match(migration, /"status" IN \('engaged', 'released'\)/u);
  assert.match(migration, /char_length\("reason"\) BETWEEN 1 AND 2000/u);
  assert.match(migration, /"status" = 'released' AND "released_at" IS NOT NULL AND "released_by" IS NOT NULL/u);
  assert.doesNotMatch(migration, /payout|bounty|settlement/iu);
});
