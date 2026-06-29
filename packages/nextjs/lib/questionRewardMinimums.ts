export const REWARD_POOL_EFFECTIVE_UNIT_SCALE = 10_000n;
const CONTENT_REGISTRY_MIN_SUBMISSION_REWARD_SETTLED_ROUNDS = 1n;

type RewardCoverageMinimumParams = {
  maxVoters: bigint;
  requiredVoters: bigint;
};

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

export function getSubmissionRewardCoverageMinimum({ maxVoters, requiredVoters }: RewardCoverageMinimumParams): bigint {
  const cappedParticipants = maxBigInt(maxVoters, requiredVoters);

  // Reward pools fund the creation-anchored round at the escrow's effective-participant scale.
  return cappedParticipants * REWARD_POOL_EFFECTIVE_UNIT_SCALE;
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
