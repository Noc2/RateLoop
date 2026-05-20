import test from "node:test";
import assert from "node:assert/strict";

import {
  computeCommitRevealableAfter,
  deriveTlockCommitTargetRound,
  roundAt,
  roundAtOrAfter,
} from "./tlockTargetRound.js";

const DRAND_GENESIS_TIME = 1_692_803_367n;
const DRAND_PERIOD = 3n;
const EPOCH_DURATION = 1_200n;

function assertTargetRoundValid(commitTimestamp, targetRound) {
  const revealableAfter = commitTimestamp + EPOCH_DURATION;
  const minTargetRound = roundAtOrAfter(
    revealableAfter,
    DRAND_GENESIS_TIME,
    DRAND_PERIOD
  );
  const maxTargetRound = roundAt(
    revealableAfter + 2n * DRAND_PERIOD,
    DRAND_GENESIS_TIME,
    DRAND_PERIOD
  );

  assert.equal(targetRound >= minTargetRound, true);
  assert.equal(targetRound <= maxTargetRound, true);
}

test("deriveTlockCommitTargetRound uses the scheduled commit timestamp", () => {
  const commitTimestamp = 1_778_908_601n;
  const targetRound = deriveTlockCommitTargetRound({
    commitTimestamp,
    epochDuration: EPOCH_DURATION,
    drandGenesisTime: DRAND_GENESIS_TIME,
    drandPeriod: DRAND_PERIOD,
  });

  assert.equal(targetRound, 28_702_147n);
  assertTargetRoundValid(commitTimestamp, targetRound);
});

test("deriveTlockCommitTargetRound anchors active rounds to the round start", () => {
  const activeRoundStartTime = 1_778_908_602n;
  const commitTimestamp = activeRoundStartTime + 42n;
  const targetRound = deriveTlockCommitTargetRound({
    commitTimestamp,
    activeRoundStartTime,
    epochDuration: EPOCH_DURATION,
    drandGenesisTime: DRAND_GENESIS_TIME,
    drandPeriod: DRAND_PERIOD,
  });

  assert.equal(
    computeCommitRevealableAfter(
      commitTimestamp,
      activeRoundStartTime,
      EPOCH_DURATION
    ),
    activeRoundStartTime + EPOCH_DURATION
  );
  assert.equal(targetRound, 28_702_148n);
});
