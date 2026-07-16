import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0072_assurance_openmetrics_credentials.sql", import.meta.url),
  "utf8",
);
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0072 stores workspace-bound OpenMetrics credentials only as SHA-256 hashes", () => {
  assert.match(migration, /CREATE TABLE "tokenless_assurance_metrics_credentials"/u);
  assert.match(migration, /"workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"/u);
  assert.match(migration, /"token_hash" text NOT NULL UNIQUE/u);
  assert.match(migration, /\^sha256:\[0-9a-f\]\{64\}\$/u);
  assert.match(migration, /"status" IN \('active', 'rotated', 'revoked'\)/u);
  assert.match(migration, /"rotated_from_credential_id" text REFERENCES/u);
  assert.doesNotMatch(migration, /"(?:token|secret|plaintext)" text/iu);
});

test("0072 is the next ordered migration journal entry", () => {
  assert.deepEqual(
    journal.entries.find(entry => entry.idx === 72),
    {
      idx: 72,
      version: "7",
      when: 1784199600000,
      tag: "0072_assurance_openmetrics_credentials",
      breakpoints: true,
    },
  );
});
