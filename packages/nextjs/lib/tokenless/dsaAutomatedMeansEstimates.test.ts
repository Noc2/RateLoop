import { PINNED_DRAND_CHAINS } from "@rateloop/node-utils/drand";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type DsaAutomatedMeansEstimateInput,
  type DsaAutomatedMeansReferenceFact,
  estimateDsaAutomatedMeansMetrics,
  verifyDsaAutomatedMeansEstimate,
} from "~~/lib/tokenless/dsaAutomatedMeansEstimates";
import {
  REFERENCE_SAMPLE_PLAN_LIMITATIONS,
  type ReferenceFrameSourceBinding,
  type ReferenceFrameUnit,
  createReferenceFrameCommitment,
  freezeReferenceSample,
} from "~~/lib/tokenless/referenceSampling";

const chain = PINNED_DRAND_CHAINS["quicknet-t"];
const beacon = {
  network: "quicknet-t" as const,
  chainInfo: {
    public_key: chain.publicKey,
    period: chain.period,
    genesis_time: chain.genesisTime,
    hash: chain.chainHash,
    groupHash: chain.groupHash,
    schemeID: chain.schemeId,
    metadata: { beaconID: chain.beaconId },
  },
  evidence: {
    round: 1,
    randomness: "5c1dd096cd32cd272fcd2ad6e4d46d33713d16618ede11bae63da90edc3fbb1b",
    signature: "81d347e1c4be0e4277112de281d3a52aa1190bbd2f0ad7954e22799d168e61b60b4a0c46fc5a2777963cb739a0243e21",
  },
  expectedRound: 1,
};
const source: ReferenceFrameSourceBinding = {
  workspaceId: "ws_reference",
  projectId: "project_reference",
  benchmarkId: "benchmark_public_safe_1",
  activationReference: "activation_public_safe_1",
  deploymentKey: "deployment_tokenless_1",
  populationId: "population_reference_1",
  populationVersion: 1,
  populationContractHash: `sha256:${"0".repeat(64)}`,
  populationRoot: `sha256:${"1".repeat(64)}`,
  reportingWindow: { startInclusive: "2023-06-01T00:00:00.000Z", endExclusive: "2023-07-01T00:00:00.000Z" },
  populationCount: 7,
  eligibleDrawUnitCount: 5,
  uncertainAlwaysReviewCount: 1,
  excludedUnitCount: 1,
};
const witness = {
  kind: "database_transaction_and_attestation" as const,
  witnessId: "witness_frame_commit_1",
  sourceFrozenAt: "2023-07-01T00:00:00.000Z",
  committedAt: "2023-07-01T00:00:01.000Z",
  auditHeadDigest: `sha256:${"2".repeat(64)}` as const,
};
const frozenWitness = {
  kind: "database_transaction_and_attestation" as const,
  witnessId: "witness_sample_freeze_1",
  frozenAt: "2023-07-14T00:00:00.000Z",
  auditHeadDigest: `sha256:${"3".repeat(64)}` as const,
};
const classifier = { systemId: "classifier_safety", version: "v1", machineClass: "text_classifier" } as const;

