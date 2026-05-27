export const REWARD_POOL_EFFECTIVE_UNIT_SCALE = 10_000n;

type RewardCoverageMinimumParams = {
  maxVoters: bigint;
  questionCount: number;
  requiredSettledRounds: bigint;
  requiredVoters: bigint;
};

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

export function getSubmissionRewardCoverageMinimum({
  maxVoters,
  questionCount,
  requiredSettledRounds,
  requiredVoters,
}: RewardCoverageMinimumParams): bigint {
  const cappedParticipants = maxBigInt(maxVoters, requiredVoters);

  if (questionCount > 1) {
    return cappedParticipants * requiredSettledRounds;
  }

  // Single-question reward pools require enough atomic units for every possible voter at the
  // escrow's effective-participant scale.
  return cappedParticipants * requiredSettledRounds * REWARD_POOL_EFFECTIVE_UNIT_SCALE;
}
