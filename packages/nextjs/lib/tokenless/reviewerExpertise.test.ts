import assert from "node:assert/strict";
import { test } from "node:test";
import { __reviewerExpertiseTestUtils } from "~~/lib/tokenless/reviewerExpertise";
import { normalizeReviewerExpertiseKeys } from "~~/lib/tokenless/reviewerExpertiseVocabulary";

test("reviewer expertise uses a closed, unique vocabulary", () => {
  assert.deepEqual(normalizeReviewerExpertiseKeys(["legal:privacy-compliance", "code-review:typescript"]), [
    "code-review:typescript",
    "legal:privacy-compliance",
  ]);
  assert.throws(() => normalizeReviewerExpertiseKeys(["uncontrolled:key"]), /unsupported/u);
  assert.throws(() => normalizeReviewerExpertiseKeys(["code-review:typescript", "code-review:typescript"]), /unique/u);
});

test("expertise provenance ignores expired entries and can be safely unioned across duplicate cohorts", () => {
  const now = new Date("2026-07-17T00:00:00.000Z");
  const first = __reviewerExpertiseTestUtils.activeExpertiseKeysFromProvenance(
    JSON.stringify([
      { key: "expertise:code-review:typescript", value: true, expiresAt: "2027-01-01T00:00:00.000Z" },
      { key: "expertise:code-review:security", value: true, expiresAt: "2026-01-01T00:00:00.000Z" },
    ]),
    now,
  );
  const duplicateCohort = __reviewerExpertiseTestUtils.activeExpertiseKeysFromProvenance(
    JSON.stringify([{ key: "expertise:legal:privacy-compliance", value: true }]),
    now,
  );
  assert.deepEqual([...new Set([...first, ...duplicateCohort])].sort(), [
    "expertise:code-review:typescript",
    "expertise:legal:privacy-compliance",
  ]);
});
