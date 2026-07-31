import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "@noble/hashes/sha256";
import {
  PINNED_DRAND_CHAINS,
  deriveReferenceSampleSeed,
  verifyDrandBeaconEvidence,
  type DrandBeaconEvidence,
  type DrandChainInfo,
  type PinnedDrandChain,
} from "./drand";

const QUICKNET_T_ROUND_1: DrandBeaconEvidence = {
  round: 1,
  randomness:
    "5c1dd096cd32cd272fcd2ad6e4d46d33713d16618ede11bae63da90edc3fbb1b",
  signature:
    "81d347e1c4be0e4277112de281d3a52aa1190bbd2f0ad7954e22799d168e61b60b4a0c46fc5a2777963cb739a0243e21",
};

const QUICKNET_T_ROUND_12345678: DrandBeaconEvidence = {
  round: 12_345_678,
  randomness:
    "c8788d522aa63a9fd2e715499097597dc94f33ee2bd0f78c5367e11ce825227b",
  signature:
    "b40845f2ae971025215f599b8af346bf329129d1d5ee416665472f91050acb3ecd31ee878033ba14842d4367010e1964",
};

function chainInfo(chain: PinnedDrandChain): DrandChainInfo {
  return {
    public_key: chain.publicKey,
    period: chain.period,
    genesis_time: chain.genesisTime,
    hash: chain.chainHash,
    groupHash: chain.groupHash,
    schemeID: chain.schemeId,
    metadata: { beaconID: chain.beaconId },
  };
}

function sha256Hex(value: string) {
  return Buffer.from(sha256(Buffer.from(value, "hex"))).toString("hex");
}

test("live quicknet-t golden vectors require valid BLS signatures on the frozen network and round", () => {
  const chain = PINNED_DRAND_CHAINS["quicknet-t"];
  for (const beacon of [QUICKNET_T_ROUND_1, QUICKNET_T_ROUND_12345678]) {
    const verified = verifyDrandBeaconEvidence({
      chain,
      chainInfo: chainInfo(chain),
      beacon,
      expectedRound: beacon.round,
    });
    assert.equal(verified.round, beacon.round);
    assert.equal(verified.randomness, `0x${beacon.randomness}`);
    assert.equal(verified.signature, `0x${beacon.signature}`);
  }

  const changedSignature = `${QUICKNET_T_ROUND_1.signature.slice(0, -2)}20`;
  assert.throws(
    () =>
      verifyDrandBeaconEvidence({
        chain,
        chainInfo: chainInfo(chain),
        beacon: {
          ...QUICKNET_T_ROUND_1,
          signature: changedSignature,
          randomness: sha256Hex(changedSignature),
        },
        expectedRound: 1,
      }),
    /BLS signature does not verify/u,
  );
  assert.throws(
    () =>
      verifyDrandBeaconEvidence({
        chain,
        chainInfo: chainInfo(chain),
        beacon: QUICKNET_T_ROUND_1,
        expectedRound: 2,
      }),
    /frozen round/u,
  );
});

test("verification binds every pinned chain-info field", () => {
  const chain = PINNED_DRAND_CHAINS["quicknet-t"];
  const exact = chainInfo(chain);
  const alterations: DrandChainInfo[] = [
    { ...exact, hash: "00".repeat(32) },
    { ...exact, public_key: `${exact.public_key.slice(0, -2)}00` },
    { ...exact, schemeID: "bls-unchained-on-g1" },
    { ...exact, genesis_time: exact.genesis_time + 1 },
    { ...exact, period: exact.period + 1 },
    { ...exact, groupHash: "00".repeat(32) },
    { ...exact, metadata: { beaconID: "another-network" } },
  ];
  for (const altered of alterations) {
    assert.throws(
      () =>
        verifyDrandBeaconEvidence({
          chain,
          chainInfo: altered,
          beacon: QUICKNET_T_ROUND_1,
          expectedRound: 1,
        }),
      /does not match pinned network/u,
    );
  }
});

test("reference-sample seed has a stable domain-separated golden vector", () => {
  const chain = PINNED_DRAND_CHAINS["quicknet-t"];
  const input = {
    chain,
    chainInfo: chainInfo(chain),
    beacon: QUICKNET_T_ROUND_1,
    expectedRound: 1,
    frameDigest: `sha256:${"11".repeat(32)}`,
    samplingMethod: "uniform-without-replacement-v1",
  } as const;
  const seed = deriveReferenceSampleSeed(input);
  assert.equal(
    seed,
    "sha256:9da5f1d9e7f89fe924adb8adc5f4f0ea7de5ca4ddc69a218f762cda294bf5404",
  );
  assert.notEqual(
    deriveReferenceSampleSeed({ ...input, frameDigest: "22".repeat(32) }),
    seed,
  );
  assert.notEqual(
    deriveReferenceSampleSeed({ ...input, samplingMethod: "stratified-v1" }),
    seed,
  );
  assert.notEqual(
    deriveReferenceSampleSeed({
      ...input,
      beacon: QUICKNET_T_ROUND_12345678,
      expectedRound: QUICKNET_T_ROUND_12345678.round,
    }),
    seed,
  );
  assert.notEqual(
    deriveReferenceSampleSeed({
      ...input,
      chain: { ...chain, networkId: "quicknet-t-other-purpose" },
    }),
    seed,
  );
});

test("chained golden vector signs and seeds the previous signature", () => {
  const chain: PinnedDrandChain = {
    networkId: "synthetic-chained-golden",
    chainHash: "aa".repeat(32),
    publicKey:
      "b928f3beb93519eecf0145da903b40a4c97dca00b21f12ac0df3be9116ef2ef27b2ae6bcd4c5bc2d54ef5a70627efcb7",
    schemeId: "pedersen-bls-chained",
    genesisTime: 1_700_000_000,
    period: 30,
    groupHash: "bb".repeat(32),
    beaconId: "synthetic-chained",
  };
  const beacon: DrandBeaconEvidence = {
    round: 42,
    randomness:
      "18e30ec7cd4d00a2cadcaa9786e01797d83b294bb757685e36fcd383c210be76",
    signature:
      "a149447e3a8a215c09a0aca4d96809b05de93819bae01e62098897a58d6f928fba6afdc5e0a4b21c3eef15fdf2caad0c1229f914b2d0357f8d14d8e4ce6dbdca4535e1534237d0a795d9a152fe90ea96184d088508cf2e6967dd46fe652b2d05",
    previous_signature:
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f",
  };
  const input = {
    chain,
    chainInfo: chainInfo(chain),
    beacon,
    expectedRound: 42,
    frameDigest: "22".repeat(32),
    samplingMethod: "stratified-audit-v1",
  } as const;
  assert.equal(
    deriveReferenceSampleSeed(input),
    "sha256:71d1365eaca8c8f7cf651c654420ed98baf2dbb52e5d8d6cf0ab6017ea16c044",
  );
  assert.throws(
    () =>
      verifyDrandBeaconEvidence({
        ...input,
        beacon: {
          ...beacon,
          previous_signature: `${beacon.previous_signature!.slice(0, -2)}00`,
        },
      }),
    /BLS signature does not verify/u,
  );
  assert.throws(
    () =>
      verifyDrandBeaconEvidence({
        chain,
        chainInfo: chainInfo(chain),
        beacon: { ...beacon, previous_signature: undefined },
        expectedRound: 42,
      }),
    /missing its previous signature/u,
  );
});
