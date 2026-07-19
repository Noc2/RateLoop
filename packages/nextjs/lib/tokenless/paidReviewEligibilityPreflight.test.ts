import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import {
  paidReviewRequiresEligibility,
  requirePaidReviewEligibilityInTransaction,
} from "~~/lib/tokenless/paidReviewEligibilityPreflight";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const PRINCIPAL = `rlp_${"1".repeat(24)}`;
const NOW = new Date("2026-07-16T12:00:00.000Z");

function eligibleRow(overrides: Record<string, unknown> = {}) {
  return {
    rater_id: "rater_preflight_01",
    principal_id: PRINCIPAL,
    account_address: ACCOUNT,
    active_payout_account: ACCOUNT,
    nullifier_seed_ciphertext: "v1.seed",
    nullifier_key_version: "vote-v1",
    nullifier_key_domain: "vote_mapping",
    profile_updated_at: NOW,
    minimum_age_verified: 18,
    age_evidence_verified_at: new Date(NOW.getTime() - 60_000),
    age_evidence_expires_at: new Date(NOW.getTime() + 86_400_000),
    verified_residence_country: "DE",
    declared_residence_country: "DE",
    tax_residence_country: "DE",
    residence_tax_status: "consistent",
    tax_profile_status: "complete",
    dac7_status: "complete",
    tax_vault_ciphertext: "v1.tax",
    tax_vault_key_version: "tax-v1",
    tax_vault_key_domain: "tax_records",
    sanctions_consent_at: new Date(NOW.getTime() - 60_000),
    sanctions_status: "clear",
    sanctions_reference_hash: "a".repeat(64),
    sanctions_screened_at: new Date(NOW.getTime() - 60_000),
    sanctions_expires_at: new Date(NOW.getTime() + 43_200_000),
    legal_eligibility_status: "eligible",
    legal_updated_at: NOW,
    payout_account: ACCOUNT,
    payout_ownership_method: "siwe_base_account_session",
    payout_verified_at: new Date(NOW.getTime() - 60_000),
    payout_expires_at: null,
    payout_eligibility_status: "ready",
    payout_updated_at: NOW,
    ...overrides,
  };
}

function identityRow(overrides: Record<string, unknown> = {}) {
  return {
    assertion_id: "assertion_preflight_01",
    binding_id: "binding_preflight_01",
    provider_id: "identity-provider",
    provider_namespace: "identity:v1",
    capabilities_json: JSON.stringify(["account_control", "minimum_age", "live_human"]),
    assertion_minimum_age_verified: 18,
    provider_evidence_ciphertext: "v1.evidence",
    provider_evidence_key_version: "evidence-v1",
    provider_evidence_key_domain: "provider_evidence",
    evidence_verified_at: new Date(NOW.getTime() - 60_000),
    evidence_expires_at: new Date(NOW.getTime() + 86_400_000),
    assurance_validity_model: "expiring",
    assertion_status: "active",
    assertion_updated_at: NOW,
    binding_status: "active",
    last_verified_at: new Date(NOW.getTime() - 60_000),
    binding_updated_at: NOW,
    ...overrides,
  };
}

function client(main: Record<string, unknown> | null, identities: Record<string, unknown>[]) {
  return {
    async query(sql: string) {
      return {
        rows: sql.includes("FROM tokenless_rater_profiles") ? (main ? [main] : []) : identities,
        rowCount: 1,
      };
    },
  } as unknown as Pick<PoolClient, "query">;
}

async function rejectsEligibility(
  main: Record<string, unknown> | null,
  identities: Record<string, unknown>[] = [identityRow()],
) {
  await assert.rejects(
    () => requirePaidReviewEligibilityInTransaction(client(main, identities), PRINCIPAL, NOW),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_eligibility_required",
  );
}