function unit(character: string, automatedOutcome: "pass" | "fail", day: number): ReferenceFrameUnit {
  return {
    unitId: `rsu_${character.repeat(22)}`,
    sourceDecisionBinding: `sha256:${character.repeat(64)}` as `sha256:${string}`,
    decidedAt: `2023-06-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    automatedOutcome,
    referenceLabelState: "unlabeled",
  };
}

const units = [
  unit("a", "pass", 1),
  unit("b", "pass", 2),
  unit("c", "pass", 3),
  unit("d", "fail", 4),
  unit("e", "fail", 5),
];
const commitment = createReferenceFrameCommitment({
  frameId: "frame_public_benchmark_1",
  purpose: "public_safe_benchmark",
  source,
  witness,
  units,
  sampleSizes: { automated_pass: 2, automated_fail: 1 },
  sampleSizePlanId: "sample_plan_pilot_1",
  sampleSizePlanVersion: 1,
  beaconNetwork: "quicknet-t",
  beaconRound: 1,
});
const sample = freezeReferenceSample({ commitment, units, beacon, frozenWitness });

function digest(index: number) {
  return `sha256:${index.toString(16).padStart(64, "0")}` as const;
}

function facts(
  overrides: Readonly<
    Record<
      string,
      Partial<Pick<DsaAutomatedMeansReferenceFact, "languageCodes" | "referenceOutcome" | "referenceLabelBinding">>
    >
  > = {},
) {
  const references: Record<string, "pass" | "fail"> = { a: "pass", c: "fail", d: "fail" };
  const origins: Record<string, Pick<DsaAutomatedMeansReferenceFact, "origin" | "notifierClass">> = {
    a: { origin: "own_initiative", notifierClass: null },
    b: { origin: "own_initiative", notifierClass: null },
    c: { origin: "article16_notice", notifierClass: "trusted_flagger" },
    d: { origin: "article16_notice", notifierClass: "other" },
    e: { origin: "authority_order", notifierClass: null },
  };
  return units.map((frameUnit, index) => {
    const character = frameUnit.unitId.slice(4, 5);
    const selected = sample.manifest.find(row => row.unitId === frameUnit.unitId)!.selected;
    const referenceOutcome = selected ? references[character]! : null;
    return {
      unitId: frameUnit.unitId,
      sourceDecisionBinding: frameUnit.sourceDecisionBinding,
      sourceFactHash: digest(index + 10),
      classifier,
      languageCodes: ["en"] as const,
      ...origins[character]!,
      referenceOutcome,
      referenceLabelBinding: selected ? digest(index + 100) : null,
      ...overrides[character],
    } satisfies DsaAutomatedMeansReferenceFact;
  });
}

function input(overrides: Partial<DsaAutomatedMeansEstimateInput> = {}): DsaAutomatedMeansEstimateInput {
  return {
    providerType: "vlop",
    commitment,
    frameUnits: units,
    sample,
    beacon,
    frozenWitness,
    facts: facts(),
    ...overrides,
  };
}

test("computes exact witnessed point estimates while keeping publication blocked", () => {
  const result = estimateDsaAutomatedMeansMetrics(input({ providerType: "intermediary_service" }));
  const cells = Object.fromEntries(
    result.cells.filter(cell => cell.scope === "Total number").map(cell => [cell.metric, cell]),
  );
  assert.deepEqual(cells.accuracy?.result, {
    status: "internal_point_estimate",
    exactNumerator: "7",
    exactDenominator: "10",
    decimal: "0.7",
    interval: null,
    publicationEligible: false,
  });
  assert.deepEqual(cells.precision?.result, {
    status: "internal_point_estimate",
    exactNumerator: "1",
    exactDenominator: "1",
    decimal: "1",
    interval: null,
    publicationEligible: false,
  });
  assert.deepEqual(cells.recall?.result, {
    status: "internal_point_estimate",
    exactNumerator: "4",
    exactDenominator: "7",
    decimal: "0.57142857",
    interval: null,
    publicationEligible: false,
  });
  assert.deepEqual(cells.accuracy?.weightedConfusion, {
    truePositive: "2/1",
    falsePositive: "0/1",
    trueNegative: "3/2",
    falseNegative: "3/2",
  });
  assert.deepEqual(result.publication, {
    eligible: false,
    block: "pending_external_method_review",
    requiredContext: [
      "input_criteria",
      "calculation_methodology",
      "reference_standard",
      "positive_class_automatically_removed_content",
      "uncertainty_and_coverage_gaps",
    ],
  });
  assert.equal(result.frame.sampleSizePlan.methodReviewStatus, "pending_external_method_review");
  assert.deepEqual(result.cells[0]?.limitations, REFERENCE_SAMPLE_PLAN_LIMITATIONS);
});

test("emits only the official scopes applicable to each provider type", () => {
  const expected = {
    intermediary_service: ["Own-initiative", "Total number"],
    hosting_service: ["NAM Total", "Own-initiative", "Total number"],
    online_platform: ["NAM Total", "NAM Trusted Flagger", "Own-initiative", "Total number"],
    vlop: [
      "NAM Total",
      "NAM Trusted Flagger",
      "Own-initiative",
      "Total number",
      ...[
        "bg",
        "cs",
        "da",
        "de",
        "el",
        "en",
        "es",
        "et",
        "fi",
        "fr",
        "ga",
        "hr",
        "hu",
        "it",
        "lt",
        "lv",
        "mt",
        "nl",
        "pl",
        "pt",
        "ro",
        "sk",
        "sl",
        "sv",
      ],
    ].sort(),
    vlose: ["Own-initiative", "Total number"],
  } as const;
  for (const providerType of Object.keys(expected) as Array<keyof typeof expected>) {
    const scopes = [
      ...new Set(estimateDsaAutomatedMeansMetrics(input({ providerType })).cells.map(cell => cell.scope)),
    ].sort();
    assert.deepEqual(scopes, [...expected[providerType]]);
  }
});

test("assigns origin, notice, trusted-flagger, multi-language, and no-language units to exact scopes", () => {
  const result = estimateDsaAutomatedMeansMetrics(
    input({
      facts: facts({
        a: { languageCodes: ["de", "en"] },
        b: { languageCodes: ["de"] },
        c: { languageCodes: ["en"] },
        d: { languageCodes: [] },
        e: { languageCodes: ["de"] },
      }),
    }),
  );
  const accuracy = Object.fromEntries(
    result.cells.filter(cell => cell.metric === "accuracy").map(cell => [cell.scope, cell]),
  );
  assert.deepEqual(
    Object.fromEntries(
      ["Total number", "Own-initiative", "NAM Total", "NAM Trusted Flagger", "de", "en"].map(scope => [
        scope,
        {
          population: accuracy[scope]?.populationCount,
          selected: accuracy[scope]?.selectedCount,
          confusion: accuracy[scope]?.weightedConfusion,
        },
      ]),
    ),
    {
      "Total number": {
        population: 5,
        selected: 3,
        confusion: { truePositive: "2/1", falsePositive: "0/1", trueNegative: "3/2", falseNegative: "3/2" },
      },
      "Own-initiative": {
        population: 2,
        selected: 1,
        confusion: { truePositive: "0/1", falsePositive: "0/1", trueNegative: "3/2", falseNegative: "0/1" },
      },
      "NAM Total": {
        population: 2,
        selected: 2,
        confusion: { truePositive: "2/1", falsePositive: "0/1", trueNegative: "0/1", falseNegative: "3/2" },
      },
      "NAM Trusted Flagger": {
        population: 1,
        selected: 1,
        confusion: { truePositive: "0/1", falsePositive: "0/1", trueNegative: "0/1", falseNegative: "3/2" },
      },
      de: {
        population: 3,
        selected: 1,
        confusion: { truePositive: "0/1", falsePositive: "0/1", trueNegative: "3/2", falseNegative: "0/1" },
      },
      en: {
        population: 2,
        selected: 2,
        confusion: { truePositive: "0/1", falsePositive: "0/1", trueNegative: "3/2", falseNegative: "3/2" },
      },
    },
  );
  assert.deepEqual(accuracy.de?.result, {
    status: "internal_point_estimate",
    exactNumerator: "1",
    exactDenominator: "2",
    decimal: "0.5",
    interval: null,
    publicationEligible: false,
  });
});

test("returns typed gaps for unsampled, unfinished, empty, and zero-denominator domains", () => {
  const unsampled = estimateDsaAutomatedMeansMetrics(
    input({
      facts: facts({
        a: { languageCodes: [] },
        b: { languageCodes: ["de"] },
        c: { languageCodes: [] },
        d: { languageCodes: [] },
        e: { languageCodes: [] },
      }),
    }),
  );
  assert.deepEqual(unsampled.cells.find(cell => cell.scope === "de" && cell.metric === "accuracy")?.result, {
    status: "coverage_gap",
    code: "no_selected_reference_units",
    value: null,
    publicationEligible: false,
  });
  assert.deepEqual(unsampled.cells.find(cell => cell.scope === "fr" && cell.metric === "accuracy")?.result, {
    status: "coverage_gap",
    code: "empty_scope",
    value: null,
    publicationEligible: false,
  });

  const unfinished = estimateDsaAutomatedMeansMetrics(
    input({ facts: facts({ a: { referenceOutcome: "uncertain" } }) }),
  );
  assert.deepEqual(
    unfinished.cells.find(cell => cell.scope === "Own-initiative" && cell.metric === "accuracy")?.result,
    {
      status: "coverage_gap",
      code: "no_completed_reference_units",
      value: null,
      publicationEligible: false,
    },
  );
  assert.deepEqual(unfinished.cells.find(cell => cell.scope === "Total number" && cell.metric === "accuracy")?.result, {
    status: "coverage_gap",
    code: "missing_selected_reference_outcome",
    value: null,
    publicationEligible: false,
  });

  const noPredictedRemoval = estimateDsaAutomatedMeansMetrics(
    input({ facts: facts({ d: { referenceOutcome: "pass" } }) }),
  );
  assert.deepEqual(
    noPredictedRemoval.cells.find(cell => cell.scope === "NAM Trusted Flagger" && cell.metric === "precision")?.result,
    {
      status: "coverage_gap",
      code: "zero_denominator",
      value: null,
      publicationEligible: false,
    },
  );
});

test("rejects sample, probability, membership, fact, and label substitutions", () => {
  const first = sample.manifest[0]!;
  const tamperedSamples = [
    {
      ...sample,
      manifest: sample.manifest.map((row, index) => (index === 0 ? { ...row, selected: !row.selected } : row)),
    },
    {
      ...sample,
      manifest: sample.manifest.map((row, index) =>
        index === 0 ? { ...row, inclusionProbability: { numerator: 1, denominator: 1 } } : row,
      ),
    },
    { ...sample, manifest: sample.manifest.slice(1) },
    { ...sample, sampleDigest: digest(999) },
  ];
  for (const tampered of tamperedSamples) {
    assert.throws(() => estimateDsaAutomatedMeansMetrics(input({ sample: tampered })), /verification failed/u);
  }
  assert.throws(
    () => estimateDsaAutomatedMeansMetrics(input({ facts: facts().slice(1) })),
    /complete verified sample/u,
  );
  assert.throws(
    () =>
      estimateDsaAutomatedMeansMetrics(
        input({
          facts: facts().map((fact, index) => (index === 0 ? { ...fact, sourceDecisionBinding: digest(998) } : fact)),
        }),
      ),
    /match every verified sample/u,
  );
  assert.throws(
    () =>
      estimateDsaAutomatedMeansMetrics(
        input({
          facts: facts().map((fact, index) =>
            index === 0 ? { ...fact, classifier: { ...classifier, machineClass: "free_form" as never } } : fact,
          ),
        }),
      ),
    /reference facts/u,
  );
  assert.equal(first.inclusionProbability.denominator > 0, true);
});

test("binds the complete label manifest and verifies a stable, replay-resistant artifact", () => {
  const result = estimateDsaAutomatedMeansMetrics(input());
  const reordered = estimateDsaAutomatedMeansMetrics(input({ facts: [...facts()].reverse() }));
  assert.equal(reordered.referenceLabelRoot, result.referenceLabelRoot);
  assert.equal(reordered.estimateDigest, result.estimateDigest);
  assert.deepEqual(verifyDsaAutomatedMeansEstimate({ ...input(), expected: result }), result);
  assert.throws(
    () => verifyDsaAutomatedMeansEstimate({ ...input(), expected: { ...result, referenceLabelRoot: digest(997) } }),
    /verification failed/u,
  );
  const replayCommitment = createReferenceFrameCommitment({
    frameId: "frame_dsa_estimate_replay",
    purpose: "dsa_reference",
    source,
    witness,
    units,
    sampleSizes: { automated_pass: 2, automated_fail: 1 },
    sampleSizePlanId: "sample_plan_dsa_pilot_1",
    sampleSizePlanVersion: 1,
    beaconNetwork: "quicknet-t",
    beaconRound: 1,
  });
  assert.throws(
    () => estimateDsaAutomatedMeansMetrics(input({ commitment: replayCommitment })),
    /commitment|verification failed/u,
  );
});
