import { isAddress, zeroAddress } from "viem";

type ChainDeploymentDefinitions = Record<string, unknown>;
type DeploymentDefinitions = Record<number, ChainDeploymentDefinitions | undefined>;

export const RATELOOP_DEPLOYMENT_METADATA_KEY = "__rateloopDeployment";
export const TOKENLESS_DEPLOYMENT_SCHEMA_VERSION = "tokenless-v1";

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

const REQUIRED_TOKENLESS_TARGET_CONTRACTS = ["TokenlessPanel", "CredentialIssuer", "USDC"] as const;
const OPTIONAL_TOKENLESS_TARGET_CONTRACTS = ["X402PanelSubmitter"] as const;
const ALLOWED_TOKENLESS_TARGET_ENTRIES = new Set<string>([
  RATELOOP_DEPLOYMENT_METADATA_KEY,
  ...REQUIRED_TOKENLESS_TARGET_CONTRACTS,
  ...OPTIONAL_TOKENLESS_TARGET_CONTRACTS,
]);

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

function readDeploymentSchemaVersion(chainDeployments: ChainDeploymentDefinitions): string | null {
  const metadata = chainDeployments[RATELOOP_DEPLOYMENT_METADATA_KEY];
  if (!metadata || typeof metadata !== "object") return null;

  const schemaVersion = (metadata as { schemaVersion?: unknown }).schemaVersion;
  return typeof schemaVersion === "string" && schemaVersion.trim() ? schemaVersion.trim() : null;
}

/**
 * Validates generated deployment definitions without allowing a mixed legacy/tokenless bundle to look healthy.
 * Unversioned bundles retain the legacy contract requirements until the mainnet cutover. A tokenless bundle must
 * opt in with `__rateloopDeployment.schemaVersion = "tokenless-v1"` and may contain only the greenfield core,
 * its optional stateless x402 adapter, and the configured USDC deployment entry.
 */
export function listTargetDeploymentIssues(
  chainIds: readonly number[],
  deploymentsByChain: DeploymentDefinitions,
): string[] {
  return chainIds.flatMap(chainId => {
    const chainDeployments = deploymentsByChain[chainId];
    if (!chainDeployments) return [];

    const schemaVersion = readDeploymentSchemaVersion(chainDeployments);
    if (schemaVersion === null) {
      return listMissingRequiredTargetContracts([chainId], deploymentsByChain);
    }

    if (schemaVersion !== TOKENLESS_DEPLOYMENT_SCHEMA_VERSION) {
      return [`${chainId}:unsupported-schema:${schemaVersion}`];
    }

    const issues = REQUIRED_TOKENLESS_TARGET_CONTRACTS.filter(
      contractName => !hasValidDeploymentAddress(chainDeployments[contractName]),
    ).map(contractName => `${chainId}:missing:${contractName}`);

    for (const contractName of OPTIONAL_TOKENLESS_TARGET_CONTRACTS) {
      if (contractName in chainDeployments && !hasValidDeploymentAddress(chainDeployments[contractName])) {
        issues.push(`${chainId}:invalid:${contractName}`);
      }
    }

    for (const entryName of Object.keys(chainDeployments)) {
      if (!ALLOWED_TOKENLESS_TARGET_ENTRIES.has(entryName)) {
        issues.push(`${chainId}:unexpected:${entryName}`);
      }
    }

    return issues;
  });
}
