export type DeploymentDefinitions = Record<number, Record<string, unknown> | undefined>;

const REQUIRED_TARGET_CONTRACTS = [
  "LoopReputation",
  "FrontendRegistry",
  "ProfileRegistry",
  "ContentRegistry",
  "RoundVotingEngine",
  "ProtocolConfig",
  "RoundRewardDistributor",
  "CategoryRegistry",
  "ParticipationPool",
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
      .filter(contractName => {
        if (chainDeployments[contractName] !== undefined) return false;
        return contractName !== "LoopReputation" || chainDeployments.HumanReputation === undefined;
      })
      .map(contractName => `${chainId}:${contractName}`);
  });
}
