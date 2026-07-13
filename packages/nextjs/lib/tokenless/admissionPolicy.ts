import {
  type HumanAssuranceAudiencePolicy,
  type HumanAssuranceCapability,
  type HumanAssuranceReviewerSource,
  parseHumanAssuranceAudiencePolicy,
} from "@rateloop/sdk";
import { createHash } from "node:crypto";
import "server-only";

export type CapabilityAdmissionEvidence = {
  assertions: Array<{
    assertionId: string;
    bindingId: string;
    providerId: string;
    providerNamespace: string;
    subjectReferenceHash: string;
    capabilities: HumanAssuranceCapability[];
    verifiedAt: Date;
    expiresAt: Date;
    validityModel?: "expiring" | "durable_enrollment";
  }>;
  reviewerSource: Exclude<HumanAssuranceReviewerSource, "hybrid">;
  cohortIds: string[];
  qualifications: Array<{ key: string; value: string | number | boolean | string[] }>;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Admission policies must be JSON serializable.");
  return encoded;
}

export function freezeAdmissionPolicy(value: unknown) {
  const policy = parseHumanAssuranceAudiencePolicy(value);
  const policyJson = canonicalJson(policy);
  const digest = createHash("sha256").update(policyJson).digest("hex");
  const policyHash = `sha256:${digest}` as const;
  // The contract stores the same digest as bytes32. Never hash the textual
  // `sha256:<hex>` representation a second time.
  const admissionPolicyHash = `0x${policyHash.slice("sha256:".length)}` as const;
  return { policy, policyJson, policyHash, admissionPolicyHash };
}

function sourceAllowed(policy: HumanAssuranceAudiencePolicy, actual: CapabilityAdmissionEvidence["reviewerSource"]) {
  if (policy.reviewerSource === actual) return true;
  if (policy.reviewerSource === "hybrid") return true;
  return policy.fallbacks.allowed && policy.fallbacks.sources.includes(actual);
}

export function evaluateFrozenAdmissionPolicy(input: {
  policy: HumanAssuranceAudiencePolicy;
  evidence: CapabilityAdmissionEvidence;
  maximumCommits: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const failures: string[] = [];
  const cohorts = new Set(input.evidence.cohortIds);
  const qualifications = new Map<string, string | number | boolean | string[]>();
  for (const qualification of input.evidence.qualifications) {
    if (!qualifications.has(qualification.key)) qualifications.set(qualification.key, qualification.value);
  }
  const usedAssertionIds = new Set<string>();
  const usedQualificationKeys = new Set<string>();
  let applicableAssuranceRequirements = 0;

  if (input.policy.compensation === "unpaid" || !input.policy.legalEligibilityRequired) {
    failures.push("paid_eligibility_not_required");
  }
  if (
    input.policy.reviewerSource === "sandbox" ||
    input.evidence.reviewerSource === "sandbox" ||
    !sourceAllowed(input.policy, input.evidence.reviewerSource)
  ) {
    failures.push("reviewer_source");
  }
  for (const requirement of input.policy.assurance.requirements) {
    if (!requirement.reviewerSources.includes(input.evidence.reviewerSource)) continue;
    applicableAssuranceRequirements += 1;
    const candidates = input.evidence.assertions.filter(
      assertion =>
        assertion.capabilities.includes(requirement.capability) &&
        (requirement.allowedProviders.length === 0 || requirement.allowedProviders.includes(assertion.providerId)),
    );
    const current = candidates.find(assertion => {
      if (
        (assertion.validityModel !== "durable_enrollment" && assertion.expiresAt <= now) ||
        assertion.verifiedAt > now
      )
        return false;
      return (
        requirement.freshnessSeconds === undefined ||
        assertion.verifiedAt.getTime() >= now.getTime() - requirement.freshnessSeconds * 1_000
      );
    });
    if (current) usedAssertionIds.add(current.assertionId);
    else if (candidates.length > 0) failures.push(`freshness:${requirement.capability}`);
    else failures.push(`capability:${requirement.capability}`);
  }
  if (applicableAssuranceRequirements === 0) failures.push("assurance_requirement");
  for (const qualification of input.policy.requiredQualifications) {
    const actual = qualifications.get(qualification.key);
    let satisfied = false;
    if (qualification.operator === "attested") satisfied = actual === true;
    else if (qualification.operator === "equals")
      satisfied = canonicalJson(actual) === canonicalJson(qualification.value);
    else if (qualification.operator === "at_least") {
      satisfied =
        typeof actual === "number" && typeof qualification.value === "number" && actual >= qualification.value;
    } else {
      const allowed = Array.isArray(qualification.value) ? qualification.value : [qualification.value];
      satisfied = Array.isArray(actual)
        ? actual.some(value => allowed.some(expected => canonicalJson(value) === canonicalJson(expected)))
        : allowed.some(expected => canonicalJson(actual) === canonicalJson(expected));
    }
    if (satisfied) usedQualificationKeys.add(qualification.key);
    else failures.push(`qualification:${qualification.key}`);
  }
  if (input.policy.cohorts.length > 0 && !input.policy.cohorts.some(cohort => cohorts.has(cohort.cohortId))) {
    failures.push("cohort");
  }
  const minimumQuota = input.policy.cohorts.reduce((total, cohort) => total + cohort.minimumReviewers, 0);
  if (input.maximumCommits < input.policy.buyerPrivacy.minimumAggregationSize || input.maximumCommits < minimumQuota) {
    failures.push("panel_capacity");
  }

  return {
    eligible: failures.length === 0,
    failures,
    usedAssertionIds: [...usedAssertionIds].sort(),
    usedQualificationKeys: [...usedQualificationKeys].sort(),
  };
}
