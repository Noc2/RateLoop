import {
  type HumanAssuranceAudiencePolicy,
  type HumanAssuranceCapability,
  type HumanAssuranceReviewerSource,
  parseHumanAssuranceAudiencePolicy,
} from "@rateloop/sdk";
import { createHash } from "node:crypto";
import "server-only";

export type CapabilityAdmissionEvidence = {
  providerId: string;
  capabilities: HumanAssuranceCapability[];
  reviewerSource: Exclude<HumanAssuranceReviewerSource, "hybrid" | "sandbox">;
  cohortIds: string[];
  qualificationKeys: string[];
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
}) {
  const failures: string[] = [];
  const capabilities = new Set(input.evidence.capabilities);
  const cohorts = new Set(input.evidence.cohortIds);
  const qualifications = new Set(input.evidence.qualificationKeys);

  if (input.policy.compensation === "unpaid" || !input.policy.legalEligibilityRequired) {
    failures.push("paid_eligibility_not_required");
  }
  if (input.policy.reviewerSource === "sandbox" || !sourceAllowed(input.policy, input.evidence.reviewerSource)) {
    failures.push("reviewer_source");
  }
  for (const capability of input.policy.assurance.requiredCapabilities) {
    if (!capabilities.has(capability)) failures.push(`capability:${capability}`);
  }
  if (
    input.policy.assurance.allowedProviders.length > 0 &&
    !input.policy.assurance.allowedProviders.includes(input.evidence.providerId)
  ) {
    failures.push("provider");
  }
  for (const qualification of input.policy.requiredQualifications) {
    if (!qualifications.has(qualification.key)) failures.push(`qualification:${qualification.key}`);
  }
  if (input.policy.cohorts.length > 0 && !input.policy.cohorts.some(cohort => cohorts.has(cohort.cohortId))) {
    failures.push("cohort");
  }
  const minimumQuota = input.policy.cohorts.reduce((total, cohort) => total + cohort.minimumReviewers, 0);
  if (input.maximumCommits < input.policy.buyerPrivacy.minimumAggregationSize || input.maximumCommits < minimumQuota) {
    failures.push("panel_capacity");
  }

  return { eligible: failures.length === 0, failures };
}
