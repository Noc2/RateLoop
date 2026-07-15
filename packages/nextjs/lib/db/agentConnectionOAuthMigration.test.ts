import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(join(process.cwd(), "drizzle", "0046_agent_connection_intents_oauth.sql"), "utf8");
const schema = readFileSync(join(process.cwd(), "lib", "db", "schema.ts"), "utf8");

test("one-message connection intents are bounded, single-use capabilities", () => {
  assert.match(migration, /CREATE TABLE "tokenless_agent_connection_intents"/);
  assert.match(migration, /"intent_id" text PRIMARY KEY NOT NULL/);
  assert.match(migration, /"claim_nonce_hash" text NOT NULL/);
  assert.match(migration, /"tokenless_agent_connection_intents_nonce_unique" UNIQUE \("claim_nonce_hash"\)/);
  assert.match(migration, /"claim_expires_at" = "created_at" \+ INTERVAL '30 minutes'/);
  assert.match(migration, /"hard_expires_at" = "created_at" \+ INTERVAL '45 minutes'/);
  assert.match(migration, /"claimed_token_family_id" text REFERENCES/);
  assert.match(migration, /"tokenless_agent_connection_intents_family_unique" UNIQUE \("claimed_token_family_id"\)/);
  assert.match(migration, /CREATE TABLE "tokenless_agent_connection_intent_events"/);
  assert.match(migration, /'issued','install_required','authorizing','approval_required','testing','connected'/);
  assert.match(migration, /'action_required','rejected','expired','cancelled'/);
});

test("OAuth artifacts are hash-only and retain exact authorization bindings", () => {
  for (const table of [
    "tokenless_agent_oauth_clients",
    "tokenless_agent_oauth_token_families",
    "tokenless_agent_oauth_authorization_codes",
    "tokenless_agent_oauth_refresh_tokens",
    "tokenless_agent_oauth_access_tokens",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.match(migration, /"client_secret_hash" text/);
  assert.match(migration, /"code_hash" text NOT NULL/);
  assert.match(migration, /"token_hash" text NOT NULL/g);
  assert.doesNotMatch(migration, /"(?:client_secret|authorization_code|access_token|refresh_token)" text/);
  assert.match(migration, /"redirect_uris_json" text NOT NULL/);
  assert.match(migration, /"redirect_uris_digest" text NOT NULL/);
  assert.match(migration, /"redirect_uri" text NOT NULL/);
  assert.match(migration, /"code_challenge_method" text NOT NULL DEFAULT 'S256'/);
  assert.match(migration, /"code_challenge_method" = 'S256'/);
  assert.match(migration, /"audience" text NOT NULL/g);
  assert.match(migration, /"resource" text NOT NULL/g);
  assert.match(migration, /"granted_scopes_json" text NOT NULL/g);
  assert.match(
    migration,
    /"tokenless_agent_oauth_refresh_tokens_generation_unique" UNIQUE \("token_family_id", "generation"\)/,
  );
});

test("OAuth integrations preserve legacy rows while enforcing one token family per integration", () => {
  for (const column of ["pairing_id", "publishing_policy_id", "publishing_policy_version", "api_key_id"]) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE "tokenless_agent_integrations" ALTER COLUMN "${column}" DROP NOT NULL`),
    );
  }
  assert.match(migration, /ALTER COLUMN "credential_expires_at" DROP NOT NULL/);
  assert.match(migration, /ADD COLUMN "token_family_id" text/);
  assert.match(migration, /"tokenless_agent_integrations_token_family_unique"\s+UNIQUE \("token_family_id"\)/);
  assert.match(migration, /ADD COLUMN "activation_mode" text NOT NULL DEFAULT 'legacy_pairing'/);
  assert.match(migration, /'preauthorized_safe','owner_approved','legacy_pairing'/);
  assert.match(migration, /ADD COLUMN "last_initialize_at" timestamp with time zone/);
  assert.match(migration, /ADD COLUMN "last_context_at" timestamp with time zone/);
  assert.match(migration, /ADD COLUMN "last_connection_test_at" timestamp with time zone/);
  assert.match(migration, /'connected','credential_rotated','oauth_token_rotated'/);
  assert.match(migration, /'connection_test_failed','scope_upgraded','revoked'/);
});

test("Drizzle schema exports the custom OAuth and connection-intent records", () => {
  assert.match(schema, /export const tokenlessAgentOauthClients = pgTable/);
  assert.match(schema, /export const tokenlessAgentOauthTokenFamilies = pgTable/);
  assert.match(schema, /export const tokenlessAgentOauthAuthorizationCodes = pgTable/);
  assert.match(schema, /export const tokenlessAgentOauthRefreshTokens = pgTable/);
  assert.match(schema, /export const tokenlessAgentOauthAccessTokens = pgTable/);
  assert.match(schema, /export const tokenlessAgentConnectionIntents = pgTable/);
  assert.match(schema, /export const tokenlessAgentConnectionIntentEvents = pgTable/);
});
