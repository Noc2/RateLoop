import type { HumanAssuranceCapability } from "@rateloop/sdk";

type HumanStateTranslate = (key: string) => string;

export const ELIGIBILITY_STATUS_MESSAGE_KEYS = {
  not_started: "status.notStarted",
  declined: "status.declined",
  eligible: "status.eligible",
  review: "status.review",
  blocked: "status.blocked",
  expired: "status.expired",
} as const;

export const ASSURANCE_CAPABILITY_MESSAGE_KEYS = {
  account_control: "capability.account_control",
  customer_invitation: "capability.customer_invitation",
  live_human: "capability.live_human",
  unique_human: "capability.unique_human",
  document_holder: "capability.document_holder",
  minimum_age: "capability.minimum_age",
  issuing_country: "capability.issuing_country",
  nationality: "capability.nationality",
} as const satisfies Record<HumanAssuranceCapability, string>;

export const SETTLEMENT_ROUND_STATUS_MESSAGE_KEYS = {
  open: "roundStatusValue.open",
  revealable: "roundStatusValue.revealable",
  aggregating: "roundStatusValue.aggregating",
  awaiting_seed: "roundStatusValue.awaiting_seed",
  scoring: "roundStatusValue.scoring",
  finalized: "roundStatusValue.finalized",
  zero_commit_refunded: "roundStatusValue.zero_commit_refunded",
  under_quorum_compensated: "roundStatusValue.under_quorum_compensated",
  beacon_failure_compensated: "roundStatusValue.beacon_failure_compensated",
} as const;

function knownMessageKey<T extends Record<string, string>>(values: T, value: string | null | undefined) {
  return value && Object.prototype.hasOwnProperty.call(values, value) ? values[value as keyof T] : null;
}

export function eligibilityStatusLabel(status: string | null | undefined, t: HumanStateTranslate) {
  if (!status) return t("status.checking");
  const key = knownMessageKey(ELIGIBILITY_STATUS_MESSAGE_KEYS, status);
  return t(key ?? "status.unavailable");
}

export function assuranceCapabilityLabel(capability: string, t: HumanStateTranslate) {
  return t(knownMessageKey(ASSURANCE_CAPABILITY_MESSAGE_KEYS, capability) ?? "capability.unavailable");
}

export function settlementRoundStatusLabel(status: string, t: HumanStateTranslate) {
  return t(knownMessageKey(SETTLEMENT_ROUND_STATUS_MESSAGE_KEYS, status) ?? "roundStatusValue.unavailable");
}
