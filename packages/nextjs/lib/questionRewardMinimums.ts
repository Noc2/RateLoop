export const REWARD_POOL_EFFECTIVE_UNIT_SCALE = 10_000n;
const CONTENT_REGISTRY_MIN_SUBMISSION_REWARD_SETTLED_ROUNDS = 1n;

type RewardCoverageMinimumParams = {
  maxVoters: bigint;
  requiredSettledRounds: bigint;
  requiredVoters: bigint;
};

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

export function getSubmissionRewardCoverageMinimum({
  maxVoters,
  requiredSettledRounds,
  requiredVoters,
}: RewardCoverageMinimumParams): bigint {
  const cappedParticipants = maxBigInt(maxVoters, requiredVoters);

  // Reward pools require enough atomic units for every possible voter at the escrow's
  // effective-participant scale. This applies to both single-question and bundle pools.
  return cappedParticipants * requiredSettledRounds * REWARD_POOL_EFFECTIVE_UNIT_SCALE;
}

export function getContentRegistrySubmissionRewardMinimum({
  configuredMinimum,
  defaultMaxVoters,
}: {
  configuredMinimum: bigint;
  defaultMaxVoters: bigint;
}): bigint {
  const turnoutMinimum =
    defaultMaxVoters * CONTENT_REGISTRY_MIN_SUBMISSION_REWARD_SETTLED_ROUNDS * REWARD_POOL_EFFECTIVE_UNIT_SCALE;

  return maxBigInt(configuredMinimum, turnoutMinimum);
}
