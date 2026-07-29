import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY,
  type PublicNetworkLegalResidenceEvidence,
  evaluatePublicNetworkLegalResidence,
  isFrozenPublicNetworkLegalResidence,
} from "~~/lib/tokenless/publicNetworkLegalResidence";

const NOW = new Date("2026-07-29T12:00:00.000Z");

function evidence(
  countryCode = "DE",
  overrides: Partial<PublicNetworkLegalResidenceEvidence> = {},
): PublicNetworkLegalResidenceEvidence {
  return {
    raterId: "rater_residence_01",
    scopeId: "scope_residence_01",
    verifiedResidenceCountry: countryCode,
    declaredResidenceCountry: countryCode,
    taxResidenceCountry: countryCode,
    residenceTaxStatus: "consistent",
    providerAssertionId: "assertion_residence_01",
    providerVerifiedResidenceCountry: countryCode,
    providerEvidenceVerifiedAt: new Date(NOW.getTime() - 60_000),
    providerEvidenceExpiresAt: new Date(NOW.getTime() + 86_400_000),
    dac7Status: "complete",
    dac7RecordId: `dac7_${"1".repeat(32)}`,
    dac7RecordRaterId: "rater_residence_01",
    dac7SourceScopeReference: "scope_residence_01",
    dac7ReviewerSource: "rateloop_network",
    dac7WorkspaceReference: null,
    dac7CollectedAt: new Date(NOW.getTime() - 86_400_000),
    dac7RetainedUntil: new Date(NOW.getTime() + 365 * 86_400_000),
    ...overrides,
  };
}

test("the frozen public-network predicate includes the 27 EU states plus the three EEA EFTA states", () => {
  assert.equal(PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.supportedCountryCodes.length, 30);
  for (const country of ["DE", "IE", "NO", "IS", "LI"]) {
    assert.ok(evaluatePublicNetworkLegalResidence(evidence(country), NOW), country);
  }
  for (const unsupported of ["CH", "GB", "US"]) {
    assert.equal(evaluatePublicNetworkLegalResidence(evidence(unsupported), NOW), null, unsupported);
  }
  assert.match(PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.policyHash, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(Object.isFrozen(PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY));
  assert.ok(Object.isFrozen(PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.supportedCountryCodes));
});

test("network residence fails closed on missing, mismatched, expired, or cross-scope evidence", () => {
  for (const changed of [
    { verifiedResidenceCountry: null },
    { declaredResidenceCountry: "FR" },
    { taxResidenceCountry: "FR" },
    { residenceTaxStatus: "review" },
    { providerAssertionId: null },
    { providerVerifiedResidenceCountry: "FR" },
    { providerEvidenceVerifiedAt: new Date(NOW.getTime() + 1) },
    { providerEvidenceExpiresAt: NOW },
    { dac7Status: "missing" },
    { dac7RecordId: null },
    { dac7RecordRaterId: "another_rater" },
    { dac7SourceScopeReference: "another_scope" },
    { dac7ReviewerSource: "customer_invited" },
    { dac7WorkspaceReference: "workspace_01" },
    { dac7CollectedAt: new Date(NOW.getTime() + 1) },
    { dac7RetainedUntil: NOW },
  ] satisfies Array<Partial<PublicNetworkLegalResidenceEvidence>>) {
    assert.equal(evaluatePublicNetworkLegalResidence(evidence("DE", changed), NOW), null);
  }
});

test("the frozen snapshot binds the shared predicate and remains current only within its evidence lifetime", () => {
  const frozen = evaluatePublicNetworkLegalResidence(evidence("NO"), NOW);
  assert.ok(frozen);
  assert.equal(frozen.policyHash, PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.policyHash);
  assert.equal(isFrozenPublicNetworkLegalResidence(frozen, NOW), true);
  assert.equal(
    isFrozenPublicNetworkLegalResidence(frozen, new Date(frozen.validUntil)),
    false,
    "the offer boundary and acceptance boundary share the same exclusive expiry rule",
  );
  assert.equal(isFrozenPublicNetworkLegalResidence({ ...frozen, countryCode: "CH" }, NOW), false);
  assert.equal(isFrozenPublicNetworkLegalResidence({ ...frozen, policyHash: `sha256:${"0".repeat(64)}` }, NOW), false);
});

test("a configured not-required DAC7 decision still uses provider-verified and matching tax residence", () => {
  const frozen = evaluatePublicNetworkLegalResidence(
    evidence("NO", {
      dac7Status: "not_required",
      dac7RecordId: null,
      dac7RecordRaterId: null,
      dac7SourceScopeReference: null,
      dac7ReviewerSource: null,
      dac7WorkspaceReference: null,
      dac7CollectedAt: null,
      dac7RetainedUntil: null,
    }),
    NOW,
  );
  assert.deepEqual(frozen?.taxEvidence, { kind: "paid_eligibility", dac7Status: "not_required" });
});
