import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0189_private_review_rationale_digests.sql", import.meta.url),
  "utf8",
);
const projection = readFileSync(new URL("../tokenless/directPrivateReviewEvidence.ts", import.meta.url), "utf8");

test("0189 restores and preserves direct-review rationale digests in assurance projections", () => {
  assert.match(projection, /rationale_ciphertext,rationale_key_ref,rationale_digest,qualification_keys_json/u);
  assert.match(projection, /const rationaleDigest = text\(response, "rationale_digest"\)/u);
  assert.match(projection, /encryptAssuranceRationale/u);
  assert.match(projection, /decryptWorkspaceOwnedRationale/u);
  assert.match(migration, /UPDATE "tokenless_assurance_responses" AS projected/u);
  assert.match(migration, /FROM "tokenless_private_review_responses" AS source/u);
  assert.match(migration, /opportunity\."workspace_id" = delivery\."workspace_id"/u);
  assert.match(migration, /projected\."run_id" = opportunity\."run_id"/u);
  assert.match(migration, /projected\."reviewer_key" = source\."reviewer_key"/u);
  assert.match(migration, /projected\."response_digest" = source\."response_commitment"/u);
  assert.match(migration, /projected\."rationale_ciphertext" = source\."rationale_ciphertext"/u);
  assert.match(migration, /projected\."rationale_key_ref" = source\."rationale_key_ref"/u);
  assert.match(migration, /projected\."rationale_digest" IS NULL/u);
  assert.match(migration, /source\."rationale_digest" IS NOT NULL/u);
  const updateClause = migration.match(/SET[\s\S]*?\nFROM/u)?.[0];
  assert.ok(updateClause);
  assert.doesNotMatch(updateClause, /rationale_ciphertext"\s*=|rationale_key_ref"\s*=/u);
});
