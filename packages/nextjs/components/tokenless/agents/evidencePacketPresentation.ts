type EvidenceTranslate = (key: string) => string;

export const EVIDENCE_TRIGGER_MESSAGE_KEYS = {
  adaptive_sample: "selectionTrigger.adaptive_sample",
  critical_risk: "selectionTrigger.critical_risk",
  guardrail_escalation: "selectionTrigger.guardrail_escalation",
  maximum_gap: "selectionTrigger.maximum_gap",
  owner_required: "selectionTrigger.owner_required",
  policy_rule: "selectionTrigger.policy_rule",
} as const;

export const EVIDENCE_GATE_MESSAGE_KEYS = {
  blocking: "gateType.blocking",
  advisory: "gateType.advisory",
  not_applicable: "gateType.not_applicable",
} as const;

export const EVIDENCE_REVIEWER_SOURCE_MESSAGE_KEYS = {
  customer_invited: "reviewerSource.customer_invited",
  private_invited: "reviewerSource.private_invited",
  rateloop_network: "reviewerSource.rateloop_network",
  public_network: "reviewerSource.public_network",
  hybrid: "reviewerSource.hybrid",
} as const;

function label<T extends Record<string, string>>(
  values: T,
  value: string,
  t: EvidenceTranslate,
  fallback = "unavailable",
) {
  const key = Object.prototype.hasOwnProperty.call(values, value) ? values[value as keyof T] : null;
  return t(key ?? fallback);
}

export function evidenceTriggerLabel(value: string, t: EvidenceTranslate) {
  return label(EVIDENCE_TRIGGER_MESSAGE_KEYS, value, t);
}

export function evidenceGateLabel(value: string, t: EvidenceTranslate) {
  return label(EVIDENCE_GATE_MESSAGE_KEYS, value, t);
}

export function evidenceReviewerSourceLabel(value: string, t: EvidenceTranslate) {
  return label(EVIDENCE_REVIEWER_SOURCE_MESSAGE_KEYS, value, t, "notAvailable");
}
