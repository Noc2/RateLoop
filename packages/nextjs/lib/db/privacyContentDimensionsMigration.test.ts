import { tokenlessAssuranceProjects } from "./humanAssuranceSchema";
import { getTableColumns } from "drizzle-orm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DataType, newDb } from "pg-mem";

const MIGRATION_BREAKPOINT = "--> statement-breakpoint";
const migration = readFileSync(join(process.cwd(), "drizzle", "0049_normalize_content_dimensions.sql"), "utf8");

function statements(sqlText: string) {
  return sqlText
    .split(MIGRATION_BREAKPOINT)
    .map(statement => statement.trim())
    .filter(Boolean);
}

function createLegacySchema() {
  const database = newDb();
  database.public.registerFunction({
    name: "jsonb_typeof",
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: value => (Array.isArray(value) ? "array" : value === null ? "null" : typeof value),
  });
  database.public.registerFunction({
    name: "jsonb_array_length",
    args: [DataType.jsonb],
    returns: DataType.integer,
    implementation: value => (Array.isArray(value) ? value.length : 0),
  });
  database.public.registerOperator({
    operator: "<@",
    left: DataType.jsonb,
    right: DataType.jsonb,
    returns: DataType.bool,
    implementation: (left, right) =>
      Array.isArray(left) && Array.isArray(right) && left.every(value => right.includes(value)),
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
    CREATE TABLE tokenless_workspaces (
      workspace_id text PRIMARY KEY,
      data_classification text NOT NULL DEFAULT 'confidential',
      home_region text NOT NULL DEFAULT 'eu',
      status text NOT NULL DEFAULT 'active'
    );
    CREATE TABLE tokenless_assurance_projects (
      project_id text PRIMARY KEY,
      workspace_id text NOT NULL,
      data_classification text NOT NULL,
      status text NOT NULL DEFAULT 'active'
    );
    CREATE TABLE tokenless_workspace_api_keys (
      key_id text PRIMARY KEY,
      workspace_id text NOT NULL,
      max_data_classification text NOT NULL DEFAULT 'confidential',
      revoked_at timestamp with time zone
    );
    CREATE TABLE tokenless_content_records (
      content_id text PRIMARY KEY,
      workspace_id text NOT NULL,
      data_classification text NOT NULL DEFAULT 'internal',
      moderation_status text NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE tokenless_question_records (
      question_id text PRIMARY KEY,
      data_classification text NOT NULL DEFAULT 'internal',
      visibility text NOT NULL DEFAULT 'private',
      moderation_status text NOT NULL DEFAULT 'pending',
      updated_at timestamp with time zone NOT NULL,
      CONSTRAINT tokenless_question_records_classification_check
        CHECK (data_classification IN ('public', 'synthetic', 'redacted', 'internal', 'confidential', 'restricted'))
    );
    CREATE TABLE tokenless_private_group_policy_versions (
      group_id text NOT NULL,
      version integer NOT NULL,
      data_classifications_json text NOT NULL,
      PRIMARY KEY (group_id, version)
    );
    CREATE TABLE tokenless_agent_publishing_policies (
      policy_id text PRIMARY KEY,
      workspace_id text NOT NULL,
      enabled boolean NOT NULL DEFAULT true,
      expires_at timestamp with time zone,
      allowed_data_classifications_json text NOT NULL DEFAULT '[]'
    );
  `);
  return database;
}

function applyMigration(database: ReturnType<typeof newDb>) {
  for (const statement of statements(migration)) database.public.none(statement);
}

function seedEveryLegacyClassification(database: ReturnType<typeof newDb>) {
  const classifications = ["public", "synthetic", "redacted", "internal", "confidential", "restricted", "regulated"];
  for (const classification of classifications) {
    database.public.none(`
      INSERT INTO tokenless_workspaces (workspace_id, data_classification)
      VALUES ('workspace_${classification}', '${classification}');
      INSERT INTO tokenless_assurance_projects (project_id, workspace_id, data_classification)
      VALUES ('project_${classification}', 'workspace_${classification}', '${classification}');
      INSERT INTO tokenless_workspace_api_keys (key_id, workspace_id, max_data_classification)
      VALUES ('key_${classification}', 'workspace_${classification}', '${classification}');
      INSERT INTO tokenless_content_records (content_id, workspace_id, data_classification)
      VALUES ('content_${classification}', 'workspace_${classification}', '${classification}');
    `);
    if (classification !== "regulated") {
      const visibility = ["public", "synthetic", "redacted"].includes(classification) ? "public" : "private";
      database.public.none(`
        INSERT INTO tokenless_question_records (question_id, data_classification, visibility, updated_at)
        VALUES ('question_${classification}', '${classification}', '${visibility}', NOW());
      `);
    }
  }
  database.public.none(`
    INSERT INTO tokenless_private_group_policy_versions (group_id, version, data_classifications_json) VALUES
      ('group_internal', 1, '["internal"]'),
      ('group_confidential', 1, '["internal","confidential"]'),
      ('group_restricted', 1, '["restricted","internal"]'),
      ('group_regulated', 1, '["regulated","confidential"]');
    INSERT INTO tokenless_agent_publishing_policies
      (policy_id, workspace_id, allowed_data_classifications_json) VALUES
      ('policy_none', 'workspace_internal', '[]'),
      ('policy_public', 'workspace_public', '["public"]'),
      ('policy_mixed', 'workspace_restricted', '["synthetic","internal","restricted"]'),
      ('policy_regulated', 'workspace_regulated', '["confidential","regulated"]');
  `);
}

test("0049 maps scalar content classifications into visibility, material kind, and private sensitivity", () => {
  const database = createLegacySchema();
  seedEveryLegacyClassification(database);
  applyMigration(database);

  for (const table of ["tokenless_assurance_projects", "tokenless_content_records"]) {
    assert.deepEqual(
      database.public.many(`
        SELECT data_classification, visibility, material_kind, private_sensitivity
        FROM ${table}
        ORDER BY data_classification
      `),
      [
        {
          data_classification: "confidential",
          visibility: "private",
          material_kind: null,
          private_sensitivity: "confidential",
        },
        {
          data_classification: "internal",
          visibility: "private",
          material_kind: null,
          private_sensitivity: "internal",
        },
        { data_classification: "public", visibility: "public", material_kind: "public", private_sensitivity: null },
        { data_classification: "redacted", visibility: "public", material_kind: "redacted", private_sensitivity: null },
        {
          data_classification: "regulated",
          visibility: "private",
          material_kind: null,
          private_sensitivity: "regulated",
        },
        {
          data_classification: "restricted",
          visibility: "private",
          material_kind: null,
          private_sensitivity: "restricted",
        },
        {
          data_classification: "synthetic",
          visibility: "public",
          material_kind: "synthetic",
          private_sensitivity: null,
        },
      ],
    );
  }

  assert.deepEqual(
    database.public.many(`
      SELECT data_classification, material_kind, private_sensitivity
      FROM tokenless_question_records
      ORDER BY data_classification
    `),
    [
      { data_classification: "confidential", material_kind: null, private_sensitivity: "confidential" },
      { data_classification: "internal", material_kind: null, private_sensitivity: "internal" },
      { data_classification: "public", material_kind: "public", private_sensitivity: null },
      { data_classification: "redacted", material_kind: "redacted", private_sensitivity: null },
      { data_classification: "restricted", material_kind: null, private_sensitivity: "restricted" },
      { data_classification: "synthetic", material_kind: "synthetic", private_sensitivity: null },
    ],
  );
});

test("0049 reduces legacy classification sets to public-lane permission and the highest private ceiling", () => {
  const database = createLegacySchema();
  seedEveryLegacyClassification(database);
  applyMigration(database);

  assert.deepEqual(
    database.public.many(`
      SELECT policy_id, allow_public_lane, max_private_sensitivity
      FROM tokenless_agent_publishing_policies
      ORDER BY policy_id
    `),
    [
      { policy_id: "policy_mixed", allow_public_lane: true, max_private_sensitivity: "restricted" },
      { policy_id: "policy_none", allow_public_lane: false, max_private_sensitivity: null },
      { policy_id: "policy_public", allow_public_lane: true, max_private_sensitivity: null },
      { policy_id: "policy_regulated", allow_public_lane: false, max_private_sensitivity: "regulated" },
    ],
  );
  assert.deepEqual(
    database.public.many(`
      SELECT group_id, max_private_sensitivity
      FROM tokenless_private_group_policy_versions
      ORDER BY group_id
    `),
    [
      { group_id: "group_confidential", max_private_sensitivity: "confidential" },
      { group_id: "group_internal", max_private_sensitivity: "internal" },
      { group_id: "group_regulated", max_private_sensitivity: "regulated" },
      { group_id: "group_restricted", max_private_sensitivity: "restricted" },
    ],
  );

  assert.deepEqual(
    database.public.many(`
      SELECT data_classification, max_private_sensitivity
      FROM tokenless_workspaces
      ORDER BY data_classification
    `),
    [
      { data_classification: "confidential", max_private_sensitivity: "confidential" },
      { data_classification: "internal", max_private_sensitivity: "internal" },
      { data_classification: "public", max_private_sensitivity: null },
      { data_classification: "redacted", max_private_sensitivity: null },
      { data_classification: "regulated", max_private_sensitivity: "regulated" },
      { data_classification: "restricted", max_private_sensitivity: "restricted" },
      { data_classification: "synthetic", max_private_sensitivity: null },
    ],
  );
  assert.deepEqual(
    database.public.many(`
      SELECT max_data_classification, allow_public_lane, max_private_sensitivity
      FROM tokenless_workspace_api_keys
      ORDER BY max_data_classification
    `),
    [
      { max_data_classification: "confidential", allow_public_lane: true, max_private_sensitivity: "confidential" },
      { max_data_classification: "internal", allow_public_lane: true, max_private_sensitivity: "internal" },
      { max_data_classification: "public", allow_public_lane: true, max_private_sensitivity: null },
      { max_data_classification: "redacted", allow_public_lane: true, max_private_sensitivity: null },
      { max_data_classification: "regulated", allow_public_lane: true, max_private_sensitivity: "regulated" },
      { max_data_classification: "restricted", allow_public_lane: true, max_private_sensitivity: "restricted" },
      { max_data_classification: "synthetic", allow_public_lane: true, max_private_sensitivity: null },
    ],
  );
});

test("0049 fails closed on unknown legacy scalar or JSON classifications", () => {
  const unknownScalar = createLegacySchema();
  unknownScalar.public.none(`
    INSERT INTO tokenless_content_records (content_id, workspace_id, data_classification)
    VALUES ('content_unknown', 'workspace_unknown', 'secret');
  `);
  assert.throws(() => applyMigration(unknownScalar));

  const unknownJson = createLegacySchema();
  unknownJson.public.none(`
    INSERT INTO tokenless_agent_publishing_policies
      (policy_id, workspace_id, allowed_data_classifications_json)
    VALUES ('policy_unknown', 'workspace_unknown', '["public","secret"]');
  `);
  assert.throws(() => applyMigration(unknownJson));
});

test("0049 constraints prevent crossing public material and private sensitivity dimensions", () => {
  const database = createLegacySchema();
  seedEveryLegacyClassification(database);
  applyMigration(database);

  assert.throws(() =>
    database.public.none(`
      UPDATE tokenless_content_records
      SET private_sensitivity = 'confidential'
      WHERE content_id = 'content_public'
    `),
  );
  assert.throws(() =>
    database.public.none(`
      UPDATE tokenless_content_records
      SET material_kind = 'synthetic'
      WHERE content_id = 'content_internal'
    `),
  );
  assert.throws(() =>
    database.public.none(`
      UPDATE tokenless_question_records
      SET visibility = 'private'
      WHERE question_id = 'question_public'
    `),
  );
});

test("0049 stays additive for a legacy question writer until the service cutover", () => {
  const database = createLegacySchema();
  applyMigration(database);

  database.public.none(`
    INSERT INTO tokenless_question_records
      (question_id, data_classification, visibility, updated_at)
    VALUES ('question_legacy_writer', 'internal', 'private', NOW())
  `);
  assert.deepEqual(
    database.public.one(`
      SELECT material_kind, private_sensitivity
      FROM tokenless_question_records
      WHERE question_id = 'question_legacy_writer'
    `),
    { material_kind: null, private_sensitivity: null },
  );
});

test("Drizzle project schema exposes the normalized content dimensions", () => {
  const columns = getTableColumns(tokenlessAssuranceProjects);
  assert.equal(columns.visibility.name, "visibility");
  assert.equal(columns.materialKind.name, "material_kind");
  assert.equal(columns.privateSensitivity.name, "private_sensitivity");
});
