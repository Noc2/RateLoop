import { getTableColumns } from "drizzle-orm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DataType, newDb } from "pg-mem";
import { tokenlessAgentReviewRequestProfiles } from "~~/lib/db/schema";

const migration = readFileSync(join(process.cwd(), "drizzle", "0055_agent_review_request_profiles.sql"), "utf8");

function migratedDatabase() {
  const database = newDb();
  database.public.registerOperator({
    operator: "~",
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value, pattern) => new RegExp(pattern).test(value),
  });
  database.public.none(`
    CREATE TABLE tokenless_agent_versions (
      workspace_id text NOT NULL,
      agent_id text NOT NULL,
      version_id text NOT NULL,
      UNIQUE (workspace_id, agent_id, version_id)
    );
    CREATE TABLE tokenless_private_groups (
      group_id text PRIMARY KEY,
      workspace_id text NOT NULL
    );
    CREATE TABLE tokenless_private_group_policy_versions (
      group_id text NOT NULL,
      version integer NOT NULL,
      policy_hash text NOT NULL,
      PRIMARY KEY (group_id, version),
      UNIQUE (group_id, policy_hash)
    );
  `);
  const pgMemMigration = migration.replaceAll(" USING btree", "");
  for (const statement of pgMemMigration.split("--> statement-breakpoint")) {
    if (statement.trim()) database.public.none(statement);
  }
  database.public.none(`
    INSERT INTO tokenless_agent_versions (workspace_id, agent_id, version_id)
    VALUES ('workspace_a', 'agent_a', 'version_a');
    INSERT INTO tokenless_private_groups (group_id, workspace_id)
    VALUES ('group_a', 'workspace_a');
    INSERT INTO tokenless_private_group_policy_versions (group_id, version, policy_hash)
    VALUES ('group_a', 1, 'sha256:${"a".repeat(64)}');
  `);
  return database;
}

function insertProfile(
  database: ReturnType<typeof newDb>,
  overrides: Partial<Record<string, string | number | null>> = {},
) {
  const value = {
    profile_id: "profile_a",
    version: 1,
    workspace_id: "workspace_a",
    agent_id: "agent_a",
    agent_version_id: "version_a",
    criterion: "Is this response correct?",
    positive_label: "Correct",
    negative_label: "Incorrect",
    rationale_mode: "optional",
    audience: "private_invited",
    content_boundary: "private_workspace",
    private_sensitivity: "confidential",
    private_group_id: "group_a",
    private_group_policy_version: 1,
    private_group_policy_hash: `sha256:${"a".repeat(64)}`,
    response_window_seconds: 1200,
    panel_size: 1,
    compensation_mode: "unpaid",
    bounty_per_seat_atomic: null,
    configuration_status: "ready",
    profile_hash: `sha256:${"b".repeat(64)}`,
    created_by: "owner_a",
    created_at: "2026-07-16T12:00:00.000Z",
    approved_by: "owner_a",
    approved_at: "2026-07-16T12:00:00.000Z",
    ...overrides,
  };
  const columns = Object.keys(value);
  const sqlValue = (entry: unknown) => {
    if (entry === null) return "NULL";
    if (typeof entry === "number") return String(entry);
    return `'${String(entry).replaceAll("'", "''")}'`;
  };
  database.public.none(
    `INSERT INTO tokenless_agent_review_request_profiles (${columns.join(", ")}) VALUES (${columns
      .map(column => sqlValue(value[column as keyof typeof value]))
      .join(", ")})`,
  );
}

test("0055 creates immutable versioned request profiles with exact provenance", () => {
  assert.match(migration, /CREATE TABLE "tokenless_agent_review_request_profiles"/);
  assert.match(migration, /PRIMARY KEY \("profile_id", "version"\)/);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "agent_id", "agent_version_id"\)\s+REFERENCES "tokenless_agent_versions" \("workspace_id", "agent_id", "version_id"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("private_group_id", "private_group_policy_version", "private_group_policy_hash"\)\s+REFERENCES "tokenless_private_group_policy_versions" \("group_id", "version", "policy_hash"\)/,
  );
  assert.match(migration, /UNIQUE \("group_id", "version", "policy_hash"\)/);
  assert.match(migration, /UNIQUE \("workspace_id", "profile_hash"\)/);
  assert.match(migration, /WHERE "superseded_at" IS NULL/);
});

