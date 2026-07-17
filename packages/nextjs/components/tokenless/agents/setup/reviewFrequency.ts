import type { AgentSetupReviewDraft, AgentSetupReviewMode } from "~~/lib/tokenless/workspaceAgentSetup";

type ReviewSelection = AgentSetupReviewDraft["selection"];

export type ReviewFrequencyFormValues = {
  mode: AgentSetupReviewMode;
  adaptiveFloorPercent: string;
  fixedPercent: string;
  maximumUnreviewedGap: string;
  requiredRiskTiers: string;
  minimumConfidencePercent: string;
};

function percent(bps: number | null, fallbackBps: number) {
  return String((bps ?? fallbackBps) / 100);
}

export function reviewFrequencyFormValues(selection: ReviewSelection | null | undefined): ReviewFrequencyFormValues {
  return {
    mode: selection?.mode ?? "adaptive",
    adaptiveFloorPercent: percent(
      selection && selection.productionFloorBps >= 1_000 ? selection.productionFloorBps : null,
      1_000,
    ),
    fixedPercent: percent(selection?.fixedRateBps ?? null, 1_000),
    maximumUnreviewedGap: String(selection?.maximumUnreviewedGap ?? 20),
    requiredRiskTiers: (selection?.requiredRiskTiers ?? ["high"]).join(", "),
    minimumConfidencePercent: percent(selection?.minimumConfidenceBps ?? null, 7_000),
  };
}

export function reviewFrequencySummary(selection: ReviewSelection | null | undefined) {
  if (!selection) return "Adaptive review";
  if (selection.mode === "always") return "Every eligible output";
  if (selection.mode === "manual") return "Manual handoff only";
  if (selection.mode === "fixed") return `${percent(selection.fixedRateBps, 0)}% of eligible outputs`;
  if (selection.mode === "rules") return "When risk or confidence conditions match";
  return `Adaptive review, at least ${percent(selection.productionFloorBps, 1_000)}%`;
}

function percentageBps(value: string, field: string, minimumBps: number) {
  const normalized = value.trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/u.test(normalized)) {
    throw new Error(`${field} must be a percentage with at most two decimal places.`);
  }
  const bps = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(bps) || bps < minimumBps || bps > 10_000) {
    throw new Error(`${field} must be between ${minimumBps / 100}% and 100%.`);
  }
  return bps;
}

function optionalPercentageBps(value: string, field: string) {
  return value.trim() ? percentageBps(value, field, 0) : null;
}

function maximumGap(value: string) {
  if (!/^\d+$/u.test(value.trim())) throw new Error("Maximum outputs between reviews must be a whole number.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10_000) {
    throw new Error("Maximum outputs between reviews must be between 1 and 10000.");
  }
  return parsed;
}

function riskTiers(value: string) {
  const tiers = [
    ...new Set(
      value
        .split(",")
        .map(tier => tier.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (tiers.length > 20 || tiers.some(tier => !/^[a-z][a-z0-9_-]{0,63}$/u.test(tier))) {
    throw new Error("Risk levels must be comma-separated names using letters, numbers, hyphens, or underscores.");
  }
  return tiers.sort();
}

export function buildReviewFrequencySelection(
  current: ReviewSelection,
  form: ReviewFrequencyFormValues,
): ReviewSelection {
  const next: ReviewSelection = {
    ...current,
    mode: form.mode,
    productionFloorBps: 0,
    fixedRateBps: null,
  };

  if (form.mode === "adaptive") {
    return {
      ...next,
      productionFloorBps: percentageBps(form.adaptiveFloorPercent, "Minimum review rate", 1_000),
      maximumUnreviewedGap: maximumGap(form.maximumUnreviewedGap),
    };
  }
  if (form.mode === "fixed") {
    return {
      ...next,
      fixedRateBps: percentageBps(form.fixedPercent, "Fixed review rate", 1),
      maximumUnreviewedGap: maximumGap(form.maximumUnreviewedGap),
    };
  }
  if (form.mode === "rules") {
    const requiredRiskTiers = riskTiers(form.requiredRiskTiers);
    const minimumConfidenceBps = optionalPercentageBps(form.minimumConfidencePercent, "Confidence threshold");
    if (requiredRiskTiers.length === 0 && minimumConfidenceBps === null) {
      throw new Error("Add at least one risk level or confidence condition.");
    }
    return { ...next, requiredRiskTiers, minimumConfidenceBps };
  }
  if (form.mode === "manual") return { ...next, enforcementMode: "advisory" };
  return next;
}
