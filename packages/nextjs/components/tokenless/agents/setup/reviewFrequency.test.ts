import {
  type ReviewFrequencyFormValues,
  buildReviewFrequencySelection,
  reviewFrequencyFormValues,
  reviewFrequencySummary,
} from "./reviewFrequency";
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

const selection: AgentSetupReviewDraft["selection"] = {
  mode: "adaptive",
  enforcementMode: "advisory",
  agreementThresholdBps: 8_000,
  productionFloorBps: 1_000,
  fixedRateBps: null,
  maximumUnreviewedGap: 20,
  requiredRiskTiers: ["high"],
  criticalRiskTiers: ["critical"],
  minimumConfidenceBps: 7_000,
  maximumLatencyMs: 120_000,
};

function form(overrides: Partial<ReviewFrequencyFormValues>): ReviewFrequencyFormValues {
  return { ...reviewFrequencyFormValues(selection), ...overrides };
}

test("adaptive and fixed percentages map exactly to deterministic basis points", () => {
  const adaptive = buildReviewFrequencySelection(
    selection,
    form({ mode: "adaptive", adaptiveFloorPercent: "12.25", maximumUnreviewedGap: "40" }),
  );
  assert.equal(adaptive.productionFloorBps, 1_225);
  assert.equal(adaptive.fixedRateBps, null);
  assert.equal(adaptive.maximumUnreviewedGap, 40);

  const fixed = buildReviewFrequencySelection(
    selection,
    form({ mode: "fixed", fixedPercent: "2.50", maximumUnreviewedGap: "75" }),
  );
  assert.equal(fixed.productionFloorBps, 0);
  assert.equal(fixed.fixedRateBps, 250);
  assert.equal(fixed.maximumUnreviewedGap, 75);
});

test("rule conditions normalize exact risk tiers and an optional confidence threshold", () => {
  const rules = buildReviewFrequencySelection(
    selection,
    form({
      mode: "rules",
      requiredRiskTiers: " HIGH, legal, high ",
      minimumConfidencePercent: "82.5",
    }),
  );
  assert.deepEqual(rules.requiredRiskTiers, ["high", "legal"]);
  assert.equal(rules.minimumConfidenceBps, 8_250);
  assert.equal(rules.productionFloorBps, 0);
  assert.equal(rules.fixedRateBps, null);
});

test("every-output and manual modes clear inactive rate fields", () => {
  for (const mode of ["always", "manual"] as const) {
    const result = buildReviewFrequencySelection({ ...selection, fixedRateBps: 500 }, form({ mode }));
    assert.equal(result.mode, mode);
    assert.equal(result.productionFloorBps, 0);
    assert.equal(result.fixedRateBps, null);
    assert.equal(result.enforcementMode, mode === "manual" ? "advisory" : selection.enforcementMode);
  }
});

test("mode-specific invalid and empty frequency fields fail before the owner save", () => {
  assert.throws(
    () => buildReviewFrequencySelection(selection, form({ mode: "adaptive", adaptiveFloorPercent: "9.99" })),
    /between 10% and 100%/,
  );
  assert.throws(
    () => buildReviewFrequencySelection(selection, form({ mode: "fixed", fixedPercent: "0" })),
    /between 0.01% and 100%/,
  );
  assert.throws(
    () => buildReviewFrequencySelection(selection, form({ mode: "fixed", fixedPercent: "12.345" })),
    /at most two decimal places/,
  );
  assert.throws(
    () => buildReviewFrequencySelection(selection, form({ mode: "fixed", maximumUnreviewedGap: "0" })),
    /between 1 and 10000/,
  );
  assert.throws(
    () =>
      buildReviewFrequencySelection(
        selection,
        form({ mode: "rules", requiredRiskTiers: "", minimumConfidencePercent: "" }),
      ),
    /at least one risk level or confidence condition/,
  );
  assert.throws(
    () => buildReviewFrequencySelection(selection, form({ mode: "rules", requiredRiskTiers: "High risk!" })),
    /comma-separated names/,
  );
});

test("saved frequency summaries preserve the exact visible mode", () => {
  assert.equal(reviewFrequencySummary({ ...selection, mode: "always" }), "Every eligible output");
  assert.equal(reviewFrequencySummary({ ...selection, mode: "manual" }), "Manual handoff only");
  assert.equal(
    reviewFrequencySummary({ ...selection, mode: "fixed", productionFloorBps: 0, fixedRateBps: 250 }),
    "2.5% of eligible outputs",
  );
  assert.equal(
    reviewFrequencySummary({ ...selection, mode: "rules", productionFloorBps: 0 }),
    "When risk or confidence conditions match",
  );
  assert.equal(reviewFrequencySummary(selection), "Adaptive review, at least 10%");
});