test("0055 freezes the question, audience, timing, panel, and economics dimensions", () => {
  for (const column of [
    "criterion",
    "positive_label",
    "negative_label",
    "rationale_mode",
    "audience",
    "content_boundary",
    "private_sensitivity",
    "response_window_seconds",
    "panel_size",
    "compensation_mode",
    "bounty_per_seat_atomic",
    "configuration_status",
  ]) {
    assert.match(migration, new RegExp(`"${column}"`));
  }
  assert.match(migration, /"rationale_mode" IN \('off', 'optional', 'required'\)/);
  assert.match(migration, /"response_window_seconds" BETWEEN 1200 AND 86400/);
  assert.match(migration, /"criterion" ~ '\^\.\{1,500\}\$'/);
  assert.match(migration, /"positive_label" ~ '\^\.\{1,40\}\$'/);
  assert.match(migration, /"negative_label" ~ '\^\.\{1,40\}\$'/);
  assert.match(migration, /"panel_size" BETWEEN 1 AND 100/);
  assert.match(migration, /"configuration_status" IN \('ready', 'action_required'\)/);
  assert.match(migration, /"profile_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/);
});

test("0055 fails closed for ready public, hybrid, and private compensation profiles", () => {
  const readyCheck = migration.slice(
    migration.indexOf('CONSTRAINT "tokenless_agent_review_request_profiles_ready_check"'),
    migration.indexOf('CONSTRAINT "tokenless_agent_review_request_profiles_hash_check"'),
  );
  assert.match(readyCheck, /"audience" = 'public_network'/);
  assert.match(readyCheck, /"audience" = 'hybrid'/);
  assert.match(readyCheck, /"content_boundary" = 'public_or_test'/);
  assert.match(readyCheck, /"compensation_mode" = 'usdc'/);
  assert.match(readyCheck, /"bounty_per_seat_atomic" IS NOT NULL/);
  assert.match(readyCheck, /"bounty_per_seat_atomic" > 0/);
  assert.match(readyCheck, /"panel_size" >= 3/);
  assert.match(readyCheck, /"audience" = 'private_invited'/);
  assert.match(readyCheck, /"compensation_mode" = 'unpaid' AND "bounty_per_seat_atomic" IS NULL/);
  assert.match(readyCheck, /"private_group_id" IS NOT NULL/);
});

test("Drizzle exposes every persisted request-profile field", () => {
  const columns = getTableColumns(tokenlessAgentReviewRequestProfiles);
  assert.equal(columns.profileId.name, "profile_id");
  assert.equal(columns.agentVersionId.name, "agent_version_id");
  assert.equal(columns.positiveLabel.name, "positive_label");
  assert.equal(columns.negativeLabel.name, "negative_label");
  assert.equal(columns.privateGroupPolicyHash.name, "private_group_policy_hash");
  assert.equal(columns.responseWindowSeconds.name, "response_window_seconds");
  assert.equal(columns.bountyPerSeatAtomic.name, "bounty_per_seat_atomic");
  assert.equal(columns.profileHash.name, "profile_hash");
  assert.equal(columns.approvedAt.name, "approved_at");
  assert.equal(columns.supersededAt.name, "superseded_at");
});

test("0055 accepts the 20-minute floor and rejects incomplete private tuples and unpaid bounties", () => {
  insertProfile(migratedDatabase());

  assert.throws(() =>
    insertProfile(migratedDatabase(), {
      profile_id: "profile_short",
      profile_hash: `sha256:${"c".repeat(64)}`,
      response_window_seconds: 1199,
    }),
  );
  assert.throws(() =>
    insertProfile(migratedDatabase(), {
      profile_id: "profile_group",
      profile_hash: `sha256:${"d".repeat(64)}`,
      private_group_policy_hash: null,
    }),
  );
  assert.throws(() =>
    insertProfile(migratedDatabase(), {
      profile_id: "profile_unpaid",
      profile_hash: `sha256:${"e".repeat(64)}`,
      bounty_per_seat_atomic: 1,
    }),
  );
});

test("0055 requires a paid three-person public panel before a profile can be ready", () => {
  const readyPublic = {
    profile_id: "profile_public",
    profile_hash: `sha256:${"f".repeat(64)}`,
    audience: "public_network",
    content_boundary: "public_or_test",
    private_sensitivity: null,
    private_group_id: null,
    private_group_policy_version: null,
    private_group_policy_hash: null,
    panel_size: 3,
    compensation_mode: "usdc",
    bounty_per_seat_atomic: 1,
  };
  insertProfile(migratedDatabase(), readyPublic);
  assert.throws(() => insertProfile(migratedDatabase(), { ...readyPublic, panel_size: 2 }));
  assert.throws(() => insertProfile(migratedDatabase(), { ...readyPublic, bounty_per_seat_atomic: null }));

  insertProfile(migratedDatabase(), {
    ...readyPublic,
    profile_id: "profile_public_draft",
    profile_hash: `sha256:${"0".repeat(64)}`,
    configuration_status: "action_required",
    compensation_mode: "unpaid",
    bounty_per_seat_atomic: null,
    panel_size: 1,
    approved_by: null,
    approved_at: null,
  });
});
