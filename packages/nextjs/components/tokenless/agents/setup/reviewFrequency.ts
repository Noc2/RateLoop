import { type SetupLocalization, type SetupMessages, SetupValidationError, setupMessages } from "./setupMessages";
import { ADAPTIVE_MONITORING_FLOOR_BPS } from "~~/lib/tokenless/adaptiveReviewPolicy";
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
    mode: selection?.mode ?? "always",
    adaptiveFloorPercent: percent(
      selection && selection.productionFloorBps >= ADAPTIVE_MONITORING_FLOOR_BPS ? selection.productionFloorBps : null,
      ADAPTIVE_MONITORING_FLOOR_BPS,
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
  return `Adaptive review, at least ${percent(selection.productionFloorBps, ADAPTIVE_MONITORING_FLOOR_BPS)}%`;
}

function percentageBps(value: string, field: string, minimumBps: number, messages: SetupMessages) {
  const normalized = value.trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/u.test(normalized)) {
    throw new SetupValidationError(messages.percentDecimals(field));
  }
  const bps = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(bps) || bps < minimumBps || bps > 10_000) {
    throw new SetupValidationError(messages.percentRange(field, minimumBps / 100));
  }
  return bps;
}

function optionalPercentageBps(value: string, field: string, messages: SetupMessages) {
  return value.trim() ? percentageBps(value, field, 0, messages) : null;
}

function maximumGap(value: string, messages: SetupMessages) {
  // The label is the one rendered above the field, so the error names what the
  // reader is looking at rather than restating it in English prose.
  const label = messages.policy.limits.maximumGap;
  if (!/^\d+$/u.test(value.trim())) throw new SetupValidationError(messages.wholeNumber(label));
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10_000) {
    throw new SetupValidationError(messages.numberRange(label, 1, 10_000));
  }
  return parsed;
}

function riskTiers(value: string, messages: SetupMessages) {
  const tiers = [
    ...new Set(
      value
        .split(",")
        .map(tier => tier.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (tiers.length > 20 || tiers.some(tier => !/^[a-z][a-z0-9_-]{0,63}$/u.test(tier))) {
    throw new SetupValidationError(messages.riskTierFormat());
  }
  return tiers.sort();
}

export function buildReviewFrequencySelection(
  current: ReviewSelection,
  form: ReviewFrequencyFormValues,
  localization?: SetupLocalization,
): ReviewSelection {
  const messages = setupMessages(localization);
  const next: ReviewSelection = {
    ...current,
    mode: form.mode,
    productionFloorBps: 0,
    fixedRateBps: null,
  };

  if (form.mode === "adaptive") {
    return {
      ...next,
      productionFloorBps: ADAPTIVE_MONITORING_FLOOR_BPS,
      maximumUnreviewedGap: maximumGap(form.maximumUnreviewedGap, messages),
    };
  }
  if (form.mode === "fixed") {
    return {
      ...next,
      fixedRateBps: percentageBps(form.fixedPercent, messages.policy.limits.fixedRate, 1, messages),
      maximumUnreviewedGap: maximumGap(form.maximumUnreviewedGap, messages),
    };
  }
  if (form.mode === "rules") {
    const requiredRiskTiers = riskTiers(form.requiredRiskTiers, messages);
    const minimumConfidenceBps = optionalPercentageBps(
      form.minimumConfidencePercent,
      messages.policy.limits.confidence,
      messages,
    );
    if (requiredRiskTiers.length === 0 && minimumConfidenceBps === null) {
      throw new SetupValidationError(messages.ruleConditionRequired());
    }
    return { ...next, requiredRiskTiers, minimumConfidenceBps };
  }
  if (form.mode === "manual") return { ...next, enforcementMode: "advisory" };
  return next;
}
