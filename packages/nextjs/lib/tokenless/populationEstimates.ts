export const POPULATION_ESTIMATE_SCHEMA_VERSION = "rateloop.population-estimate.v1" as const;

export const POPULATION_ESTIMATE_GAP_CODES = [
  "empty_frame",
  "frame_size_mismatch",
  "frame_not_reconciled",
  "selection_not_pre_outcome",
  "duplicate_unit",
  "invalid_selection_probability",
  "zero_selection_probability",
  "selected_outcome_missing",
  "outcome_binding_mismatch",
  "unselected_outcome_present",
  "no_comparable_outcomes",
] as const;

export type PopulationEstimateGapCode = (typeof POPULATION_ESTIMATE_GAP_CODES)[number];

export type PopulationFrameUnit = {
  unitId: string;
  selected: boolean;
  selectionProbabilityBps: number | null;
  observation: null | {
    unitId: string;
    comparable: boolean;
    agreement: "agree" | "disagree" | "uncertain";
  };
};

export type PopulationEstimateInput = {
  expectedFrameCount: number;
  frameReconciled: boolean;
  selectionMadeBeforeOutcome: boolean;
  probabilityKind: "first_order_inclusion" | "history_conditioned_propensity";
  units: readonly PopulationFrameUnit[];
};

export type OperationalCoverageDecision = {
  opportunityId: string;
  decision: string;
  selectionProbabilityBps: number | null;
};

export type OperationalCoverageObservation = {
  opportunityId: string;
  comparable: boolean;
  agreement: string;
};

type PopulationEstimateCounts = {
  frame: number;
  selected: number;
  completed: number;
  comparable: number;
  agreements: number;
  certaintyUnits: number;
  certaintyShareBps: number;
};

export type PopulationEstimate =
  | {
      schemaVersion: typeof POPULATION_ESTIMATE_SCHEMA_VERSION;
      estimand: "comparable_agreement_domain_ratio";
      status: "coverage_gap";
      gap: PopulationEstimateGapCode;
      counts: PopulationEstimateCounts;
    }
  | {
      schemaVersion: typeof POPULATION_ESTIMATE_SCHEMA_VERSION;
      estimand: "comparable_agreement_domain_ratio";
      status: "estimable";
      gap: null;
      counts: PopulationEstimateCounts;
      probabilityKind: PopulationEstimateInput["probabilityKind"];
      sampledAgreementBps: number;
      populationAgreementBps: number;
      weightedComparableTotal: number;
      weightedAgreementTotal: number;
      uncertainty:
        | { method: "census_exact"; lowerBps: number; upperBps: number }
        | { method: "withheld_pending_design_review"; lowerBps: null; upperBps: null };
    };

function roundBps(numerator: number, denominator: number) {
  return Math.max(0, Math.min(10_000, Math.round((numerator * 10_000) / denominator)));
}

function finiteWeight(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(8)) : value;
}

function baseCounts(units: readonly PopulationFrameUnit[]): PopulationEstimateCounts {
  const selected = units.filter(unit => unit.selected).length;
  const completed = units.filter(unit => unit.selected && unit.observation !== null).length;
  const comparable = units.filter(unit => unit.selected && unit.observation?.comparable === true).length;
  const agreements = units.filter(
    unit => unit.selected && unit.observation?.comparable === true && unit.observation.agreement === "agree",
  ).length;
  const certaintyUnits = units.filter(unit => unit.selectionProbabilityBps === 10_000).length;
  return {
    frame: units.length,
    selected,
    completed,
    comparable,
    agreements,
    certaintyUnits,
    certaintyShareBps: units.length === 0 ? 0 : roundBps(certaintyUnits, units.length),
  };
}

function gap(units: readonly PopulationFrameUnit[], code: PopulationEstimateGapCode): PopulationEstimate {
  return {
    schemaVersion: POPULATION_ESTIMATE_SCHEMA_VERSION,
    estimand: "comparable_agreement_domain_ratio",
    status: "coverage_gap",
    gap: code,
    counts: baseCounts(units),
  };
}

/**
 * Estimates agreement among comparable frame units as a design-weighted domain
 * ratio. This is deliberately not labelled a Horvitz-Thompson mean: both the
 * numerator and the comparable-domain denominator are estimated totals.
 *
 * The function exposes a point estimate only when every in-scope unit has a
 * known positive first-order inclusion probability or recorded conditional
 * selection propensity and every selected unit has its bound outcome. The
 * self-normalized sequential-IPW interpretation is explicit for adaptive
 * propensities. It withholds a confidence interval until the selection design's
 * joint inclusion/dependence assumptions have been reviewed.
 */
