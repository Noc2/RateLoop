import { tokenlessAgentExecutions, tokenlessAgentGenerationSpans } from "./schema";
import { getTableColumns } from "drizzle-orm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DataType, newDb } from "pg-mem";

const MIGRATION_BREAKPOINT = "--> statement-breakpoint";
const LEGACY_PROFILE_HASH = "sha256:63b18407425f52ad732101f9ffeb9c895782790554fce260de6e2cb1b93118ff";
const LEGACY_PROFILE_JSON = '{"schemaVersion":"rateloop.execution-profile.legacy"}';
const migration = readFileSync(join(process.cwd(), "drizzle", "0052_agent_execution_provenance.sql"), "utf8");

function applyMigration(database: ReturnType<typeof newDb>) {
  for (const statement of migration
    .split(MIGRATION_BREAKPOINT)
    .map(part => part.trim())
    .filter(Boolean)) {
    database.public.none(statement);
  }
}

function createLegacyDatabase() {
  const database = newDb();
  database.public.registerOperator({
    operator: "~",
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value, pattern) => new RegExp(pattern).test(value),
  });
  database.public.none(`
    CREATE TABLE tokenless_workspaces (
      workspace_id text PRIMARY KEY
    );
    CREATE TABLE tokenless_agent_versions (
      version_id text PRIMARY KEY,
      workspace_id text NOT NULL,
      agent_id text NOT NULL,
      UNIQUE (workspace_id, agent_id, version_id)
    );
    CREATE TABLE tokenless_agent_integrations (
      integration_id text PRIMARY KEY
    );
    CREATE TABLE tokenless_agent_evaluation_scopes (
      scope_id text PRIMARY KEY,
      agent_version_id text NOT NULL,
      policy_id text NOT NULL,
      policy_version integer NOT NULL,
      workflow_key text NOT NULL,
      risk_tier text NOT NULL,
      audience_policy_hash text NOT NULL,
      CONSTRAINT tokenless_agent_evaluation_scopes_partition_unique UNIQUE (
        agent_version_id, policy_id, policy_version, workflow_key, risk_tier, audience_policy_hash
      )
    );
    CREATE TABLE tokenless_agent_review_opportunities (
      opportunity_id text PRIMARY KEY
    );
    CREATE TABLE tokenless_agent_evaluation_observations (
      observation_id text PRIMARY KEY
    );
    INSERT INTO tokenless_workspaces (workspace_id) VALUES ('workspace_1');
    INSERT INTO tokenless_agent_versions (version_id, workspace_id, agent_id)
      VALUES ('version_1', 'workspace_1', 'agent_1');
    INSERT INTO tokenless_agent_evaluation_scopes
      (scope_id, agent_version_id, policy_id, policy_version, workflow_key, risk_tier, audience_policy_hash)
      VALUES ('scope_legacy', 'version_1', 'policy_1', 1, 'workflow_1', 'high', 'audience_1');
  `);
  return database;
}

test("0052 adds task-level execution and generation provenance without content payload columns", () => {
  assert.match(migration, /CREATE TABLE "tokenless_agent_executions"/);
  assert.match(migration, /CREATE TABLE "tokenless_agent_generation_spans"/);
  assert.match(migration, /UNIQUE \("workspace_id", "agent_id", "external_execution_id"\)/);
  assert.match(migration, /"integration_id" text REFERENCES "tokenless_agent_integrations"/);
  assert.doesNotMatch(migration, /"integration_id" text NOT NULL/);
  assert.match(migration, /"status" IN \('completed','failed'\)/);
  assert.match(migration, /"metadata_source" = 'host_reported'/);
  assert.match(migration, /"role" IN \('primary','subagent','supporting'\)/);
  assert.match(migration, /"model_call_count" >= 1/);
  assert.match(migration, /"cached_input_token_total" <= "input_token_total"/);
  assert.match(migration, /"reasoning_output_token_total" <= "output_token_total"/);
  assert.match(migration, /"cached_input_tokens" <= "input_tokens"/);
  assert.match(migration, /"reasoning_output_tokens" <= "output_tokens"/);
  assert.match(migration, /"time_to_first_output_ms" <= "duration_ms"/);
  assert.match(migration, /PRIMARY KEY \("execution_id", "span_id"\)/);
  assert.match(migration, /"manifest_commitment" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/);

  const provenanceTables = migration.slice(0, migration.indexOf('ALTER TABLE "tokenless_agent_evaluation_scopes"'));
  assert.doesNotMatch(
    provenanceTables,
    /"(?:prompt|messages?|input|output|reasoning|tool_input|tool_output)_(?:text|json|content|payload)"/,
  );

  const executionColumns = Object.keys(getTableColumns(tokenlessAgentExecutions));
  const spanColumns = Object.keys(getTableColumns(tokenlessAgentGenerationSpans));
  assert.equal(getTableColumns(tokenlessAgentExecutions).toolCallCount.notNull, false);
  for (const forbiddenColumn of [
    "promptText",
    "messagesJson",
    "inputText",
    "outputText",
    "reasoningText",
    "toolInputJson",
    "toolOutputJson",
  ]) {
    assert.ok(!executionColumns.includes(forbiddenColumn));
    assert.ok(!spanColumns.includes(forbiddenColumn));
  }
});

