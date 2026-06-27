import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStakeAmountWei,
  buildCommitVoteParams,
  generateVoteSalt,
  resolveFrontendCode,
} from "./vote";

test("vote helpers normalize stake amounts and frontend defaults", () => {
  assert.equal(buildStakeAmountWei(2.5), 2_500_000n);
  assert.equal(buildStakeAmountWei(0.000001), 1n);
  assert.equal(buildStakeAmountWei(0), 0n);
  assert.equal(
    resolveFrontendCode(
      undefined,
      "0x1111111111111111111111111111111111111111",
    ),
    "0x1111111111111111111111111111111111111111",
  );
  assert.equal(
    resolveFrontendCode(undefined, undefined),
    "0x0000000000000000000000000000000000000000",
  );
});

test("vote helpers reject invalid stake display amounts", () => {
  assert.throws(() => buildStakeAmountWei(Number.NaN), /finite LREP display amount/);
  assert.throws(() => buildStakeAmountWei(Number.POSITIVE_INFINITY), /finite LREP display amount/);
  assert.throws(() => buildStakeAmountWei(-1), /non-negative/);
  assert.throws(() => buildStakeAmountWei(0.0000004), /0 or at least 0\.000001 LREP/);
  assert.throws(() => buildStakeAmountWei(1.0000004), /at most 6 decimal places/);
  assert.throws(() => buildStakeAmountWei(Number.MAX_SAFE_INTEGER), /too large/);
});

test("generateVoteSalt accepts an injected random source", () => {
  const salt = generateVoteSalt((bytes) => bytes.fill(0xab));
  assert.equal(salt, `0x${"ab".repeat(32)}`);
});

test("buildCommitVoteParams returns binary RBTS commit metadata", async () => {
  const runtime = {
    client: {
      chain: () => ({
        info: async () => ({
          period: 3,
          genesis_time: 1677685200,
          hash: "ab".repeat(32),
        }),
      }),
    } as any,
    now: () => 1677685200 * 1000,
    encryptFn: async () => "FAKE-RBTS-ARMORED-AGE-STRING",
  };

  const result = await buildCommitVoteParams({
    voter: "0x1111111111111111111111111111111111111111",
    contentId: 42n,
    isUp: true,
    predictedUpPercent: 69,
    stakeAmount: 2.5,
    epochDuration: 1200,
    roundId: 1n,
    roundReferenceRatingBps: 5_000,
    runtime,
  });

  assert.equal(result.isUp, true);
  assert.equal(result.predictedUpBps, 6_900);
  assert.equal(result.predictedUpPercent, 69);
  assert.equal(result.targetRound > 0n, true);
  assert.equal(result.roundId, 1n);
  assert.equal(result.drandChainHash, `0x${"ab".repeat(32)}`);
  assert.equal(result.stakeAtomicUnits, 2_500_000n);
  assert.equal(result.stakeWei, 2_500_000n);
  assert.equal(result.frontend, "0x0000000000000000000000000000000000000000");
});
