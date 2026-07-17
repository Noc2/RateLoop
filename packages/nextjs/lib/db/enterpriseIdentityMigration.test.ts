import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0086_enterprise_identity.sql", import.meta.url), "utf8");

test("0086 installs the exact Better Auth SSO, SCIM, and admin fields", () => {
  assert.match(migration, /CREATE TABLE "tokenless_better_auth_sso_providers"/u);
  assert.match(migration, /"domain_verified" boolean DEFAULT false/u);
  assert.match(migration, /CREATE TABLE "tokenless_better_auth_scim_providers"/u);
  assert.match(migration, /"scim_token" text NOT NULL/u);
  assert.match(migration, /ADD COLUMN "banned" boolean DEFAULT false/u);
  assert.match(migration, /ADD COLUMN "impersonated_by" text/u);
  assert.match(migration, /ADD COLUMN "authentication_method" text/u);
});

test("0086 keeps workspace authorization in RateLoop-owned mappings", () => {
  assert.match(migration, /CREATE TABLE "tokenless_enterprise_identity_providers"/u);
  assert.match(migration, /UNIQUE \("workspace_id", "provider_id"\)/u);
  assert.match(migration, /CREATE UNIQUE INDEX "tokenless_enterprise_identity_provider_domain_unique"/u);
  assert.match(migration, /FOREIGN KEY \("provider_id", "domain"\)/u);
  assert.match(migration, /CREATE TABLE "tokenless_enterprise_managed_members"/u);
  assert.match(migration, /"source" IN \('sso','scim'\)/u);
  assert.match(migration, /tokenless_guard_scim_single_workspace/u);
  assert.doesNotMatch(migration, /CREATE TABLE "organization"|CREATE TABLE "member"/u);
});

test("0086 reserves identity success events before irreversible provider mutations", () => {
  assert.match(migration, /"delivery_state" IN \('reserved','pending','delivered'\)/u);
  assert.match(migration, /"delivery_state" IN \('reserved','pending'\) AND "delivered_at" IS NULL/u);
});
