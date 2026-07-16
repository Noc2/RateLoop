import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0074_assurance_attestation_jobs.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<Record<string, unknown>>;
};

test("0074 creates retry-safe, digest-only attestation jobs", () => {
  assert.match(migration, /CREATE TABLE "tokenless_assurance_attestation_jobs"/u);
  assert.match(migration, /UNIQUE\("workspace_id", "artifact_kind", "artifact_digest"\)/u);
  assert.match(migration, /"artifact_digest" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
  assert.match(migration, /'decision_packet', 'audit_export_head', 'coverage_export_head'/u);
  assert.match(migration, /"rekor_bundle_json" IS NOT NULL/u);
  assert.match(migration, /"artifact_kind" = 'decision_packet'.*"tsa_token_base64" IS NOT NULL/su);
  assert.doesNotMatch(migration, /workspace_name|tenant_metadata|reviewer/u);
});

test("0074 is the next ordered migration", () => {
  assert.deepEqual(
    journal.entries.find(entry => entry.idx === 74),
    {
      idx: 74,
      version: "7",
      when: 1784206800000,
      tag: "0074_assurance_attestation_jobs",
      breakpoints: true,
    },
  );
});
