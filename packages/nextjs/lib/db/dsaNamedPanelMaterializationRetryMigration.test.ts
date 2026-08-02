import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DataType, newDb } from "pg-mem";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  DSA_NAMED_PANEL_MATERIALIZATION_COOLDOWN_EVERY_FAILURES,
  DSA_NAMED_PANEL_MATERIALIZATION_COOLDOWN_MS,
} from "~~/lib/tokenless/dsaNamedPanelMaterializationRetry";

const migrationUrl = new URL("../../drizzle/0187_dsa_named_panel_materialization_retries.sql", import.meta.url);

test("0187 persists bounded restart-safe materialization retry and cooldown state", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /CREATE TABLE "tokenless_dsa_named_panel_materialization_retries"/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id","epoch_id","unit_id"\)[\s\S]*REFERENCES "tokenless_dsa_named_panel_units"/u,
  );
  assert.match(migration, /"state"='retrying'/u);
  assert.match(migration, /"state"='cooldown'/u);
  assert.match(migration, /"state"='resolved'/u);
  assert.match(
    migration,
    new RegExp(`mod\\("failure_count",${DSA_NAMED_PANEL_MATERIALIZATION_COOLDOWN_EVERY_FAILURES}\\)=0`, "u"),
  );
  assert.match(
    migration,
    new RegExp(`interval '${DSA_NAMED_PANEL_MATERIALIZATION_COOLDOWN_MS / 60_000} minutes'`, "u"),
  );
  assert.match(migration, /"failure_code"='response_evidence_materialization_failed'/u);
  assert.match(migration, /materialization_retries_due_idx/u);
  assert.match(migration, /last_attempt_at" IS DISTINCT FROM transaction_timestamp\(\)/u);
  assert.match(migration, /NEW\."attempt_count"<>OLD\."attempt_count"\+1/u);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE/u);
  assert.doesNotMatch(migration, /"(?:error_message|exception|stack|principal_id|account_address)"\s/iu);
});

test("0187 retry state applies in the pg-mem service harness", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const memory = newDb();
  memory.public.registerFunction({
    name: "mod",
    args: [DataType.integer, DataType.integer],
    returns: DataType.integer,
    implementation: (left, right) => left % right,
  });
  memory.public.none(
    `CREATE TABLE tokenless_dsa_named_panel_units
       (workspace_id text NOT NULL,epoch_id text NOT NULL,unit_id text NOT NULL,
        PRIMARY KEY (workspace_id,epoch_id,unit_id))`,
  );
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map(value => value.trim())
    .filter(Boolean)) {
    if (/^(?:CREATE OR REPLACE FUNCTION|CREATE TRIGGER) tokenless_/u.test(statement)) continue;
    memory.public.none(statement);
  }
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  try {
    await pool.query("INSERT INTO tokenless_dsa_named_panel_units VALUES ('ws','epoch','unit')");
    const attemptedAt = new Date("2036-01-01T00:00:00.000Z");
    await pool.query(
      `INSERT INTO tokenless_dsa_named_panel_materialization_retries
       (workspace_id,epoch_id,unit_id,state,attempt_count,failure_count,failure_code,next_retry_at,
        last_attempt_at,resolved_at,updated_at)
       VALUES ('ws','epoch','unit','retrying',1,1,'response_evidence_materialization_failed',$1,$1,NULL,$1)`,
      [attemptedAt],
    );
    const stored = await pool.query(
      "SELECT state,attempt_count,failure_count,next_retry_at FROM tokenless_dsa_named_panel_materialization_retries",
    );
    assert.equal(stored.rows[0]?.state, "retrying");
    assert.equal(stored.rows[0]?.attempt_count, 1);
    assert.equal(stored.rows[0]?.failure_count, 1);
    assert.equal(new Date(stored.rows[0]?.next_retry_at).toISOString(), attemptedAt.toISOString());
  } finally {
    await pool.end();
  }
});

test("the complete in-memory journal applies through 0188", async () => {
  const resources = createMemoryDatabaseResources();
  try {
    const result = await resources.pool.query(
      `SELECT state,failure_count,next_retry_at
       FROM tokenless_dsa_named_panel_materialization_retries`,
    );
    assert.deepEqual(result.rows, []);
  } finally {
    await resources.pool.end();
  }
});
