import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0068_feedback_bonus_awards.sql", import.meta.url), "utf8");

test("0068 freezes an optional USDC-only Feedback Bonus independently from the guaranteed bounty", () => {
  assert.match(migration, /ADD COLUMN "feedback_bonus_enabled" boolean NOT NULL DEFAULT false/u);
  assert.match(migration, /"feedback_bonus_pool_atomic" numeric\(78, 0\)/u);
  assert.match(migration, /"feedback_bonus_awarder_kind" text NOT NULL DEFAULT 'requester'/u);
  assert.match(migration, /"feedback_bonus_awarder_account" text/u);
  assert.match(migration, /"feedback_bonus_enabled" = false[\s\S]+"feedback_bonus_pool_atomic" IS NULL/u);
  assert.match(migration, /"feedback_bonus_enabled" = true[\s\S]+"feedback_bonus_pool_atomic" > 0/u);
  assert.match(migration, /"feedback_bonus_awarder_kind" = 'designated'/u);
  assert.match(migration, /char_length\("feedback_bonus_awarder_account"\) BETWEEN 1 AND 320/u);
  assert.match(migration, /"configuration_status" = 'action_required' AND "bounty_per_seat_atomic" IS NULL/u);
  assert.doesNotMatch(migration, /\{1,320\}/u);
  assert.match(migration, /"compensation_mode" = 'unpaid'/u);
});

test("0068 adds separate owner consent, eligible-feedback projection, idempotent intents, and immutable receipts", () => {
  assert.match(migration, /"feedback_bonus_maximum_atomic" numeric\(78, 0\) NOT NULL DEFAULT 0/u);
  assert.match(migration, /"maximum_consent_atomic" = "maximum_charge_atomic" \+ "feedback_bonus_maximum_atomic"/u);
  assert.match(migration, /CREATE TABLE "tokenless_feedback_bonus_pools"/u);
  assert.match(migration, /CREATE TABLE "tokenless_feedback_bonus_feedback"/u);
  assert.match(migration, /"eligibility_status" IN \('eligible','moderation_pending','ineligible'\)/u);
  assert.match(migration, /CREATE TABLE "tokenless_feedback_bonus_award_intents"/u);
  assert.match(migration, /UNIQUE \("workspace_id", "idempotency_key"\)/u);
  assert.match(migration, /UNIQUE \("workspace_id", "opportunity_id", "feedback_id"\)/u);
  assert.match(migration, /CREATE TABLE "tokenless_feedback_bonus_award_receipts"/u);
  assert.match(migration, /feedback bonus award receipts are append-only/u);
  assert.doesNotMatch(migration, /feedback_body" text/u);
});
