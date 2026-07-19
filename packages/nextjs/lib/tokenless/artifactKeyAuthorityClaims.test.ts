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

test("artifact-key docs disclose the shared operator wrapping authority", () => {
  for (const disclosure of [design, legalReference, artifactBoundary, publicHowItWorks].map(normalized)) {
    assert.match(disclosure, /Each (?:customer )?artifact (?:has|gets) (?:its own|a) random/iu);
    assert.match(disclosure, /shared (?:by|across) tenant artifacts|shared across tenants/iu);
    assert.match(disclosure, /operator/iu);
    assert.match(disclosure, /decrypt every customer artifact|decrypt customer artifacts|decrypt those artifacts/iu);
    assert.match(disclosure, /per-tenant or per-project|per-project or per-tenant/iu);
    assert.match(disclosure, /not (?:yet )?(?:implemented|a deployed property)/iu);
  }
});

test("artifact-key claims do not generalize the tlock reveal-key property to customer artifacts", () => {
  assert.doesNotMatch(design, /operator never possesses a\s+rater spend key or universal decryption key/iu);
  assert.doesNotMatch(legalReference, /operator must not hold a universal decryption or spend key/iu);
  assert.match(design, /statement does not apply to the customer-artifact vault authority/iu);
  assert.match(legalReference, /statement does not describe the customer-artifact vault/iu);
  assert.match(
    artifactBoundary,
    /Moving the same shared wrapping authority into KMS.*does not create tenant key separation/isu,
  );
});
