import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(join(process.cwd(), "drizzle", "0038_agent_pairing_integrations.sql"), "utf8");

test("agent pairing migration keeps credentials hash-only and binds integrations exactly", () => {
  assert.match(migration, /CREATE TABLE "tokenless_agent_pairing_sessions"/);
  assert.match(migration, /"credential_hash" text NOT NULL/);
  assert.doesNotMatch(migration, /"credential" text/);
  assert.match(migration, /"expires_at" timestamp with time zone NOT NULL/);
  assert.match(migration, /CREATE TABLE "tokenless_agent_integrations"/);
  assert.match(migration, /"agent_version_id" text NOT NULL/);
  assert.match(migration, /"review_policy_id" text NOT NULL/);
  assert.match(migration, /"review_policy_version" integer NOT NULL/);
  assert.match(migration, /"publishing_policy_id" text NOT NULL/);
  assert.match(migration, /"publishing_policy_version" integer NOT NULL/);
  assert.match(migration, /"api_key_id" text NOT NULL/);
  assert.match(migration, /"enforcement_mode" IN \('host_enforced', 'advisory'\)/);
  assert.match(migration, /"credential_expires_at" timestamp with time zone NOT NULL/);
  assert.match(migration, /"last_seen_at" timestamp with time zone/);
  assert.match(migration, /"host_enforcement_evidence_reference" text/);
});

test("agent integration lifecycle remains auditable", () => {
  assert.match(migration, /CREATE TABLE "tokenless_agent_integration_events"/);
  assert.match(migration, /'approved', 'credential_rotated', 'revoked'/);
});
