import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0078_assurance_event_references.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0078 distinguishes decision packets from persisted gate-transition evidence", () => {
  assert.match(migration, /ADD COLUMN "evidence_reference_kind" text/u);
  assert.match(migration, /ADD COLUMN "evidence_reference_digest" text/u);
  assert.match(migration, /SET "evidence_reference_kind" = 'decision_packet'/u);
  assert.match(migration, /ALTER COLUMN "packet_hash" DROP NOT NULL/u);
  assert.match(migration, /"evidence_reference_kind" IN \('decision_packet', 'gate_transition'\)/u);
  assert.match(migration, /"evidence_reference_kind" = 'gate_transition' AND "packet_hash" IS NULL/u);
});

test("0078 is the next ordered migration journal entry", () => {
  assert.deepEqual(
    journal.entries.find(entry => entry.idx === 78),
    {
      idx: 78,
      version: "7",
      when: 1784221200000,
      tag: "0078_assurance_event_references",
      breakpoints: true,
    },
  );
});
