import { HUMAN_ASSURANCE_SCHEMA_VERSION } from "@rateloop/sdk";
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFrozenAdmissionPolicy, freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";

function policy() {
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    policyId: "policy_1",
    version: 1,
    reviewerSource: "rateloop_network",
    compensation: "paid",
    cohorts: [],
    selection: "randomized",
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requiredCapabilities: ["account_control", "live_human", "minimum_age"],
      allowedProviders: ["identity-production"],
    },
    buyerPrivacy: {
      visibleFields: ["reviewer_source"],
      minimumAggregationSize: 10,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: true,
  };
}

test("admission policy canonicalization is exact and order-independent", () => {
  const first = freezeAdmissionPolicy(policy());
  const second = freezeAdmissionPolicy({
    ...policy(),
    assurance: {
      allowedProviders: ["identity-production"],
      requiredCapabilities: ["account_control", "live_human", "minimum_age"],
    },
  });
  assert.equal(first.policyJson, second.policyJson);
  assert.equal(first.admissionPolicyHash, `0x${first.policyHash.slice("sha256:".length)}`);
  assert.equal(first.admissionPolicyHash, second.admissionPolicyHash);
  assert.match(first.admissionPolicyHash, /^0x[0-9a-f]{64}$/);
});

test("admission evaluation covers capabilities, providers, source, and aggregate capacity", () => {
  const frozen = freezeAdmissionPolicy(policy());
  const evidence = {
    providerId: "identity-production",
    capabilities: ["account_control", "live_human", "minimum_age"] as const,
    reviewerSource: "rateloop_network" as const,
    cohortIds: [],
    qualificationKeys: [],
  };
  assert.deepEqual(
    evaluateFrozenAdmissionPolicy({
      policy: frozen.policy,
      evidence: { ...evidence, capabilities: [...evidence.capabilities] },
      maximumCommits: 15,
    }),
    { eligible: true, failures: [] },
  );
  assert.deepEqual(
    evaluateFrozenAdmissionPolicy({
      policy: frozen.policy,
      evidence: { ...evidence, capabilities: ["account_control"] },
      maximumCommits: 5,
    }),
    {
      eligible: false,
      failures: ["capability:live_human", "capability:minimum_age", "panel_capacity"],
    },
  );
});
