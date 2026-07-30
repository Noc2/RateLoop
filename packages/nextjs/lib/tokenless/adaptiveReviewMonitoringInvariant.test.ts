import assert from "node:assert/strict";
import test from "node:test";
import { reviewPolicyCopy } from "~~/components/tokenless/agents/reviewPolicyCopy";
import {
  buildReviewFrequencySelection,
  reviewFrequencyFormValues,
  reviewFrequencySummary,
} from "~~/components/tokenless/agents/setup/reviewFrequency";
import { ADAPTIVE_MONITORING_FLOOR_BPS, adaptiveReviewRateBps } from "~~/lib/tokenless/adaptiveReviewPolicy";
import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

const selection: AgentSetupReviewDraft["selection"] = {
  mode: "adaptive",
  enforcementMode: "advisory",
  agreementThresholdBps: 8_000,
  productionFloorBps: ADAPTIVE_MONITORING_FLOOR_BPS,
  fixedRateBps: null,
  maximumUnreviewedGap: 20,
  requiredRiskTiers: ["high"],
  criticalRiskTiers: ["critical"],
  minimumConfidenceBps: 7_000,
  maximumLatencyMs: 120_000,
};

test("runtime, setup values, summaries, and owner copy share the 10% monitoring invariant", () => {
  assert.equal(adaptiveReviewRateBps("monitoring", 0), ADAPTIVE_MONITORING_FLOOR_BPS);
  assert.equal(reviewFrequencyFormValues(null).adaptiveFloorPercent, "10");
  assert.equal(reviewFrequencyFormValues(selection).adaptiveFloorPercent, "10");
  assert.equal(reviewFrequencySummary(selection), "Adaptive review, at least 10%");
  assert.equal(
    buildReviewFrequencySelection(selection, {
      ...reviewFrequencyFormValues(selection),
      adaptiveFloorPercent: "99",
    }).productionFloorBps,
    ADAPTIVE_MONITORING_FLOOR_BPS,
  );
  assert.match(reviewPolicyCopy.limits.adaptiveConnectionHelp, /never drops below 10%/u);
  assert.match(reviewPolicyCopy.limits.adaptiveDetail, /50%, 25%, and 10%/u);
});
