export function roundAt(timestamp, genesisTime, period) {
  if (period <= 0n || timestamp < genesisTime) return 0n;
  return (timestamp - genesisTime) / period + 1n;
}

export function roundAtOrAfter(timestamp, genesisTime, period) {
  if (period <= 0n || timestamp < genesisTime) return 0n;
  const elapsed = timestamp - genesisTime;
  return (elapsed + period - 1n) / period + 1n;
}

export function computeCommitRevealableAfter(
  timestamp,
  activeRoundStartTime,
  epochDuration,
) {
  const roundStartTime = activeRoundStartTime ?? timestamp;
  const elapsed = timestamp > roundStartTime ? timestamp - roundStartTime : 0n;
  const epochIndex = elapsed / epochDuration;
  return roundStartTime + (epochIndex + 1n) * epochDuration;
}

export function deriveTlockCommitTargetRound({
  commitTimestamp,
  activeRoundStartTime = null,
  epochDuration,
  drandGenesisTime,
  drandPeriod,
}) {
  if (epochDuration <= 0n) {
    throw new Error("Round epochDuration must be greater than zero");
  }
  if (drandPeriod <= 0n) {
    throw new Error("drandPeriod must be greater than zero");
  }

  const revealableAfter = computeCommitRevealableAfter(
    commitTimestamp,
    activeRoundStartTime,
    epochDuration,
  );
  if (revealableAfter < drandGenesisTime) {
    throw new Error(
      `Revealable timestamp ${revealableAfter} is before drand genesis ${drandGenesisTime}`,
    );
  }

  const minTargetRound = roundAtOrAfter(
    revealableAfter,
    drandGenesisTime,
    drandPeriod,
  );
  const maxTargetRound = roundAt(
    revealableAfter + 2n * drandPeriod,
    drandGenesisTime,
    drandPeriod,
  );

  if (
    minTargetRound === 0n ||
    maxTargetRound === 0n ||
    minTargetRound > maxTargetRound
  ) {
    throw new Error(
      `No valid drand target round for revealableAfter=${revealableAfter}, genesis=${drandGenesisTime}, period=${drandPeriod}`,
    );
  }

  return maxTargetRound;
}
