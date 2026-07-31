import { validateDrandBeaconEvidence } from "../../../keeper/src/drand";
import { deriveTokenlessReferenceSampleSeed, verifyTokenlessReferenceSampleBeacon } from "./referenceSamplingBeacon";
import { PINNED_DRAND_CHAINS } from "@rateloop/node-utils/drand";
import assert from "node:assert/strict";
import test from "node:test";

const chain = PINNED_DRAND_CHAINS["quicknet-t"];
const chainInfo = {
  public_key: chain.publicKey,
  period: chain.period,
  genesis_time: chain.genesisTime,
  hash: chain.chainHash,
  groupHash: chain.groupHash,
  schemeID: chain.schemeId,
  metadata: { beaconID: chain.beaconId },
};
const evidence = {
  round: 1,
  randomness: "5c1dd096cd32cd272fcd2ad6e4d46d33713d16618ede11bae63da90edc3fbb1b",
  signature: "81d347e1c4be0e4277112de281d3a52aa1190bbd2f0ad7954e22799d168e61b60b4a0c46fc5a2777963cb739a0243e21",
};

test("keeper and Next.js consumers accept the same pinned live golden vector", () => {
  const keeper = validateDrandBeaconEvidence(evidence, 1);
  const nextjs = verifyTokenlessReferenceSampleBeacon({
    network: "quicknet-t",
    chainInfo,
    evidence,
    expectedRound: 1,
  });
  assert.equal(keeper.randomness, nextjs.randomness);
  assert.equal(keeper.proof, nextjs.signature);
  assert.equal(
    deriveTokenlessReferenceSampleSeed({
      network: "quicknet-t",
      chainInfo,
      evidence,
      expectedRound: 1,
      frameDigest: `sha256:${"11".repeat(32)}`,
      samplingMethod: "uniform-without-replacement-v1",
    }),
    "sha256:9da5f1d9e7f89fe924adb8adc5f4f0ea7de5ca4ddc69a218f762cda294bf5404",
  );
});

test("both consumers reject a hash-consistent forgery and Next binds network and round", () => {
  const forged = {
    ...evidence,
    signature: `${evidence.signature.slice(0, -2)}20`,
    randomness: "00b1c1cd81cb978576a9090f49671ca7777af72da2d301e3acf121094c14be60",
  };
  assert.throws(() => validateDrandBeaconEvidence(forged, 1), /BLS signature does not verify/u);
  assert.throws(
    () =>
      verifyTokenlessReferenceSampleBeacon({
        network: "quicknet-t",
        chainInfo,
        evidence: forged,
        expectedRound: 1,
      }),
    /BLS signature does not verify/u,
  );
  assert.throws(
    () =>
      verifyTokenlessReferenceSampleBeacon({
        network: "quicknet",
        chainInfo,
        evidence,
        expectedRound: 1,
      }),
    /does not match pinned network quicknet/u,
  );
  assert.throws(
    () =>
      verifyTokenlessReferenceSampleBeacon({
        network: "quicknet-t",
        chainInfo,
        evidence,
        expectedRound: 2,
      }),
    /frozen round/u,
  );
});

test("reference-sample frame and method are domain-separated", () => {
  const base = {
    network: "quicknet-t" as const,
    chainInfo,
    evidence,
    expectedRound: 1,
    frameDigest: "11".repeat(32),
    samplingMethod: "uniform-without-replacement-v1",
  };
  const seed = deriveTokenlessReferenceSampleSeed(base);
  assert.notEqual(
    deriveTokenlessReferenceSampleSeed({
      ...base,
      frameDigest: "22".repeat(32),
    }),
    seed,
  );
  assert.notEqual(
    deriveTokenlessReferenceSampleSeed({
      ...base,
      samplingMethod: "stratified-v1",
    }),
    seed,
  );
});
