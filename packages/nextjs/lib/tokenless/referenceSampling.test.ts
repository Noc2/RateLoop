import { PINNED_DRAND_CHAINS } from "@rateloop/node-utils/drand";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REFERENCE_SAMPLING_METHOD_VERSION,
  type ReferenceFrameSourceBinding,
  type ReferenceFrameUnit,
  __referenceSamplingTestUtils,
  createReferenceFrameCommitment,
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

function unit(character: string, outcome: "pass" | "fail", day: number): ReferenceFrameUnit {
  return {
    unitId: `rsu_${character.repeat(22)}`,
    sourceDecisionBinding: `sha256:${character.toLowerCase().repeat(64)}` as `sha256:${string}`,
    decidedAt: `2023-06-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    automatedOutcome: outcome,
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

function commitment(input: { units?: readonly ReferenceFrameUnit[]; source?: ReferenceFrameSourceBinding } = {}) {
  return createReferenceFrameCommitment({
    frameId: "frame_public_benchmark_1",
    purpose: "public_safe_benchmark",
    source: input.source ?? source,
    witness,
    units: input.units ?? units,
    sampleSizes: { automated_pass: 2, automated_fail: 1 },
    sampleSizePlanId: "sample_plan_pilot_1",
    sampleSizePlanVersion: 1,
    beaconNetwork: "quicknet-t",
    beaconRound: 1,
  });
}

test("binds the complete source scope and requires an attested five-minute beacon lead", () => {
  const frame = commitment();
  assert.equal(frame.source.populationCount, 7);
  assert.equal(frame.source.eligibleDrawUnitCount, 5);
  assert.equal(frame.methodVersion, REFERENCE_SAMPLING_METHOD_VERSION);
  assert.deepEqual(frame.strata, [
    { stratum: "automated_fail", eligibleCount: 2, sampleSize: 1, gap: null },
    { stratum: "automated_pass", eligibleCount: 3, sampleSize: 2, gap: null },
  ]);
  const availableAt = __referenceSamplingTestUtils.roundAvailabilityMilliseconds("quicknet-t", 1);
  const tooLate = new Date(Number(availableAt - 60_000n)).toISOString();
  assert.throws(
    () =>
      createReferenceFrameCommitment({
        frameId: "frame_late",
        purpose: "dsa_reference",
        source,
        witness: { ...witness, committedAt: tooLate },
        units,
        sampleSizes: { automated_pass: 2, automated_fail: 1 },
        sampleSizePlanId: "sample_plan_pilot_1",
        sampleSizePlanVersion: 1,
        beaconNetwork: "quicknet-t",
        beaconRound: 1,
      }),
    /at least five minutes/u,
  );
});

test("freezes an exact stratified draw with rational inclusion probabilities", () => {
  const frame = commitment();
  const frozen = freezeReferenceSample({ commitment: frame, units: [...units].reverse(), beacon, frozenWitness });
  assert.deepEqual(frozen.strata, [
    { stratum: "automated_fail", eligibleCount: 2, selectedCount: 1, gap: null },
    { stratum: "automated_pass", eligibleCount: 3, selectedCount: 2, gap: null },
  ]);
  assert.equal(frozen.manifest.filter(row => row.selected).length, 3);
  assert.deepEqual(
    {
      frameRoot: frame.frameRoot,
      commitmentDigest: frame.commitmentDigest,
      seedDigest: frozen.seedDigest,
      selected: frozen.manifest.filter(row => row.selected).map(row => [row.unitId, row.selectionRank]),
      manifestRoot: frozen.manifestRoot,
      sampleDigest: frozen.sampleDigest,
    },
    {
      frameRoot: "sha256:3d384dd5a9bca434ba8756c5b62f48178922c95eac55f8b8caeefa4e741f9ccc",
      commitmentDigest: "sha256:e27155c28247ea0b8dd6b6364dfe353993001fb35f225da758d4da2424c2296e",
      seedDigest: "sha256:6b1b0a6c661e612e4e411b80c9be94900488f4ac10c2a58e7de1864bcf942975",
      selected: [
        ["rsu_aaaaaaaaaaaaaaaaaaaaaa", 1],
        ["rsu_cccccccccccccccccccccc", 2],
        ["rsu_dddddddddddddddddddddd", 1],
      ],
      manifestRoot: "sha256:6a81978ce2b8eaa8ebb7a5e2a7b77414c4143631407fd530ea4c8dcb7a945035",
      sampleDigest: "sha256:c55d45d37224e54925ee55c834e6b95bd05e29e982ed384af5f4c56ef192ffcf",
    },
  );
  for (const row of frozen.manifest) {
    assert.deepEqual(
      row.inclusionProbability,
      row.stratum === "automated_pass" ? { numerator: 2, denominator: 3 } : { numerator: 1, denominator: 2 },
    );
  }
  assert.deepEqual(
    verifyFrozenReferenceSample({ expected: frozen, commitment: frame, units, beacon, frozenWitness }),
    frozen,
  );
});

test("frame, source, method, round, and frozen-manifest substitutions fail closed", () => {
  const frame = commitment();
  const frozen = freezeReferenceSample({ commitment: frame, units, beacon, frozenWitness });
  assert.throws(
    () => freezeReferenceSample({ commitment: frame, units: units.slice(1), beacon, frozenWitness }),
    /source binding is invalid|commitment is invalid|does not match/u,
  );
  assert.throws(
    () =>
      freezeReferenceSample({
        commitment: { ...frame, methodVersion: "stratified-v2" as never },
        units,
        beacon,
        frozenWitness,
      }),
    /commitment is invalid/u,
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
  assert.throws(
    () =>
      verifyFrozenReferenceSample({
        expected: { ...frozen, seedDigest: `sha256:${"f".repeat(64)}` },
        commitment: frame,
        units,
        beacon,
        frozenWitness,
      }),
    /verification failed/u,
  );
});

test("exact unit projections, present-stratum probability, and explicit absent-stratum gaps are enforced", () => {
  assert.throws(() => commitment({ units: [units[0]!, units[0]!] }), /only once/u);
  assert.throws(
    () =>
      commitment({
        units: [units[0]!, { ...units[1]!, sourceDecisionBinding: units[0]!.sourceDecisionBinding }, ...units.slice(2)],
      }),
    /source decision may bind only one/u,
  );
  assert.throws(
    () => commitment({ units: [{ ...units[0]!, decidedAt: "2023-07-01T00:00:00.000Z" }, ...units.slice(1)] }),
    /inside the bound reporting window/u,
  );
  assert.throws(
    () =>
      createReferenceFrameCommitment({
        frameId: "frame_extra_field",
        purpose: "dsa_reference",
        source,
        witness,
        units: [{ ...units[0]!, referenceLabel: "pass" } as never, ...units.slice(1)],
        sampleSizes: { automated_pass: 2, automated_fail: 1 },
        sampleSizePlanId: "sample_plan_pilot_1",
        sampleSizePlanVersion: 1,
        beaconNetwork: "quicknet-t",
        beaconRound: 1,
      }),
    /exact pre-label source projection/u,
  );
  assert.throws(
    () =>
      createReferenceFrameCommitment({
        frameId: "frame_zero_probability",
        purpose: "dsa_reference",
        source,
        witness,
        units,
        sampleSizes: { automated_pass: 2, automated_fail: 0 },
        sampleSizePlanId: "sample_plan_pilot_1",
        sampleSizePlanVersion: 1,
        beaconNetwork: "quicknet-t",
        beaconRound: 1,
      }),
    /positive sample/u,
  );

  const passOnlyUnits = units.filter(row => row.automatedOutcome === "pass");
  const passOnlySource = {
    ...source,
    populationCount: 5,
    eligibleDrawUnitCount: 3,
  };
  const passOnly = createReferenceFrameCommitment({
    frameId: "frame_absent_fail",
    purpose: "dsa_reference",
    source: passOnlySource,
    witness,
    units: passOnlyUnits,
    sampleSizes: { automated_pass: 2, automated_fail: 0 },
    sampleSizePlanId: "sample_plan_pilot_1",
    sampleSizePlanVersion: 1,
    beaconNetwork: "quicknet-t",
    beaconRound: 1,
  });
  assert.deepEqual(passOnly.strata[0], {
    stratum: "automated_fail",
    eligibleCount: 0,
    sampleSize: 0,
    gap: "absent_stratum",
  });
});
