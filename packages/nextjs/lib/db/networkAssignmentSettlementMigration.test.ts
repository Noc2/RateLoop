import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DataType, newDb } from "pg-mem";

const baseMigration = readFileSync(join(process.cwd(), "drizzle", "0140_network_assignment_settlement.sql"), "utf8");
const hardeningMigration = readFileSync(
  join(process.cwd(), "drizzle", "0142_network_settlement_hardening.sql"),
  "utf8",
);
const journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("forward hardening binds vouchers to one exact assignment and round", () => {
  assert.match(baseMigration, /ADD COLUMN "network_assignment_id"/u);
  assert.match(baseMigration, /UNIQUE \("network_assignment_id","round_id"\)/u);
  assert.match(baseMigration, /"integrity_reviewer_lookup" text NOT NULL/u);
  assert.match(hardeningMigration, /"network_operation_key" text/u);
  assert.match(hardeningMigration, /"network_deployment_key" text/u);
  assert.match(hardeningMigration, /FROM "tokenless_network_assignment_settlements" settlement/u);
  assert.match(
    hardeningMigration,
    /UNIQUE \(\s*"network_assignment_id","network_operation_key","network_deployment_key",\s*"chain_id","panel_address","round_id"\s*\)/u,
  );
  assert.match(baseMigration, /UNIQUE \("assignment_id","case_id"\)/u);
  assert.match(baseMigration, /"selection_binding_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
  assert.match(hardeningMigration, /"integrity_reviewer_commitment" ~ '\^sha256:/u);
  assert.match(hardeningMigration, /DROP COLUMN "integrity_reviewer_lookup"/u);
});

test("network settlement receipts are append-only and transitions are monotonic", () => {
  assert.match(baseMigration, /network assignment settlement receipts are append-only/u);
  assert.match(hardeningMigration, /network assignment settlement bindings are immutable/u);
  assert.match(hardeningMigration, /network assignment settlement transitions are monotonic/u);
  assert.match(hardeningMigration, /terminal network assignment settlements are immutable/u);
  assert.match(hardeningMigration, /transition requires its append-only receipt/u);
  assert.match(hardeningMigration, /lifecycle changes require a state transition/u);
});

test("response settlement references require matching evidence hashes", () => {
  assert.match(baseMigration, /ALTER TABLE "tokenless_assurance_responses"/u);
  assert.match(baseMigration, /\("settlement_reference" IS NULL AND "settlement_evidence_hash" IS NULL\)/u);
  assert.match(baseMigration, /"settlement_evidence_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
});

test("the forward migration is journaled after the privacy worker migration", () => {
  const privacy = journal.entries.findIndex(value => value.idx === 141);
  const hardening = journal.entries.findIndex(value => value.idx === 142);
  assert.notEqual(privacy, -1);
  assert.equal(hardening, privacy + 1);
  assert.equal(journal.entries[hardening]?.tag, "0142_network_settlement_hardening");
});

test("response settlement evidence upgrade backfills legacy references before validating", () => {
  assert.match(baseMigration, /Narrow deployability exception/u);
  const statements = baseMigration
    .split("--> statement-breakpoint")
    .map(value => value.trim())
    .filter(
      value =>
        value.startsWith('ALTER TABLE "tokenless_assurance_responses"') ||
        value.includes('UPDATE "tokenless_assurance_responses"'),
    );
  assert.equal(statements.length, 3);
  const memory = newDb();
  memory.public.registerFunction({
    name: "convert_to",
    args: [DataType.text, DataType.text],
    returns: DataType.bytea,
    implementation: (value: string) => Buffer.from(value, "utf8"),
  });
  memory.public.registerFunction({
    name: "digest",
    args: [DataType.bytea, DataType.text],
    returns: DataType.bytea,
    implementation: (value: Buffer) => createHash("sha256").update(value).digest(),
  });
  memory.public.registerFunction({
    name: "encode",
    args: [DataType.bytea, DataType.text],
    returns: DataType.text,
    implementation: (value: Buffer) => value.toString("hex"),
  });
  memory.public.registerFunction({
    name: "char_length",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (value: string) => value.length,
  });
  memory.public.none(
    `CREATE TABLE tokenless_assurance_responses (
       response_id text PRIMARY KEY,
       settlement_reference text
     )`,
  );
  memory.public.none(
    "INSERT INTO tokenless_assurance_responses (response_id,settlement_reference) VALUES ('legacy','chain:legacy:42')",
  );
  for (const statement of statements.slice(0, 2)) memory.public.none(statement);
  const upgraded = memory.public.one(
    "SELECT settlement_reference,settlement_evidence_hash FROM tokenless_assurance_responses WHERE response_id='legacy'",
  ) as Record<string, unknown>;
  assert.equal(upgraded.settlement_reference, "chain:legacy:42");
  assert.match(String(upgraded.settlement_evidence_hash), /^sha256:[0-9a-f]{64}$/u);
  assert.match(statements[2]!, /ADD CONSTRAINT "tokenless_assurance_responses_settlement_evidence_check"/u);
});
