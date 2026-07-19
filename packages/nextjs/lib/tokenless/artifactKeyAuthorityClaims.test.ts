import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const design = readFileSync(
  new URL("../../../../docs/tokenless-immutable-implementation-plan-2026-07.md", import.meta.url),
  "utf8",
);
const legalReference = readFileSync(
  new URL("../../../../docs/tokenless-legal-revenue-reference-2026-07.md", import.meta.url),
  "utf8",
);
const artifactBoundary = readFileSync(new URL("./ARTIFACT_PRIVACY.md", import.meta.url), "utf8");
const publicHowItWorks = readFileSync(new URL("../../public/docs/how-it-works.md", import.meta.url), "utf8");

function normalized(disclosure: string) {
  return disclosure.replace(/\s+/gu, " ");
}

test("artifact-key docs disclose tenant-scoped managed wrapping and workload authority", () => {
  for (const disclosure of [design, legalReference, artifactBoundary, publicHowItWorks].map(normalized)) {
    assert.match(disclosure, /Each (?:customer )?artifact (?:has|gets) (?:its own|a) random/iu);
    assert.match(disclosure, /workspace\/project-scoped|tenant-scoped/iu);
    assert.match(disclosure, /workload role/iu);
    assert.match(disclosure, /decrypt (?:that tenant's|the tenant's|that tenant’s) (?:customer )?artifacts/iu);
    assert.match(disclosure, /provision|inventory/iu);
    assert.match(disclosure, /release gate/iu);
  }
});

test("artifact-key claims do not generalize the tlock reveal-key property to customer artifacts", () => {
  assert.doesNotMatch(design, /operator never possesses a\s+rater spend key or universal decryption key/iu);
  assert.doesNotMatch(legalReference, /operator must not hold a universal decryption or spend key/iu);
  assert.match(design, /statement does not apply to the customer-artifact vault authority/iu);
  assert.match(legalReference, /statement does not describe the customer-artifact vault/iu);
  assert.match(
    normalized(artifactBoundary),
    /hosted operation must use the configured managed-KMS adapter and tenant-scoped alias template/isu,
  );
});
