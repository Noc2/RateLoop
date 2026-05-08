import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStakeAmountWei,
  buildCommitPredictionParams,
  generateVoteSalt,
  resolveFrontendCode,
} from "./vote";

test("vote helpers normalize stake amounts and frontend defaults", () => {
  assert.equal(buildStakeAmountWei(2.5), 2_500_000n);
  assert.equal(
    resolveFrontendCode(undefined, "0x1111111111111111111111111111111111111111"),
    "0x1111111111111111111111111111111111111111",
  );
  assert.equal(resolveFrontendCode(undefined, undefined), "0x0000000000000000000000000000000000000000");
});

test("generateVoteSalt accepts an injected random source", () => {
  const salt = generateVoteSalt(bytes => bytes.fill(0xab));
  assert.equal(salt, `0x${"ab".repeat(32)}`);
});

test("buildCommitPredictionParams returns opinion and crowd prediction commit metadata", async () => {
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
    encryptFn: async () => "FAKE-PREDICTION-ARMORED-AGE-STRING",
  };

  const result = await buildCommitPredictionParams({
    voter: "0x1111111111111111111111111111111111111111",
    chainId: 31337n,
    engineAddress: "0x2222222222222222222222222222222222222222",
    contentId: 42n,
    opinionRating: 7.25,
    predictedCrowdRating: 6.9,
    stakeAmount: 2.5,
    epochDuration: 1200,
    roundId: 1n,
    roundReferenceRatingBps: 5_000,
    runtime,
  });

  assert.equal(result.opinionRatingBps, 7_250);
  assert.equal(result.predictedCrowdRatingBps, 6_900);
  assert.equal(result.predictedRatingBps, 6_900);
  assert.equal(result.rating, 7.25);
  assert.equal(result.crowdRating, 6.9);
  assert.equal(result.targetRound > 0n, true);
  assert.equal(result.roundId, 1n);
  assert.equal(result.drandChainHash, `0x${"ab".repeat(32)}`);
  assert.equal(result.frontend, "0x0000000000000000000000000000000000000000");
});
