import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DataType, newDb } from "pg-mem";
import { OWNER_APPROVED_AGENT_SCOPES } from "~~/lib/tokenless/humanReviewGrantScopes";
import { TOKENLESS_AGENT_SCOPES } from "~~/lib/tokenless/productCore";

const MIGRATION_BREAKPOINT = "--> statement-breakpoint";
const migration = readFileSync(join(process.cwd(), "drizzle", "0191_remove_quote_api_key_scope.sql"), "utf8");

const representativeScopeSets = [
  {
    keyId: "quote_only",
    before: ["quote:read"],
    after: [],
  },
  {
    keyId: "quote_first",
    before: ["quote:read", "result:read", "evaluation:read"],
    after: ["result:read", "evaluation:read"],
  },
  {
    keyId: "quote_middle",
    before: ["result:read", "quote:read", "payment:submit"],
    after: ["result:read", "payment:submit"],
  },
  {
    keyId: "quote_last",
    before: ["panel:publish", "result:read", "quote:read"],
    after: ["panel:publish", "result:read"],
  },
  {
    keyId: "current_only",
    before: ["telemetry:write", "review:decide"],
    after: ["telemetry:write", "review:decide"],
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
  database.public.registerOperator({
    operator: "-",
    left: DataType.jsonb,
    right: DataType.text,
    returns: DataType.jsonb,
    implementation: (left, right) => (Array.isArray(left) ? left.filter(scope => scope !== right) : left),
  });
  database.public.registerOperator({
    operator: "@>",
    left: DataType.jsonb,
    right: DataType.jsonb,
    returns: DataType.bool,
    implementation: (left, right) =>
      Array.isArray(left) && Array.isArray(right) && right.every(value => left.includes(value)),
  });
  database.public.none(`
    CREATE TABLE tokenless_workspace_api_keys (
      key_id text PRIMARY KEY,
      scopes_json text NOT NULL DEFAULT '[]'
    );
    CREATE TABLE tokenless_agent_integrations (
      integration_id text PRIMARY KEY,
      granted_scopes_json text NOT NULL DEFAULT '[]'
    )
  `);
  return database;
}

function applyMigration(database: ReturnType<typeof newDb>) {
  for (const statement of statements(migration)) database.public.none(statement);
}

test("quote-scope removal preserves every other workspace and integration grant in order", () => {
  const database = createLegacySchema();
  const values = representativeScopeSets
    .map(scopeSet => `('${scopeSet.keyId}', '${JSON.stringify(scopeSet.before)}')`)
    .join(",\n      ");
  database.public.none(`
    INSERT INTO tokenless_workspace_api_keys (key_id, scopes_json) VALUES
      ${values};
    INSERT INTO tokenless_agent_integrations (integration_id, granted_scopes_json) VALUES
      ${values}
  `);

  applyMigration(database);

  const workspaceRows = database.public.many(
    "SELECT key_id, scopes_json FROM tokenless_workspace_api_keys ORDER BY key_id",
  ) as Array<{ key_id: string; scopes_json: string }>;
  const integrationRows = database.public.many(
    "SELECT integration_id, granted_scopes_json FROM tokenless_agent_integrations ORDER BY integration_id",
  ) as Array<{ integration_id: string; granted_scopes_json: string }>;
  const workspaceById = new Map(workspaceRows.map(row => [row.key_id, JSON.parse(row.scopes_json) as string[]]));
  const integrationById = new Map(
    integrationRows.map(row => [row.integration_id, JSON.parse(row.granted_scopes_json) as string[]]),
  );

  for (const scopeSet of representativeScopeSets) {
    const workspaceScopes = workspaceById.get(scopeSet.keyId);
    const integrationScopes = integrationById.get(scopeSet.keyId);
    assert.deepEqual(workspaceScopes, [...scopeSet.after]);
    assert.deepEqual(integrationScopes, [...scopeSet.after]);
    assert.equal(
      workspaceScopes?.every(scope => TOKENLESS_AGENT_SCOPES.some(runtimeScope => runtimeScope === scope)),
      true,
    );
    assert.equal(
      integrationScopes?.every(scope => OWNER_APPROVED_AGENT_SCOPES.some(runtimeScope => runtimeScope === scope)),
      true,
    );
  }
});

test("quote scope is no longer grantable at either runtime boundary", () => {
  assert.equal(TOKENLESS_AGENT_SCOPES.includes("quote:read" as never), false);
  assert.equal(OWNER_APPROVED_AGENT_SCOPES.includes("quote:read" as never), false);
});
