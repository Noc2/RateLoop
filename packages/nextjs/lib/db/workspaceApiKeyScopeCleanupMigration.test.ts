import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { newDb } from "pg-mem";
import { TOKENLESS_AGENT_SCOPES } from "~~/lib/tokenless/productCore";

const MIGRATION_BREAKPOINT = "--> statement-breakpoint";
const migration = readFileSync(join(process.cwd(), "drizzle", "0190_workspace_api_key_scope_cleanup.sql"), "utf8");

const representativeScopeSets = [
  {
    keyId: "legacy_full",
    before: ["quote:read", "panel:publish", "payment:submit", "result:read", "webhook:use"],
    after: ["quote:read", "panel:publish", "payment:submit", "result:read"],
  },
  {
    keyId: "current_read_scopes",
    before: ["result:read", "evaluation:read"],
    after: ["result:read", "evaluation:read"],
  },
  {
    keyId: "current_narrow",
    before: ["telemetry:write"],
    after: ["telemetry:write"],
  },
] as const;

function statements(sqlText: string) {
  return sqlText
    .split(MIGRATION_BREAKPOINT)
    .map(statement => statement.trim())
    .filter(Boolean);
}

function createLegacySchema() {
  const database = newDb();
  database.public.none(`
    CREATE TABLE tokenless_workspace_api_keys (
      key_id text PRIMARY KEY,
      scopes_json text NOT NULL
        DEFAULT '["quote:read","panel:publish","payment:submit","result:read","webhook:use"]'
    )
  `);
  return database;
}

function applyMigration(database: ReturnType<typeof newDb>) {
  for (const statement of statements(migration)) database.public.none(statement);
}

test("workspace API-key scope cleanup removes only the retired grant and keeps runtime-valid scopes", () => {
  const database = createLegacySchema();
  database.public.none(`
    INSERT INTO tokenless_workspace_api_keys (key_id, scopes_json) VALUES
      ${representativeScopeSets.map(scopeSet => `('${scopeSet.keyId}', '${JSON.stringify(scopeSet.before)}')`).join(",\n      ")}
  `);

  applyMigration(database);

  const rows = database.public.many(
    "SELECT key_id, scopes_json FROM tokenless_workspace_api_keys ORDER BY key_id",
  ) as Array<{ key_id: string; scopes_json: string }>;
  const migratedByKey = new Map(rows.map(row => [row.key_id, JSON.parse(row.scopes_json) as string[]]));

  for (const scopeSet of representativeScopeSets) {
    const migrated = migratedByKey.get(scopeSet.keyId);
    assert.deepEqual(migrated, [...scopeSet.after]);
    assert.equal(
      migrated?.every(scope => TOKENLESS_AGENT_SCOPES.some(runtimeScope => runtimeScope === scope)),
      true,
    );
  }

  assert.equal(TOKENLESS_AGENT_SCOPES.includes("webhook:use" as never), false);
  assert.deepEqual(
    migratedByKey
      .get("legacy_full")
      ?.filter(scope => ["evaluation:read", "review:decide", "telemetry:write"].includes(scope)),
    [],
  );
});

test("workspace API-key scope cleanup defaults new rows to no permissions", () => {
  const database = createLegacySchema();
  applyMigration(database);
  database.public.none("INSERT INTO tokenless_workspace_api_keys (key_id) VALUES ('new_default')");

  const row = database.public.one(
    "SELECT scopes_json FROM tokenless_workspace_api_keys WHERE key_id = 'new_default'",
  ) as { scopes_json: string };
  assert.deepEqual(JSON.parse(row.scopes_json), []);
});
