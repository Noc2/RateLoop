type DeploymentDefinitions = Record<number, Record<string, unknown> | undefined>;

const REQUIRED_TARGET_CONTRACTS = [
  "LoopReputation",
  "FrontendRegistry",
  "ProfileRegistry",
  "ContentRegistry",
  "RoundVotingEngine",
  "ProtocolConfig",
  "RoundRewardDistributor",
  "CategoryRegistry",
  "LaunchDistributionPool",
  "AdvisoryVoteRecorder",
  "RaterRegistry",
  "QuestionRewardPoolEscrow",
  "ClusterPayoutOracle",
  "X402QuestionSubmitter",
] as const;

export function listMissingRequiredTargetContracts(
  chainIds: readonly number[],
  deploymentsByChain: DeploymentDefinitions,
  requiredContracts: readonly string[] = REQUIRED_TARGET_CONTRACTS,
): string[] {
  return chainIds.flatMap(chainId => {
    const chainDeployments = deploymentsByChain[chainId];
    if (!chainDeployments) return [];

    return requiredContracts
      .filter(contractName => chainDeployments[contractName] === undefined)
      .map(contractName => `${chainId}:${contractName}`);
  });
}
