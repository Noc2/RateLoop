import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0069_feedback_bonus_body_resolution.sql", import.meta.url),
  "utf8",
);

test("private Feedback Bonus bodies retain the rationale digest required by the existing vault AAD", () => {
  assert.match(migration, /ALTER TABLE "tokenless_assurance_responses"/u);
  assert.match(migration, /ADD COLUMN "rationale_digest" text/u);
  assert.match(migration, /\^sha256:\[0-9a-f\]\{64\}\$/u);
  assert.doesNotMatch(migration, /rationale" text|feedback_body" text/u);
});
