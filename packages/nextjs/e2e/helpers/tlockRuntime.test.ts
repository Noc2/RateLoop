import { deriveAcceptedTlockTargetRound, deriveKeeperDecryptWaitMs } from "./tlockRuntime";
import assert from "node:assert/strict";
import test from "node:test";

const DRAND_GENESIS_TIME_SECONDS = 1_692_803_367;
const DRAND_PERIOD_SECONDS = 3;

test("deriveAcceptedTlockTargetRound defaults to the full drand-period drift window", () => {
  const targetRound = deriveAcceptedTlockTargetRound({
    latestBlockTimestampSeconds: DRAND_GENESIS_TIME_SECONDS,
    roundEpochDurationSeconds: 1_200,
    drandGenesisTimeSeconds: DRAND_GENESIS_TIME_SECONDS,
    drandPeriodSeconds: DRAND_PERIOD_SECONDS,
  });

  assert.equal(targetRound, 403n);
});

test("deriveAcceptedTlockTargetRound shares a target across the formerly bad drift window", () => {
  const targetRound = deriveAcceptedTlockTargetRound({
    latestBlockTimestampSeconds: DRAND_GENESIS_TIME_SECONDS,
    roundEpochDurationSeconds: 1_199,
    drandGenesisTimeSeconds: DRAND_GENESIS_TIME_SECONDS,
    drandPeriodSeconds: DRAND_PERIOD_SECONDS,
  });

  assert.equal(targetRound, 402n);
});

test("deriveAcceptedTlockTargetRound rejects windows without a shared target", () => {
  assert.throws(
    () =>
      deriveAcceptedTlockTargetRound({
        latestBlockTimestampSeconds: DRAND_GENESIS_TIME_SECONDS,
        roundEpochDurationSeconds: 1_200,
        drandGenesisTimeSeconds: DRAND_GENESIS_TIME_SECONDS,
        drandPeriodSeconds: DRAND_PERIOD_SECONDS,
        candidateTimestampOffsetsSeconds: [0, 7],
      }),
    /No shared drand target round/,
  );
});

test("deriveKeeperDecryptWaitMs uses chain time for revealability and wall time for drand", () => {
  const waitMs = deriveKeeperDecryptWaitMs({
    wallClockNowSeconds: DRAND_GENESIS_TIME_SECONDS + 100,
    chainNowSeconds: DRAND_GENESIS_TIME_SECONDS + 10_000,
    revealableAfterSeconds: DRAND_GENESIS_TIME_SECONDS + 9_900,
    targetRound: 51n,
    drandGenesisTimeSeconds: DRAND_GENESIS_TIME_SECONDS,
    drandPeriodSeconds: DRAND_PERIOD_SECONDS,
  });

  assert.equal(waitMs, 50_000);
});

test("deriveKeeperDecryptWaitMs falls back to wall clock when chain time is omitted", () => {
  const waitMs = deriveKeeperDecryptWaitMs({
    wallClockNowSeconds: DRAND_GENESIS_TIME_SECONDS + 100,
    revealableAfterSeconds: DRAND_GENESIS_TIME_SECONDS + 130,
    targetRound: 1n,
    drandGenesisTimeSeconds: DRAND_GENESIS_TIME_SECONDS,
    drandPeriodSeconds: DRAND_PERIOD_SECONDS,
  });

  assert.equal(waitMs, 30_000);
});