test("paid-review preflight freezes current identity, legal, sanctions, tax, and payout evidence", async () => {
  const first = await requirePaidReviewEligibilityInTransaction(client(eligibleRow(), [identityRow()]), PRINCIPAL, NOW);
  const later = await requirePaidReviewEligibilityInTransaction(
    client(eligibleRow(), [identityRow()]),
    PRINCIPAL,
    new Date(NOW.getTime() + 1_000),
  );
  assert.deepEqual(first, {
    schemaVersion: "rateloop.paid-review-eligibility-preflight.v1",
    preflightId: first.preflightId,
    raterId: "rater_preflight_01",
    principalId: PRINCIPAL,
    accountAddress: ACCOUNT,
    identityAssertions: [
      {
        assertionId: "assertion_preflight_01",
        bindingId: "binding_preflight_01",
        providerId: "identity-provider",
        providerNamespace: "identity:v1",
        capabilities: ["account_control", "live_human", "minimum_age"],
      },
    ],
    payoutAccount: ACCOUNT,
    checkedAt: NOW.toISOString(),
    validUntil: new Date(NOW.getTime() + 43_200_000).toISOString(),
    eligibilityCommitment: first.eligibilityCommitment,
  });
  assert.match(first.preflightId, /^pef_[0-9a-f]{48}$/u);
  assert.match(first.eligibilityCommitment, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(first.preflightId, `pef_${first.eligibilityCommitment.slice("sha256:".length, 55)}`);
  assert.equal(later.preflightId, first.preflightId, "check time does not change the preflight reference");
  assert.equal(later.eligibilityCommitment, first.eligibilityCommitment, "check time is not frozen policy state");
});

test("paid-review preflight composes account control and minimum age from independent providers", async () => {
  const accountControl = identityRow({
    assertion_id: "assertion_control",
    binding_id: "binding_control",
    provider_id: "world:poh",
    provider_namespace: "world:poh:v1",
    capabilities_json: JSON.stringify(["account_control", "live_human", "unique_human"]),
    assertion_minimum_age_verified: 0,
  });
  const minimumAge = identityRow({
    assertion_id: "assertion_age",
    binding_id: "binding_age",
    provider_id: "age-provider",
    provider_namespace: "age:test",
    capabilities_json: JSON.stringify(["minimum_age"]),
  });
  const preflight = await requirePaidReviewEligibilityInTransaction(
    client(eligibleRow(), [accountControl, minimumAge]),
    PRINCIPAL,
    NOW,
  );
  assert.deepEqual(
    preflight.identityAssertions.map(value => ({ assertionId: value.assertionId, providerId: value.providerId })),
    [
      { assertionId: "assertion_age", providerId: "age-provider" },
      { assertionId: "assertion_control", providerId: "world:poh" },
    ],
  );
});

test("paid-review preflight chooses the minimal assertion set with deterministic ties", async () => {
  const preferred = identityRow({ assertion_id: "assertion_a", binding_id: "binding_a" });
  const competing = identityRow({ assertion_id: "assertion_b", binding_id: "binding_b" });
  const accountOnly = identityRow({
    assertion_id: "assertion_account_newer",
    binding_id: "binding_account_newer",
    capabilities_json: JSON.stringify(["account_control"]),
    assertion_minimum_age_verified: 0,
    evidence_verified_at: NOW,
  });
  const ageOnly = identityRow({
    assertion_id: "assertion_age_newer",
    binding_id: "binding_age_newer",
    capabilities_json: JSON.stringify(["minimum_age"]),
    evidence_verified_at: NOW,
  });
  const first = await requirePaidReviewEligibilityInTransaction(
    client(eligibleRow(), [competing, accountOnly, preferred, ageOnly]),
    PRINCIPAL,
    NOW,
  );
  const reordered = await requirePaidReviewEligibilityInTransaction(
    client(eligibleRow(), [ageOnly, preferred, accountOnly, competing]),
    PRINCIPAL,
    NOW,
  );
  assert.deepEqual(
    first.identityAssertions.map(value => value.assertionId),
    ["assertion_a"],
  );
  assert.deepEqual(reordered.identityAssertions, first.identityAssertions);
  assert.equal(reordered.preflightId, first.preflightId);
  assert.equal(reordered.eligibilityCommitment, first.eligibilityCommitment);
});

test("paid-review preflight fails closed when current assertions do not cover the required union", async () => {
  const accountOnly = identityRow({
    capabilities_json: JSON.stringify(["account_control"]),
    assertion_minimum_age_verified: 0,
  });
  const secondAccountOnly = identityRow({
    assertion_id: "assertion_account_02",
    binding_id: "binding_account_02",
    capabilities_json: JSON.stringify(["account_control", "live_human"]),
    assertion_minimum_age_verified: 0,
  });
  const underage = identityRow({
    assertion_id: "assertion_age_underage",
    binding_id: "binding_age_underage",
    capabilities_json: JSON.stringify(["minimum_age"]),
    assertion_minimum_age_verified: 17,
  });
  await rejectsEligibility(eligibleRow(), [accountOnly, secondAccountOnly]);
  await rejectsEligibility(eligibleRow(), [accountOnly, underage]);
});

test("paid-review preflight commitment changes when decision-bearing evidence changes", async () => {
  const first = await requirePaidReviewEligibilityInTransaction(client(eligibleRow(), [identityRow()]), PRINCIPAL, NOW);
  const changed = await requirePaidReviewEligibilityInTransaction(
    client(eligibleRow({ sanctions_reference_hash: "b".repeat(64) }), [identityRow()]),
    PRINCIPAL,
    NOW,
  );
  assert.notEqual(changed.preflightId, first.preflightId);
  assert.notEqual(changed.eligibilityCommitment, first.eligibilityCommitment);
});

test("paid eligibility follows either optional USDC payment across every audience lane", () => {
  for (const lane of ["public_network", "private_invited", "hybrid"] as const) {
    assert.equal(
      paidReviewRequiresEligibility({ lane, guaranteedCompensationMode: "usdc", feedbackBonusMode: "off" }),
      true,
    );
    assert.equal(
      paidReviewRequiresEligibility({ lane, guaranteedCompensationMode: "unpaid", feedbackBonusMode: "usdc" }),
      true,
    );
    assert.equal(
      paidReviewRequiresEligibility({ lane, guaranteedCompensationMode: "unpaid", feedbackBonusMode: "off" }),
      false,
    );
  }
});

test("paid-review preflight fails closed for every legal, tax, sanctions, payout, and wallet gate", async () => {
  await rejectsEligibility(null);
  for (const changed of [
    { legal_eligibility_status: "review" },
    { minimum_age_verified: 17 },
    { age_evidence_expires_at: NOW },
    { declared_residence_country: "FR" },
    { residence_tax_status: "review" },
    { tax_profile_status: "incomplete" },
    { dac7_status: "complete", tax_vault_ciphertext: null },
    { sanctions_status: "review" },
    { sanctions_reference_hash: "missing" },
    { sanctions_expires_at: NOW },
    { payout_account: "0x2222222222222222222222222222222222222222" },
    { payout_ownership_method: "unverified" },
    { payout_eligibility_status: "blocked" },
    { payout_expires_at: NOW },
    { nullifier_key_domain: "wrong_domain" },
    { nullifier_seed_ciphertext: null },
  ]) {
    await rejectsEligibility(eligibleRow(changed));
  }
});

test("paid-review preflight requires a live identity assertion bound to the same rater", async () => {
  for (const changed of [
    { assertion_status: "revoked" },
    { binding_status: "revoked" },
    { capabilities_json: JSON.stringify(["account_control"]) },
    { capabilities_json: JSON.stringify(["minimum_age"]) },
    { assertion_minimum_age_verified: 17 },
    { evidence_expires_at: NOW },
    { provider_evidence_key_domain: "wrong_domain" },
    { provider_evidence_ciphertext: null },
  ]) {
    await rejectsEligibility(eligibleRow(), [identityRow(changed)]);
  }
});

test("durable identity enrollment still requires current age, sanctions, and payout evidence", async () => {
  const durable = identityRow({
    assurance_validity_model: "durable_enrollment",
    evidence_expires_at: new Date(NOW.getTime() - 1),
  });
  const ready = await requirePaidReviewEligibilityInTransaction(client(eligibleRow(), [durable]), PRINCIPAL, NOW);
  assert.deepEqual(
    ready.identityAssertions.map(value => value.assertionId),
    ["assertion_preflight_01"],
  );
  await rejectsEligibility(eligibleRow({ sanctions_expires_at: NOW }), [durable]);
});
