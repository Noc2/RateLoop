export type DsaReferenceOutcome = "pass" | "fail";
export type DsaNamedPanelPolicyChoice = "policy_matches" | "policy_does_not_match";
export type DsaStoredAssuranceChoice = "candidate" | "baseline";
export type DsaConfusionCell = "true_positive" | "false_positive" | "true_negative" | "false_negative";

export function referenceOutcomeForNamedPanelPolicyChoice(choice: DsaNamedPanelPolicyChoice): DsaReferenceOutcome {
  return choice === "policy_matches" ? "fail" : "pass";
}

export function referenceOutcomeForStoredAssuranceChoice(choice: string): DsaReferenceOutcome | null {
  return choice === "candidate" ? "pass" : choice === "baseline" ? "fail" : null;
}

export function storedAssuranceChoiceForReferenceOutcome(
  referenceOutcome: DsaReferenceOutcome,
): DsaStoredAssuranceChoice {
  return referenceOutcome === "fail" ? "baseline" : "candidate";
}

export function classifyDsaConfusionCell(
  automatedOutcome: DsaReferenceOutcome,
  referenceOutcome: DsaReferenceOutcome,
): DsaConfusionCell {
  if (automatedOutcome === "fail") return referenceOutcome === "fail" ? "true_positive" : "false_positive";
  return referenceOutcome === "pass" ? "true_negative" : "false_negative";
}
