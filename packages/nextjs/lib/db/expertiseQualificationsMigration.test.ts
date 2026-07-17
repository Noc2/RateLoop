import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0084_expertise_qualifications.sql", import.meta.url), "utf8");

test("expertise qualifications encode evidence and tenant scope without an identity profile", () => {
  assert.match(migration, /'expertise'/u);
  assert.match(migration, /"evidence_kind"/u);
  assert.match(migration, /"required_expertise_keys_json"/u);
  assert.match(migration, /owner_attested.*workspace_id/su);
  assert.match(migration, /platform_verified_credential.*workspace_id/su);
});
