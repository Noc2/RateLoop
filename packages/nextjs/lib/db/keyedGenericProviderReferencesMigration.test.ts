import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0112_key_generic_provider_references.sql", import.meta.url),
  "utf8",
);

test("0112 revokes dictionary-matchable generic identity references until keyed re-verification", () => {
  assert.match(migration, /UPDATE "tokenless_assurance_assertions"/u);
  assert.match(migration, /UPDATE "tokenless_provider_subject_bindings"/u);
  assert.match(migration, /"provider_namespace" = 'legacy:v2'/u);
  assert.match(migration, /"provider_assertion_reference_scheme" = 'legacy-sha256-v2'/u);
  assert.match(migration, /"subject_reference_scheme" = 'legacy-sha256-v2'/u);
  assert.match(migration, /SET "status" = 'revoked'/u);
});