test("0052 preserves unknown clocks as null and partitions legacy evidence explicitly", () => {
  const database = createLegacyDatabase();
  applyMigration(database);

  assert.deepEqual(
    database.public.one(`
      SELECT execution_profile_hash, execution_profile_json
      FROM tokenless_agent_evaluation_scopes
      WHERE scope_id = 'scope_legacy'
    `),
    {
      execution_profile_hash: LEGACY_PROFILE_HASH,
      execution_profile_json: LEGACY_PROFILE_JSON,
    },
  );

  database.public.none(`
    INSERT INTO tokenless_agent_executions (
      execution_id, workspace_id, agent_id, agent_version_id, external_execution_id,
      status, model_call_count, primary_span_id, manifest_commitment,
      execution_profile_hash, execution_profile_json, created_at
    ) VALUES (
      'execution_1', 'workspace_1', 'agent_1', 'version_1', 'external_1',
      'completed', 1, 'span_1', 'sha256:${"a".repeat(64)}',
      'sha256:${"b".repeat(64)}', '{}', NOW()
    );
    INSERT INTO tokenless_agent_generation_spans (
      execution_id, span_id, role, provider, requested_model, metadata_source
    ) VALUES (
      'execution_1', 'span_1', 'primary', 'openai', 'sol', 'host_reported'
    );
  `);

  assert.deepEqual(
    database.public.one(`
      SELECT e.integration_id, e.started_at, e.completed_at, e.total_duration_ms, e.tool_call_count,
             s.duration_ms
      FROM tokenless_agent_executions e
      JOIN tokenless_agent_generation_spans s USING (execution_id)
      WHERE e.execution_id = 'execution_1'
    `),
    {
      completed_at: null,
      duration_ms: null,
      integration_id: null,
      started_at: null,
      tool_call_count: null,
      total_duration_ms: null,
    },
  );

  assert.throws(() =>
    database.public.none(`
      INSERT INTO tokenless_agent_executions (
        execution_id, workspace_id, agent_id, agent_version_id, external_execution_id,
        status, started_at, tool_call_count, model_call_count, primary_span_id,
        manifest_commitment, execution_profile_hash, execution_profile_json, created_at
      ) VALUES (
        'execution_bad_clock', 'workspace_1', 'agent_1', 'version_1', 'external_bad_clock',
        'completed', NOW(), 0, 1, 'span_bad', 'sha256:${"c".repeat(64)}',
        'sha256:${"d".repeat(64)}', '{}', NOW()
      )
    `),
  );

  database.public.none(`
    INSERT INTO tokenless_agent_evaluation_scopes
      (scope_id, agent_version_id, policy_id, policy_version, workflow_key, risk_tier,
       audience_policy_hash, execution_profile_hash, execution_profile_json)
    VALUES
      ('scope_new_profile', 'version_1', 'policy_1', 1, 'workflow_1', 'high',
       'audience_1', 'sha256:${"e".repeat(64)}', '{}')
  `);
  assert.throws(() =>
    database.public.none(`
      INSERT INTO tokenless_agent_evaluation_scopes
        (scope_id, agent_version_id, policy_id, policy_version, workflow_key, risk_tier,
         audience_policy_hash, execution_profile_hash, execution_profile_json)
      VALUES
        ('scope_duplicate', 'version_1', 'policy_1', 1, 'workflow_1', 'high',
         'audience_1', 'sha256:${"e".repeat(64)}', '{}')
    `),
  );
});
