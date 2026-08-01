import { PINNED_DRAND_CHAINS } from "@rateloop/node-utils/drand";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REFERENCE_SAMPLING_METHOD_VERSION,
  type ReferenceFrameSourceBinding,
  type ReferenceFrameUnit,
  __referenceSamplingTestUtils,
  createReferenceFrameCommitment,
  deriveReferenceSystemIdentity,
  freezeReferenceSample,
  verifyFrozenReferenceSample,
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
  contextAuthority: "workspace_manager_asserted_context",
  populationId: "population_reference_1",
  populationVersion: 1,
  populationContractHash: `sha256:${"0".repeat(64)}`,
  populationRoot: `sha256:${"1".repeat(64)}`,
  populationFrozenAt: "2023-07-01T00:00:00.000Z",
  reportingWindow: { startInclusive: "2023-06-01T00:00:00.000Z", endExclusive: "2023-07-01T00:00:00.000Z" },
  populationCount: 6,
  eligibleDrawUnitCount: 5,
  evaluatedDecisionCount: 4,
  notAutomatedDecisionCount: 1,
  excludedDecisionCount: 1,
};
const witness = {
  kind: "database_transaction_and_attestation" as const,
  witnessId: "witness_frame_commit_1",
  sourceFrozenAt: "2023-07-01T00:00:01.000Z",
  committedAt: "2023-07-01T00:00:01.000Z",
  auditHeadDigest: `sha256:${"2".repeat(64)}` as const,
};
const frozenWitness = {
  kind: "database_transaction_and_attestation" as const,
  witnessId: "witness_sample_freeze_1",
  frozenAt: "2023-07-14T00:00:00.000Z",
  auditHeadDigest: `sha256:${"3".repeat(64)}` as const,
};