export function estimateComparableAgreement(input: PopulationEstimateInput): PopulationEstimate {
  const units = [...input.units];
  if (units.length === 0) return gap(units, "empty_frame");
  if (!Number.isSafeInteger(input.expectedFrameCount) || input.expectedFrameCount !== units.length) {
    return gap(units, "frame_size_mismatch");
  }
  if (!input.frameReconciled) return gap(units, "frame_not_reconciled");
  if (!input.selectionMadeBeforeOutcome) return gap(units, "selection_not_pre_outcome");

  const unitIds = new Set<string>();
  for (const unit of units) {
    if (!unit.unitId || unitIds.has(unit.unitId)) return gap(units, "duplicate_unit");
    unitIds.add(unit.unitId);
    if (
      unit.selectionProbabilityBps === null ||
      !Number.isSafeInteger(unit.selectionProbabilityBps) ||
      unit.selectionProbabilityBps < 0 ||
      unit.selectionProbabilityBps > 10_000
    ) {
      return gap(units, "invalid_selection_probability");
    }
    if (unit.selectionProbabilityBps === 0) return gap(units, "zero_selection_probability");
    if (unit.selected && unit.observation === null) return gap(units, "selected_outcome_missing");
    if (unit.observation && unit.observation.unitId !== unit.unitId) return gap(units, "outcome_binding_mismatch");
    if (!unit.selected && unit.observation !== null) return gap(units, "unselected_outcome_present");
  }

  let weightedComparableTotal = 0;
  let weightedAgreementTotal = 0;
  for (const unit of units) {
    if (!unit.selected || !unit.observation?.comparable) continue;
    const weight = 10_000 / unit.selectionProbabilityBps!;
    weightedComparableTotal += weight;
    if (unit.observation.agreement === "agree") weightedAgreementTotal += weight;
  }
  if (weightedComparableTotal === 0) return gap(units, "no_comparable_outcomes");

  const counts = baseCounts(units);
  const populationAgreementBps = roundBps(weightedAgreementTotal, weightedComparableTotal);
  const census = units.every(
    unit => unit.selected && unit.selectionProbabilityBps === 10_000 && unit.observation !== null,
  );
  return {
    schemaVersion: POPULATION_ESTIMATE_SCHEMA_VERSION,
    estimand: "comparable_agreement_domain_ratio",
    status: "estimable",
    gap: null,
    counts,
    probabilityKind: input.probabilityKind,
    sampledAgreementBps: roundBps(counts.agreements, counts.comparable),
    populationAgreementBps,
    weightedComparableTotal: finiteWeight(weightedComparableTotal),
    weightedAgreementTotal: finiteWeight(weightedAgreementTotal),
    uncertainty: census
      ? { method: "census_exact", lowerBps: populationAgreementBps, upperBps: populationAgreementBps }
      : { method: "withheld_pending_design_review", lowerBps: null, upperBps: null },
  };
}

/**
 * Keeps the operational opportunity/observation projection identical across
 * exports and authenticated dashboard views. Operational adaptive decisions
 * record predictable, history-conditioned propensities rather than fixed
 * first-order inclusion probabilities.
 */
export function estimateOperationalComparableAgreement(input: {
  decisions: readonly OperationalCoverageDecision[];
  observations: readonly OperationalCoverageObservation[];
}): PopulationEstimate {
  const observationsByOpportunity = new Map(
    input.observations.map(observation => [observation.opportunityId, observation] as const),
  );
  return estimateComparableAgreement({
    expectedFrameCount: input.decisions.length,
    frameReconciled: true,
    selectionMadeBeforeOutcome: true,
    probabilityKind: "history_conditioned_propensity",
    units: input.decisions.map(decision => {
      const observation = observationsByOpportunity.get(decision.opportunityId);
      return {
        unitId: decision.opportunityId,
        selected: decision.decision === "required",
        selectionProbabilityBps: decision.selectionProbabilityBps,
        observation: observation
          ? {
              unitId: observation.opportunityId,
              comparable: observation.comparable,
              agreement:
                observation.agreement === "agree" || observation.agreement === "disagree"
                  ? observation.agreement
                  : ("uncertain" as const),
            }
          : null,
      };
    }),
  });
}
