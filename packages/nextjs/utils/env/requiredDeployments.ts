import { isAddress, zeroAddress } from "viem";

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
  "FeedbackBonusEscrow",
  "FeedbackRegistry",
  "ConfidentialityEscrow",
  "ClusterPayoutOracle",
  "X402QuestionSubmitter",
] as const;

function hasValidDeploymentAddress(deployment: unknown): boolean {
  if (!deployment || typeof deployment !== "object") return false;

  const address = (deployment as { address?: unknown }).address;
  return typeof address === "string" && isAddress(address) && address.toLowerCase() !== zeroAddress;
}

export function listMissingRequiredTargetContracts(
  chainIds: readonly number[],
  deploymentsByChain: DeploymentDefinitions,
  requiredContracts: readonly string[] = REQUIRED_TARGET_CONTRACTS,
): string[] {
  return chainIds.flatMap(chainId => {
    const chainDeployments = deploymentsByChain[chainId];
    if (!chainDeployments) return [];

    return requiredContracts
      .filter(contractName => !hasValidDeploymentAddress(chainDeployments[contractName]))
      .map(contractName => `${chainId}:${contractName}`);
  });
}
