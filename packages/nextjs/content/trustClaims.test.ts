import {
  TRUST_CLAIM_REGISTRY,
  TRUST_CLAIM_REGISTRY_VERSION,
  type TrustClaimRegistry,
  getCurrentPublicTrustClaims,
  validateTrustClaimRegistry,
} from "./trustClaims";
import assert from "node:assert/strict";
import test from "node:test";

test("trust claim registry is versioned, approved, evidenced, and current", () => {
  assert.equal(TRUST_CLAIM_REGISTRY.version, TRUST_CLAIM_REGISTRY_VERSION);
  assert.equal(validateTrustClaimRegistry(TRUST_CLAIM_REGISTRY), TRUST_CLAIM_REGISTRY);

  const current = getCurrentPublicTrustClaims(new Date("2026-07-15T12:00:00.000Z"));
  assert.equal(current.length, TRUST_CLAIM_REGISTRY.claims.length);
  assert.ok(current.every(claim => claim.approval === "approved"));
  assert.ok(current.every(claim => claim.evidence.length > 0));
  assert.ok(current.some(claim => claim.key === "private-artifact-encryption" && claim.status === "implemented"));
  assert.ok(current.some(claim => claim.key === "public-chain-limits" && claim.kind === "limitation"));
  assert.deepEqual(getCurrentPublicTrustClaims(new Date("2027-01-01T00:00:00.000Z")), []);
});

test("trust claim registry rejects duplicate keys, unapproved public claims, and missing evidence", () => {
  const first = TRUST_CLAIM_REGISTRY.claims[0];
  assert.ok(first);

  const duplicated = {
    ...TRUST_CLAIM_REGISTRY,
    claims: [...TRUST_CLAIM_REGISTRY.claims, first],
  } satisfies TrustClaimRegistry;
  assert.throws(() => validateTrustClaimRegistry(duplicated), /invalid or duplicated/);

  const withheld = {
    ...TRUST_CLAIM_REGISTRY,
    claims: [{ ...first, approval: "withheld" as const }],
  } satisfies TrustClaimRegistry;
  assert.throws(() => validateTrustClaimRegistry(withheld), /must be approved/);

  const withoutEvidence = {
    ...TRUST_CLAIM_REGISTRY,
    claims: [{ ...first, evidence: [] }],
  } satisfies TrustClaimRegistry;
  assert.throws(() => validateTrustClaimRegistry(withoutEvidence), /missing exact text or evidence/);
});

test("certification and residency language remains explicitly unavailable or pending verification", () => {
  const restricted = new Set([
    "eu-hosted-data-plane",
    "soc-2-type-2",
    "gdpr",
    "hipaa-baa",
    "customer-vpc",
    "saml-scim",
    "independent-penetration-test",
    "contractual-no-training",
  ]);

  for (const claim of TRUST_CLAIM_REGISTRY.claims) {
    if (!restricted.has(claim.key)) continue;
    assert.equal(claim.kind, "availability");
    assert.ok(claim.status === "not_available" || claim.status === "verification_pending");
    assert.match(claim.statement, /does not|not currently/i);
  }
});
