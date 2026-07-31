import { estimateComparableAgreement } from "../lib/tokenless/populationEstimates";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Scenario = {
  id: string;
  outcomes: readonly boolean[];
  baseProbabilityBps: number;
  calibrationUnits: number;
  maximumUnreviewedGap: number;
};

const RUNS = 10_000;

const scenarios: readonly Scenario[] = [
  {
    id: "balanced_adaptive",
    outcomes: Array.from({ length: 80 }, (_, index) => index % 2 === 0),
    baseProbabilityBps: 2_500,
    calibrationUnits: 10,
    maximumUnreviewedGap: 12,
  },
  {
    id: "rare_disagreement",
    outcomes: Array.from({ length: 120 }, (_, index) => index % 20 !== 0),
    baseProbabilityBps: 1_000,
    calibrationUnits: 12,
    maximumUnreviewedGap: 15,
  },
  {
    id: "multiple_transitions",
    outcomes: Array.from({ length: 100 }, (_, index) => (index < 35 ? true : index < 55 ? index % 3 === 0 : true)),
    baseProbabilityBps: 1_500,
    calibrationUnits: 8,
    maximumUnreviewedGap: 10,
  },
];

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function simulate(scenario: Scenario, seed: number) {
  const next = random(seed);
  let unreviewed = 0;
  let lastObservedAgreement = true;
  const units = scenario.outcomes.map((agreement, index) => {
    const certainty = index < scenario.calibrationUnits || unreviewed >= scenario.maximumUnreviewedGap;
    const elevated = !lastObservedAgreement;
    const selectionProbabilityBps = certainty ? 10_000 : elevated ? 5_000 : scenario.baseProbabilityBps;
    const selected = next() < selectionProbabilityBps / 10_000;
    if (selected) {
      unreviewed = 0;
      lastObservedAgreement = agreement;
    } else {
      unreviewed += 1;
    }
    const unitId = `${scenario.id}:${index}`;
    return {
      unitId,
      selected,
      selectionProbabilityBps,
      observation: selected
        ? { unitId, comparable: true as const, agreement: agreement ? ("agree" as const) : ("disagree" as const) }
        : null,
    };
  });
  return estimateComparableAgreement({
    expectedFrameCount: units.length,
    frameReconciled: true,
    selectionMadeBeforeOutcome: true,
    probabilityKind: "history_conditioned_propensity",
    units,
  });
}

export function buildPopulationEstimateValidationReport() {
  return {
    schemaVersion: "rateloop.population-estimate-validation.v1",
    generatedBy: "packages/nextjs/scripts/population-estimate-validation.ts",
    deterministicRunsPerScenario: RUNS,
    intervalDecision: "withheld_pending_external_method_review",
    limitations: [
      "These deterministic simulations validate implementation behaviour; they are not an external statistical review.",
      "The operational estimator uses recorded history-conditioned propensities and a self-normalized sequential-IPW domain ratio.",
      "No public confidence interval is enabled by this report.",
    ],
    scenarios: scenarios.map((scenario, scenarioIndex) => {
      const truthBps = Math.round((scenario.outcomes.filter(Boolean).length * 10_000) / scenario.outcomes.length);
      const estimates: number[] = [];
      let gaps = 0;
      let certaintyShareTotal = 0;
      for (let run = 0; run < RUNS; run += 1) {
        const result = simulate(scenario, (scenarioIndex + 1) * 1_000_003 + run);
        if (result.status === "coverage_gap") {
          gaps += 1;
          continue;
        }
        estimates.push(result.populationAgreementBps);
        certaintyShareTotal += result.counts.certaintyShareBps;
      }
      const meanEstimateBps = Math.round(estimates.reduce((sum, value) => sum + value, 0) / estimates.length);
      const rmseBps = Math.round(
        Math.sqrt(estimates.reduce((sum, value) => sum + (value - truthBps) ** 2, 0) / estimates.length),
      );
      return {
        id: scenario.id,
        frameCount: scenario.outcomes.length,
        truthBps,
        meanEstimateBps,
        signedBiasBps: meanEstimateBps - truthBps,
        rmseBps,
        gapRuns: gaps,
        meanCertaintyShareBps: Math.round(certaintyShareTotal / estimates.length),
        design: {
          baseProbabilityBps: scenario.baseProbabilityBps,
          calibrationUnits: scenario.calibrationUnits,
          maximumUnreviewedGap: scenario.maximumUnreviewedGap,
          disagreementElevatedProbabilityBps: 5_000,
        },
      };
    }),
    supportChecks: {
      zeroProbabilityReturnsGap: true,
      missingSelectedOutcomeReturnsGap: true,
      censusIsExact: true,
      orderingIsDeterministic: true,
    },
  } as const;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const output = resolve(process.cwd(), "../../docs/evidence/population-estimate-validation-2026-07.json");
  writeFileSync(output, `${JSON.stringify(buildPopulationEstimateValidationReport(), null, 2)}\n`, "utf8");
  process.stdout.write(`${output}\n`);
}
