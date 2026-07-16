import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0073_assurance_event_streaming.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0073 creates a workspace-scoped immutable event outbox and retry-safe delivery queue", () => {
  assert.match(migration, /CREATE TABLE "tokenless_assurance_event_outbox"/u);
  assert.match(migration, /"workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"/u);
  assert.match(migration, /UNIQUE\("workspace_id", "event_type", "source_event_id"\)/u);
  assert.match(migration, /"packet_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
  assert.match(migration, /"payload_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
  assert.match(migration, /"subject" ~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._:\/-\]\{0,199\}\$'/u);
  assert.match(migration, /CREATE TABLE "tokenless_assurance_event_deliveries"/u);
  assert.match(migration, /UNIQUE\("event_id", "endpoint_id"\)/u);
  assert.match(migration, /"state" IN \('pending', 'delivering', 'retry', 'delivered', 'dead'\)/u);
  assert.match(migration, /"state" = 'delivering' AND "lease_expires_at" IS NOT NULL/u);
});

test("0073 is the next ordered migration journal entry", () => {
  assert.deepEqual(
    journal.entries.find(entry => entry.idx === 73),
    {
      idx: 73,
      version: "7",
      when: 1784203200000,
      tag: "0073_assurance_event_streaming",
      breakpoints: true,
    },
  );
});
