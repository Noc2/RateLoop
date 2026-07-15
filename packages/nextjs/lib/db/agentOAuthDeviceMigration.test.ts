import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(join(process.cwd(), "drizzle", "0047_agent_oauth_device_authorization.sql"), "utf8");
const schema = readFileSync(join(process.cwd(), "lib", "db", "schema.ts"), "utf8");

test("device authorization stores only credential hashes and exact OAuth bindings", () => {
  assert.match(migration, /CREATE TABLE "tokenless_agent_oauth_device_authorizations"/);
  assert.match(migration, /"device_code_hash" text NOT NULL/);
  assert.match(migration, /"user_code_hash" text NOT NULL/);
  assert.doesNotMatch(migration, /"(?:device_code|user_code)" text/);
  assert.match(migration, /"client_id" text NOT NULL REFERENCES "tokenless_agent_oauth_clients"/);
  assert.match(migration, /"audience" text NOT NULL/);
  assert.match(migration, /"resource" text NOT NULL/);
  assert.match(migration, /"requested_scopes_json" text NOT NULL/);
  assert.match(migration, /"token_family_id" text REFERENCES "tokenless_agent_oauth_token_families"/);
});

test("device authorization has a bounded lifetime and durable polling state", () => {
  assert.match(migration, /"expires_at" = "created_at" \+ INTERVAL '10 minutes'/);
  assert.match(migration, /"interval_seconds" >= 5 AND "interval_seconds" <= 60/);
  assert.match(migration, /"poll_count" >= 0/);
  assert.match(migration, /'pending','approved','denied','consumed','expired'/);
  assert.match(migration, /"approved_by_principal_id" text REFERENCES "tokenless_principals"/);
  assert.match(migration, /"tokenless_agent_oauth_device_authorizations_family_unique" UNIQUE \("token_family_id"\)/);
});

test("Drizzle schema exports device authorization records", () => {
  assert.match(schema, /export const tokenlessAgentOauthDeviceAuthorizations = pgTable/);
  assert.match(schema, /export type TokenlessAgentOauthDeviceAuthorization/);
});
