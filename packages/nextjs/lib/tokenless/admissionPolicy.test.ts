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
    requiredQualifications: [{ key: "quality_score", operator: "at_least" as const, value: 80 }],
    assurance: {
      requirements: ["account_control", "live_human", "minimum_age"].map(capability => ({
        capability: capability as "account_control" | "live_human" | "minimum_age",
        reviewerSources: ["rateloop_network" as const],
        allowedProviders: ["identity-production"],
        freshnessSeconds: 3_600,
      })),
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
      requirements: policy().assurance.requirements.map(requirement => ({
        freshnessSeconds: requirement.freshnessSeconds,
        allowedProviders: requirement.allowedProviders,
        reviewerSources: requirement.reviewerSources,
        capability: requirement.capability,
      })),
    },
  });
  assert.equal(first.policyJson, second.policyJson);
  assert.equal(first.admissionPolicyHash, `0x${first.policyHash.slice("sha256:".length)}`);
  assert.equal(first.admissionPolicyHash, second.admissionPolicyHash);
  assert.match(first.admissionPolicyHash, /^0x[0-9a-f]{64}$/);
});

test("admission evaluation covers capabilities, providers, source, and aggregate capacity", () => {
  const frozen = freezeAdmissionPolicy(policy());
  const now = new Date("2026-07-13T12:00:00.000Z");
  const evidence = {
    assertions: [
      {
        assertionId: "assertion_1",
        bindingId: "binding_1",
        providerId: "identity-production",
        providerNamespace: "legacy:v2",
        subjectReferenceHash: `sha256:${"1".repeat(64)}`,
        capabilities: ["account_control", "live_human", "minimum_age"] as const,
        verifiedAt: new Date(now.getTime() - 1_000),
        expiresAt: new Date(now.getTime() + 3_600_000),
      },
    ],
    reviewerSource: "rateloop_network" as const,
    cohortIds: [],
    qualifications: [{ key: "quality_score", value: 90 }],
  };
  const admitted = evaluateFrozenAdmissionPolicy({
    policy: frozen.policy,
    evidence: {
      ...evidence,
      assertions: evidence.assertions.map(assertion => ({
        ...assertion,
        capabilities: [...assertion.capabilities],
      })),
    },
    maximumCommits: 15,
    now,
  });
  assert.equal(admitted.eligible, true);
  assert.deepEqual(admitted.usedAssertionIds, ["assertion_1"]);
  assert.deepEqual(admitted.usedQualificationKeys, ["quality_score"]);
  assert.deepEqual(
    evaluateFrozenAdmissionPolicy({
      policy: frozen.policy,
      evidence: {
        ...evidence,
        assertions: [
          {
            ...evidence.assertions[0],
            capabilities: ["account_control"],
            verifiedAt: new Date(now.getTime() - 3_601_000),
          },
        ],
        qualifications: [{ key: "quality_score", value: 70 }],
      },
      maximumCommits: 5,
      now,
    }),
    {
      eligible: false,
      failures: [
        "freshness:account_control",
        "capability:live_human",
        "capability:minimum_age",
        "qualification:quality_score",
        "panel_capacity",
      ],
      usedAssertionIds: [],
      usedQualificationKeys: [],
    },
  );
});

test("hybrid policies apply only the requirements for the actual subpanel source", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");
  const hybrid = freezeAdmissionPolicy({
    ...policy(),
    reviewerSource: "hybrid",
    requiredQualifications: [],
    assurance: {
      requirements: [
        {
          capability: "customer_invitation",
          reviewerSources: ["customer_invited"],
          allowedProviders: ["rateloop:invitation"],
        },
        {
          capability: "unique_human",
          reviewerSources: ["rateloop_network"],
          allowedProviders: ["world-id"],
          freshnessSeconds: 3_600,
        },
      ],
    },
  });
  const result = evaluateFrozenAdmissionPolicy({
    policy: hybrid.policy,
    evidence: {
      assertions: [
        {
          assertionId: "invite_1",
          bindingId: "invite_binding",
          providerId: "rateloop:invitation",
          providerNamespace: "rateloop:assignment:v1",
          subjectReferenceHash: `sha256:${"2".repeat(64)}`,
          capabilities: ["customer_invitation"],
          verifiedAt: now,
          expiresAt: new Date(now.getTime() + 60_000),
        },
      ],
      reviewerSource: "customer_invited",
      cohortIds: [],
      qualifications: [],
    },
    maximumCommits: 15,
    now,
  });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.usedAssertionIds, ["invite_1"]);
});

test("paid hybrid policies never admit the sandbox source", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");
  const hybrid = freezeAdmissionPolicy({
    ...policy(),
    reviewerSource: "hybrid",
    requiredQualifications: [],
    assurance: {
      requirements: [
        {
          capability: "live_human",
          reviewerSources: ["sandbox"],
          allowedProviders: ["rateloop-development"],
        },
      ],
    },
  });
  const result = evaluateFrozenAdmissionPolicy({
    policy: hybrid.policy,
    evidence: {
      assertions: [
        {
          assertionId: "sandbox_1",
          bindingId: "sandbox_binding",
          providerId: "rateloop-development",
          providerNamespace: "test:v1",
          subjectReferenceHash: `sha256:${"3".repeat(64)}`,
          capabilities: ["live_human"],
          verifiedAt: now,
          expiresAt: new Date(now.getTime() + 60_000),
        },
      ],
      reviewerSource: "sandbox",
      cohortIds: [],
      qualifications: [],
    },
    maximumCommits: 15,
    now,
  });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.failures, ["reviewer_source"]);
});

test("source-mistagged requirements cannot silently admit a paid reviewer", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");
  const mistagged = freezeAdmissionPolicy({
    ...policy(),
    requiredQualifications: [],
    assurance: {
      requirements: [
        {
          capability: "customer_invitation",
          reviewerSources: ["customer_invited"],
          allowedProviders: ["rateloop:invitation"],
        },
      ],
    },
  });
  const result = evaluateFrozenAdmissionPolicy({
    policy: mistagged.policy,
    evidence: {
      assertions: [],
      reviewerSource: "rateloop_network",
      cohortIds: [],
      qualifications: [],
    },
    maximumCommits: 15,
    now,
  });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.failures, ["assurance_requirement"]);
});
