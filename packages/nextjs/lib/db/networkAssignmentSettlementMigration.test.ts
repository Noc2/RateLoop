import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DataType, newDb } from "pg-mem";

const migration = readFileSync(join(process.cwd(), "drizzle", "0140_network_assignment_settlement.sql"), "utf8");

test("network settlement migration binds vouchers to one exact assignment and round", () => {
  assert.match(migration, /ADD COLUMN "network_assignment_id"/u);
  assert.match(migration, /"network_operation_key" text/u);
  assert.match(migration, /"network_deployment_key" text/u);
  assert.match(
    migration,
    /UNIQUE \(\s*"network_assignment_id","network_operation_key","network_deployment_key",\s*"chain_id","panel_address","round_id"\s*\)/u,
  );
  assert.match(migration, /UNIQUE \("assignment_id","case_id"\)/u);
  assert.match(migration, /"selection_binding_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
  assert.doesNotMatch(migration, /"integrity_reviewer_lookup" text NOT NULL/u);
  assert.match(migration, /"integrity_reviewer_commitment" ~ '\^sha256:/u);
});

test("network settlement receipts are append-only and transitions are monotonic", () => {
  assert.match(migration, /network assignment settlement receipts are append-only/u);
  assert.match(migration, /network assignment settlement bindings are immutable/u);
  assert.match(migration, /network assignment settlement transitions are monotonic/u);
  assert.match(migration, /terminal network assignment settlements are immutable/u);
  assert.match(migration, /transition requires its append-only receipt/u);
  assert.match(migration, /lifecycle changes require a state transition/u);
});

test("response settlement references require matching evidence hashes", () => {
  assert.match(migration, /ALTER TABLE "tokenless_assurance_responses"/u);
  assert.match(migration, /\("settlement_reference" IS NULL AND "settlement_evidence_hash" IS NULL\)/u);
  assert.match(migration, /"settlement_evidence_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
});

test("response settlement evidence upgrade backfills legacy references before validating", () => {
  const statements = migration
    .split("--> statement-breakpoint")
    .map(value => value.trim())
    .filter(
      value =>
        value.startsWith('ALTER TABLE "tokenless_assurance_responses"') ||
        value.startsWith('UPDATE "tokenless_assurance_responses"'),
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