function unit(
  character: string,
  outcome: "pass" | "fail",
  day: number,
  systemId: "system_alpha" | "system_beta",
  sourceDecisionCharacter = character,
): ReferenceFrameUnit {
  const systemVersion = systemId === "system_alpha" ? "1.0.0" : "2023.06";
  return {
    unitId: `rsu_${character.repeat(22)}`,
    sourceDecisionBinding: `sha256:${sourceDecisionCharacter.repeat(64)}`,
    sourceEvaluationBinding: `sha256:${character.repeat(64)}`,
    sourceEvaluationHash: `sha256:${character.repeat(64)}`,
    decidedAt: `2023-06-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    automationProcessing: character === "e" ? "partially_automated" : "solely_automated",
    systemIdentity: deriveReferenceSystemIdentity({ systemId, systemVersion }),
    systemId,
    systemVersion,
    machineClass: systemId === "system_alpha" ? "text_classifier" : "rules_engine",
    publicDesignation: systemId === "system_alpha" ? "Alpha text moderation" : "Beta policy rules",
    automatedOutcome: outcome,
    referenceLabelState: "unlabeled",
  };
}

const units = [
  unit("a", "pass", 1, "system_alpha", "a"),
  unit("b", "pass", 1, "system_alpha", "a"),
  unit("c", "fail", 3, "system_alpha"),
  unit("d", "pass", 4, "system_beta"),
  unit("e", "fail", 5, "system_beta"),
];
const sampleSizes = [
  { systemId: "system_alpha", systemVersion: "1.0.0", automatedFail: 1, automatedPass: 1 },
  { systemId: "system_beta", systemVersion: "2023.06", automatedFail: 1, automatedPass: 1 },
];

function commitment(input: { units?: readonly ReferenceFrameUnit[]; source?: ReferenceFrameSourceBinding } = {}) {
  return createReferenceFrameCommitment({
    frameId: "frame_public_benchmark_1",
    purpose: "public_safe_benchmark",
    source: input.source ?? source,
    witness,
    units: input.units ?? units,
    sampleSizes,
    sampleSizePlanId: "sample_plan_pilot_1",
    sampleSizePlanVersion: 1,
    beaconNetwork: "quicknet-t",
    beaconRound: 1,
  });
}

test("binds complete decision/evaluation scope and per-system outcome strata", () => {
  const frame = commitment();
  assert.equal(frame.source.populationCount, 6);
  assert.equal(frame.source.eligibleDrawUnitCount, 5);
  assert.equal(frame.source.evaluatedDecisionCount, 4);
  assert.equal(frame.source.notAutomatedDecisionCount, 1);
  assert.equal(frame.methodVersion, REFERENCE_SAMPLING_METHOD_VERSION);
  assert.equal(frame.strata.length, 4);
  for (const systemId of ["system_alpha", "system_beta"]) {
    const cells = frame.strata.filter(row => row.systemId === systemId);
    assert.deepEqual(cells.map(row => row.automatedOutcome).sort(), ["fail", "pass"]);
    assert.ok(cells.every(row => row.sampleSize === 1 && row.gap === null));
  }
  const changed = commitment({ source: { ...source, evaluatedDecisionCount: 5, notAutomatedDecisionCount: 0 } });
  assert.notEqual(changed.commitmentDigest, frame.commitmentDigest);

  const availableAt = __referenceSamplingTestUtils.roundAvailabilityMilliseconds("quicknet-t", 1);
  const tooLate = new Date(Number(availableAt - 60_000n)).toISOString();
  assert.throws(
    () =>
      createReferenceFrameCommitment({
        frameId: "frame_late",
        purpose: "dsa_reference",
        source,
        witness: { ...witness, sourceFrozenAt: tooLate, committedAt: tooLate },
        units,
        sampleSizes,
        sampleSizePlanId: "sample_plan_pilot_1",
        sampleSizePlanVersion: 1,
        beaconNetwork: "quicknet-t",
        beaconRound: 1,
      }),
    /at least five minutes/u,
  );
});

test("freezes exact per-system draws with manifest-level inclusion probabilities", () => {
  const frame = commitment();
  const frozen = freezeReferenceSample({ commitment: frame, units: [...units].reverse(), beacon, frozenWitness });
  assert.equal(frozen.manifest.filter(row => row.selected).length, 4);
  assert.ok(frozen.manifest.every(row => row.systemIdentity === deriveReferenceSystemIdentity(row)));
  for (const row of frozen.manifest) {
    const eligible = units.filter(
      unit => unit.systemIdentity === row.systemIdentity && unit.automatedOutcome === row.automatedOutcome,
    ).length;
    assert.deepEqual(row.inclusionProbability, { numerator: 1, denominator: eligible });
  }
  const repeated = freezeReferenceSample({ commitment: frame, units, beacon, frozenWitness });
  assert.deepEqual(repeated, frozen);
  assert.deepEqual(
    verifyFrozenReferenceSample({ expected: frozen, commitment: frame, units, beacon, frozenWitness }),
    frozen,
  );
});

test("frame, system, source, round, and frozen-manifest substitutions fail closed", () => {
  const frame = commitment();
  const frozen = freezeReferenceSample({ commitment: frame, units, beacon, frozenWitness });
  assert.throws(
    () => freezeReferenceSample({ commitment: frame, units: units.slice(1), beacon, frozenWitness }),
    /source binding is invalid|commitment is invalid|does not match/u,
  );
  assert.throws(
    () => commitment({ units: [{ ...units[0]!, systemId: "system_other" }, ...units.slice(1)] }),
    /system identity is invalid|exact pre-label/u,
  );
  assert.throws(
    () => commitment({ units: [{ ...units[0]!, publicDesignation: '=HYPERLINK("bad")' }, ...units.slice(1)] }),
    /exact pre-label/u,
  );
  assert.throws(
    () => freezeReferenceSample({ commitment: frame, units, beacon: { ...beacon, expectedRound: 2 }, frozenWitness }),
    /committed network and round/u,
  );
  assert.throws(
    () =>
      verifyFrozenReferenceSample({
        expected: { ...frozen, manifest: frozen.manifest.slice(1) },
        commitment: frame,
        units,
        beacon,
        frozenWitness,
      }),
    /verification failed/u,
  );
});

test("multiple evaluations per decision are allowed while evaluation and system cells stay exact", () => {
  assert.equal(units[0]!.sourceDecisionBinding, units[1]!.sourceDecisionBinding);
  assert.doesNotThrow(() => commitment());
  assert.throws(() => commitment({ units: [units[0]!, units[0]!] }), /only once/u);
  assert.throws(
    () =>
      commitment({
        units: [
          units[0]!,
          { ...units[1]!, sourceEvaluationBinding: units[0]!.sourceEvaluationBinding },
          ...units.slice(2),
        ],
      }),
    /source evaluation may bind only one/u,
  );
  assert.throws(
    () =>
      createReferenceFrameCommitment({
        frameId: "frame_zero_probability",
        purpose: "dsa_reference",
        source,
        witness,
        units,
        sampleSizes: [{ ...sampleSizes[0]!, automatedPass: 0 }, sampleSizes[1]!],
        sampleSizePlanId: "sample_plan_pilot_1",
        sampleSizePlanVersion: 1,
        beaconNetwork: "quicknet-t",
        beaconRound: 1,
      }),
    /positive sample/u,
  );

  const passOnlyUnits = units.filter(row => row.systemId === "system_alpha" && row.automatedOutcome === "pass");
  const passOnly = createReferenceFrameCommitment({
    frameId: "frame_absent_fail",
    purpose: "dsa_reference",
    source: {
      ...source,
      populationCount: 3,
      eligibleDrawUnitCount: 2,
      evaluatedDecisionCount: 1,
      notAutomatedDecisionCount: 1,
      excludedDecisionCount: 1,
    },
    witness,
    units: passOnlyUnits,
    sampleSizes: [{ systemId: "system_alpha", systemVersion: "1.0.0", automatedFail: 0, automatedPass: 1 }],
    sampleSizePlanId: "sample_plan_pilot_1",
    sampleSizePlanVersion: 1,
    beaconNetwork: "quicknet-t",
    beaconRound: 1,
  });
  assert.deepEqual(
    passOnly.strata.find(row => row.automatedOutcome === "fail"),
    {
      systemIdentity: deriveReferenceSystemIdentity({ systemId: "system_alpha", systemVersion: "1.0.0" }),
      systemId: "system_alpha",
      systemVersion: "1.0.0",
      automatedOutcome: "fail",
      eligibleCount: 0,
      sampleSize: 0,
      gap: "absent_stratum",
    },
  );
});
