import assert from "node:assert/strict";
import { test } from "node:test";
import {
  POPULATION_ESTIMATE_GAP_CODES,
  type PopulationEstimateInput,
  estimateComparableAgreement,
} from "~~/lib/tokenless/populationEstimates";

function estimate(overrides: Partial<PopulationEstimateInput> = {}) {
  return estimateComparableAgreement({
    expectedFrameCount: 3,
    frameReconciled: true,
    selectionMadeBeforeOutcome: true,
    probabilityKind: "history_conditioned_propensity",
    units: [
      {
        unitId: "certain-agree",
        selected: true,
        selectionProbabilityBps: 10_000,
        observation: { unitId: "certain-agree", comparable: true, agreement: "agree" },
      },
      {
        unitId: "rare-disagree",
        selected: true,
        selectionProbabilityBps: 1_000,
        observation: { unitId: "rare-disagree", comparable: true, agreement: "disagree" },
      },
      {
        unitId: "not-selected",
        selected: false,
        selectionProbabilityBps: 5_000,
        observation: null,
      },
    ],
    ...overrides,
  });
}

test("uses a weighted comparable-domain ratio instead of HT divided by frame N", () => {
  const result = estimate();
  assert.equal(result.status, "estimable");
  if (result.status !== "estimable") return;
  assert.equal(result.sampledAgreementBps, 5_000);
  assert.equal(result.weightedAgreementTotal, 1);
  assert.equal(result.weightedComparableTotal, 11);
  assert.equal(result.populationAgreementBps, 909);
  assert.deepEqual(result.uncertainty, {
    method: "withheld_pending_design_review",
    lowerBps: null,
    upperBps: null,
  });
});

test("a full census is exact and has zero sampling uncertainty", () => {
  const result = estimateComparableAgreement({
    expectedFrameCount: 3,
    frameReconciled: true,
    selectionMadeBeforeOutcome: true,
    probabilityKind: "first_order_inclusion",
    units: ["agree", "agree", "disagree"].map((agreement, index) => ({
      unitId: `unit-${index}`,
      selected: true,
      selectionProbabilityBps: 10_000,
      observation: {
        unitId: `unit-${index}`,
        comparable: true,
        agreement: agreement as "agree" | "disagree",
      },
    })),
  });
  assert.equal(result.status, "estimable");
  if (result.status !== "estimable") return;
  assert.equal(result.populationAgreementBps, 6_667);
  assert.equal(result.counts.certaintyShareBps, 10_000);
  assert.deepEqual(result.uncertainty, { method: "census_exact", lowerBps: 6_667, upperBps: 6_667 });
});

test("returns named coverage gaps for every unsupported frame condition", () => {
  const cases: Array<[string, PopulationEstimateInput]> = [
    ["empty_frame", { ...estimateInput(), expectedFrameCount: 0, units: [] }],
    ["frame_size_mismatch", { ...estimateInput(), expectedFrameCount: 99 }],
    ["frame_not_reconciled", { ...estimateInput(), frameReconciled: false }],
    ["selection_not_pre_outcome", { ...estimateInput(), selectionMadeBeforeOutcome: false }],
    [
      "duplicate_unit",
      {
        ...estimateInput(),
        expectedFrameCount: 2,
        units: [estimateInput().units[0]!, estimateInput().units[0]!],
      },
    ],
    [
      "invalid_selection_probability",
      { ...estimateInput(), units: [{ ...estimateInput().units[0]!, selectionProbabilityBps: null }] },
    ],
    [
      "zero_selection_probability",
      { ...estimateInput(), units: [{ ...estimateInput().units[0]!, selectionProbabilityBps: 0 }] },
    ],
    ["selected_outcome_missing", { ...estimateInput(), units: [{ ...estimateInput().units[0]!, observation: null }] }],
    [
      "outcome_binding_mismatch",
      {
        ...estimateInput(),
        units: [
          {
            ...estimateInput().units[0]!,
            observation: { unitId: "different", comparable: true, agreement: "agree" },
          },
        ],
      },
    ],
    ["unselected_outcome_present", { ...estimateInput(), units: [{ ...estimateInput().units[0]!, selected: false }] }],
    [
      "no_comparable_outcomes",
      {
        ...estimateInput(),
        units: [
          {
            ...estimateInput().units[0]!,
            observation: { unitId: "unit", comparable: false, agreement: "uncertain" },
          },
        ],
      },
    ],
  ];
  assert.deepEqual(
    cases.map(([expected, input]) => {
      const result = estimateComparableAgreement(input);
      assert.equal(result.status, "coverage_gap");
      assert.equal(result.gap, expected);
      assert.doesNotMatch(JSON.stringify(result), /NaN|Infinity/u);
      return result.gap;
    }),
    [...POPULATION_ESTIMATE_GAP_CODES],
  );
});

test("is deterministic and invariant to frame ordering", () => {
  const input = estimateInput();
  assert.deepEqual(
    estimateComparableAgreement(input),
    estimateComparableAgreement({ ...input, units: [...input.units].reverse() }),
  );
});

function estimateInput(): PopulationEstimateInput {
  return {
    expectedFrameCount: 1,
    frameReconciled: true,
    selectionMadeBeforeOutcome: true,
    probabilityKind: "first_order_inclusion",
    units: [
      {
        unitId: "unit",
        selected: true,
        selectionProbabilityBps: 10_000,
        observation: { unitId: "unit", comparable: true, agreement: "agree" },
      },
    ],
  };
}
