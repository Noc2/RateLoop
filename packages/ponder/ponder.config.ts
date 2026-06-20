import { createConfig } from "ponder";
import { isAddress, zeroAddress } from "viem";

import {
  AdvisoryVoteRecorderAbi,
  CategoryRegistryAbi,
  ClusterPayoutOracleAbi,
  ConfidentialityEscrowAbi,
  ContentRegistryAbi,
  FeedbackRegistryAbi,
  LoopReputationAbi,
  FeedbackBonusEscrowAbi,
  FrontendRegistryAbi,
  LaunchDistributionPoolAbi,
  ProfileRegistryAbi,
  QuestionRewardPoolEscrowAbi,
  RaterRegistryAbi,
  RoundRewardDistributorAbi,
  RoundVotingEngineAbi,
} from "@rateloop/contracts/abis";
import {
  getSharedDeploymentAddress as getSharedArtifactAddress,
  getSharedDeploymentStartBlock as getSharedArtifactStartBlock,
} from "@rateloop/contracts/deployments";
import { httpWithGetLogsBlockRange } from "./src/rpcTransport";

type PonderNetworkName =
  | "baseSepolia"
  | "base"
  | "worldchainSepolia"
  | "hardhat"
  | "worldchain";

const isProduction = process.env.NODE_ENV === "production";

const NETWORKS: Record<
  PonderNetworkName,
  {
    chainId: number;
    defaultRpcUrl: string;
    maxGetLogsBlockRange?: number;
    pollingInterval: number;
  }
> = {
  baseSepolia: {
    chainId: 84532,
    defaultRpcUrl: "https://sepolia.base.org",
    maxGetLogsBlockRange: 1_000,
    pollingInterval: 5_000,
  },
  base: {
    chainId: 8453,
    defaultRpcUrl: "https://mainnet.base.org",
    maxGetLogsBlockRange: 1_000,
    pollingInterval: 5_000,
  },
  worldchainSepolia: {
    chainId: 4801,
    defaultRpcUrl: "https://worldchain-sepolia.g.alchemy.com/public",
    maxGetLogsBlockRange: 1_000,
    pollingInterval: 5_000,
  },
  hardhat: {
    chainId: 31337,
    defaultRpcUrl: "http://127.0.0.1:8545",
    pollingInterval: 1_000,
  },
  worldchain: {
    chainId: 480,
    defaultRpcUrl: "https://worldchain-mainnet.g.alchemy.com/public",
    maxGetLogsBlockRange: 1_000,
    pollingInterval: 5_000,
  },
};

const SUPPORTED_PONDER_NETWORKS = Object.keys(NETWORKS).join(", ");

function isPonderNetworkName(
  value: string | undefined,
): value is PonderNetworkName {
  return value !== undefined && value in NETWORKS;
}

function getActiveNetwork(): PonderNetworkName {
  const value = process.env.PONDER_NETWORK;

  if (!value) {
    if (isProduction) {
      throw new Error(
        `Missing PONDER_NETWORK. Set it to one of: ${SUPPORTED_PONDER_NETWORKS}.`,
      );
    }

    return "hardhat";
  }

  if (!isPonderNetworkName(value)) {
    throw new Error(
      `Unsupported PONDER_NETWORK "${value}". Use one of: ${SUPPORTED_PONDER_NETWORKS}.`,
    );
  }

  return value;
}

const activeNetwork = getActiveNetwork();
const activeChainId = NETWORKS[activeNetwork].chainId;
let warnedAboutHardhatStartBlocks = false;

function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

// L-7 (2026-05-22 audit): fire-and-forget eth_chainId probe so a misconfigured RPC URL
// surfaces a clear warning at boot instead of cascading into opaque indexing errors
// minutes later. Non-blocking — the indexer still starts and proceeds normally.
function probeRpcConnectivity(rpcUrl: string, expectedChainId: number, envKey: string): void {
  void fetch(rpcUrl, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(5_000),
  })
    .then(async (response) => {
      if (!response.ok) {
        console.warn(`[ponder] ${envKey} returned HTTP ${response.status} on eth_chainId probe`);
        return;
      }
      const body = (await response.json().catch(() => null)) as { result?: string } | null;
      const reportedChainId = body?.result ? Number.parseInt(body.result, 16) : NaN;
      if (!Number.isFinite(reportedChainId)) {
        console.warn(`[ponder] ${envKey} probe returned no chainId`);
      } else if (reportedChainId !== expectedChainId) {
        console.warn(
          `[ponder] ${envKey} reports chainId ${reportedChainId} but ${expectedChainId} expected`,
        );
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ponder] ${envKey} probe failed: ${message}`);
    });
}

function getRpcUrl(network: PonderNetworkName): string {
  const { chainId, defaultRpcUrl } = NETWORKS[network];
  const key = `PONDER_RPC_URL_${chainId}`;
  const value = readEnv(key) ?? (!isProduction ? defaultRpcUrl : undefined);

  if (!value) {
    throw new Error(`Missing ${key} for ${network}.`);
  }

  try {
    const url = new URL(value);
    const isLocalhost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1";

    if (isProduction && isLocalhost) {
      throw new Error(`${key} must not point to localhost in production.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("localhost")) {
      throw error;
    }

    throw new Error(`${key} must be a valid URL.`);
  }

  // Schedule a one-shot probe; runs after the config load returns, so any failure
  // surfaces as a warning in the same logs the indexer is about to write into.
  probeRpcConnectivity(value, chainId, key);

  return value;
}

function resolveAddress(key: string, contractName: string): `0x${string}` {
  const sharedAddress = getSharedArtifactAddress(activeChainId, contractName);
  const envValue = readEnv(key);

  if (activeNetwork === "hardhat") {
    if (envValue) {
      if (!isAddress(envValue)) {
        throw new Error(`${key} must be a valid address.`);
      }

      if (
        sharedAddress &&
        envValue.toLowerCase() !== sharedAddress.toLowerCase()
      ) {
        console.warn(
          `[ponder config] Using ${key}=${envValue} for local hardhat; shared ${contractName} artifact points at ${sharedAddress}.`,
        );
      }

      return envValue as `0x${string}`;
    }

    if (sharedAddress) {
      return sharedAddress;
    }

    throw new Error(
      `Missing ${key}. Run \`yarn deploy --network <network>\` to sync Ponder addresses for ${activeNetwork}.`,
    );
  }

  if (sharedAddress) {
    if (envValue) {
      if (!isAddress(envValue)) {
        throw new Error(
          `${key} must be a valid address when provided for chain ${activeChainId}.`,
        );
      }

      if (envValue.toLowerCase() !== sharedAddress.toLowerCase()) {
        throw new Error(
          `${key}=${envValue} conflicts with ${contractName} from shared deployment artifacts (${sharedAddress}) for chain ${activeChainId}. Remove the env override or refresh shared deployments.`,
        );
      }
    }

    return sharedAddress;
  }

  /*
   * Non-local networks intentionally do not fall back to PONDER_* address env vars.
   * The frontend, keeper, and indexer must agree on the same shared deployment artifacts.
   */
  throw new Error(
    `Missing shared deployment artifact for ${contractName} on chain ${activeChainId}. Run \`yarn deploy --network <network>\` to refresh shared deployments before starting Ponder for ${activeNetwork}.`,
  );
}

function resolveOptionalAddress(
  key: string,
  contractName: string,
): `0x${string}` {
  const sharedAddress = getSharedArtifactAddress(activeChainId, contractName);
  const envValue = readEnv(key);

  if (activeNetwork === "hardhat") {
    if (envValue) {
      if (!isAddress(envValue)) {
        throw new Error(`${key} must be a valid address.`);
      }

      if (
        sharedAddress &&
        envValue.toLowerCase() !== sharedAddress.toLowerCase()
      ) {
        console.warn(
          `[ponder config] Using ${key}=${envValue} for local hardhat; shared ${contractName} artifact points at ${sharedAddress}.`,
        );
      }

      return envValue as `0x${string}`;
    }

    if (sharedAddress) return sharedAddress;
    return zeroAddress;
  }

  if (envValue) {
    if (!isAddress(envValue)) {
      throw new Error(`${key} must be a valid address.`);
    }
    if (sharedAddress) {
      if (envValue.toLowerCase() !== sharedAddress.toLowerCase()) {
        throw new Error(
          `${key}=${envValue} conflicts with ${contractName} from shared deployment artifacts (${sharedAddress}) for chain ${activeChainId}. Remove the env override or refresh shared deployments.`,
        );
      }
      return envValue as `0x${string}`;
    }
  }

  if (sharedAddress) return sharedAddress;

  throw new Error(
    `Missing optional shared deployment artifact for ${contractName} on chain ${activeChainId}. Run \`yarn deploy --network <network>\` to refresh shared deployments before starting Ponder for ${activeNetwork}.`,
  );
}

function resolveStartBlock(key: string, contractName: string): number {
  const envValue = readEnv(key);

  if (activeNetwork === "hardhat") {
    if (!warnedAboutHardhatStartBlocks && envValue) {
      console.warn(
        "[ponder config] Ignoring hardhat start block overrides; using start block 0 so local Ponder can boot before or after Anvil resets.",
      );
      warnedAboutHardhatStartBlocks = true;
    }

    return 0;
  }

  const sharedStartBlock = getSharedArtifactStartBlock(
    activeChainId,
    contractName,
  );

  if (sharedStartBlock !== undefined) {
    if (envValue) {
      const parsedEnvValue = Number(envValue);
      if (
        !Number.isFinite(parsedEnvValue) ||
        !Number.isInteger(parsedEnvValue) ||
        parsedEnvValue < 0
      ) {
        throw new Error(
          `${key} must be a non-negative integer when provided for chain ${activeChainId}.`,
        );
      } else if (parsedEnvValue !== sharedStartBlock) {
        throw new Error(
          `${key}=${envValue} conflicts with ${contractName} start block from shared deployment artifacts (${sharedStartBlock}) for chain ${activeChainId}. Remove the env override or refresh shared deployments.`,
        );
      }
    }

    return sharedStartBlock;
  }

  if (!envValue) return 0;

  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative integer.`);
  }

  return Math.floor(parsed);
}

const addresses = {
  contentRegistry: resolveAddress(
    "PONDER_CONTENT_REGISTRY_ADDRESS",
    "ContentRegistry",
  ),
  roundVotingEngine: resolveAddress(
    "PONDER_ROUND_VOTING_ENGINE_ADDRESS",
    "RoundVotingEngine",
  ),
  roundRewardDistributor: resolveAddress(
    "PONDER_ROUND_REWARD_DISTRIBUTOR_ADDRESS",
    "RoundRewardDistributor",
  ),
  categoryRegistry: resolveAddress(
    "PONDER_CATEGORY_REGISTRY_ADDRESS",
    "CategoryRegistry",
  ),
  profileRegistry: resolveAddress(
    "PONDER_PROFILE_REGISTRY_ADDRESS",
    "ProfileRegistry",
  ),
  frontendRegistry: resolveAddress(
    "PONDER_FRONTEND_REGISTRY_ADDRESS",
    "FrontendRegistry",
  ),
  loopReputation: resolveAddress("PONDER_LREP_ADDRESS", "LoopReputation"),
  launchDistributionPool: resolveAddress(
    "PONDER_LAUNCH_DISTRIBUTION_POOL_ADDRESS",
    "LaunchDistributionPool",
  ),
  clusterPayoutOracle: resolveOptionalAddress(
    "PONDER_CLUSTER_PAYOUT_ORACLE_ADDRESS",
    "ClusterPayoutOracle",
  ),
  advisoryVoteRecorder: resolveAddress(
    "PONDER_ADVISORY_VOTE_RECORDER_ADDRESS",
    "AdvisoryVoteRecorder",
  ),
  questionRewardPoolEscrow: resolveAddress(
    "PONDER_QUESTION_REWARD_POOL_ESCROW_ADDRESS",
    "QuestionRewardPoolEscrow",
  ),
  feedbackBonusEscrow: resolveAddress(
    "PONDER_FEEDBACK_BONUS_ESCROW_ADDRESS",
    "FeedbackBonusEscrow",
  ),
  feedbackRegistry: resolveOptionalAddress(
    "PONDER_FEEDBACK_REGISTRY_ADDRESS",
    "FeedbackRegistry",
  ),
  raterRegistry: resolveAddress(
    "PONDER_RATER_REGISTRY_ADDRESS",
    "RaterRegistry",
  ),
  confidentialityEscrow: resolveOptionalAddress(
    "PONDER_CONFIDENTIALITY_ESCROW_ADDRESS",
    "ConfidentialityEscrow",
  ),
};

const startBlocks = {
  contentRegistry: resolveStartBlock(
    "PONDER_CONTENT_REGISTRY_START_BLOCK",
    "ContentRegistry",
  ),
  roundVotingEngine: resolveStartBlock(
    "PONDER_ROUND_VOTING_ENGINE_START_BLOCK",
    "RoundVotingEngine",
  ),
  roundRewardDistributor: resolveStartBlock(
    "PONDER_ROUND_REWARD_DISTRIBUTOR_START_BLOCK",
    "RoundRewardDistributor",
  ),
  categoryRegistry: resolveStartBlock(
    "PONDER_CATEGORY_REGISTRY_START_BLOCK",
    "CategoryRegistry",
  ),
  profileRegistry: resolveStartBlock(
    "PONDER_PROFILE_REGISTRY_START_BLOCK",
    "ProfileRegistry",
  ),
  frontendRegistry: resolveStartBlock(
    "PONDER_FRONTEND_REGISTRY_START_BLOCK",
    "FrontendRegistry",
  ),
  loopReputation: resolveStartBlock(
    "PONDER_LREP_START_BLOCK",
    "LoopReputation",
  ),
  launchDistributionPool: resolveStartBlock(
    "PONDER_LAUNCH_DISTRIBUTION_POOL_START_BLOCK",
    "LaunchDistributionPool",
  ),
  clusterPayoutOracle: resolveStartBlock(
    "PONDER_CLUSTER_PAYOUT_ORACLE_START_BLOCK",
    "ClusterPayoutOracle",
  ),
  advisoryVoteRecorder: resolveStartBlock(
    "PONDER_ADVISORY_VOTE_RECORDER_START_BLOCK",
    "AdvisoryVoteRecorder",
  ),
  questionRewardPoolEscrow: resolveStartBlock(
    "PONDER_QUESTION_REWARD_POOL_ESCROW_START_BLOCK",
    "QuestionRewardPoolEscrow",
  ),
  feedbackBonusEscrow: resolveStartBlock(
    "PONDER_FEEDBACK_BONUS_ESCROW_START_BLOCK",
    "FeedbackBonusEscrow",
  ),
  feedbackRegistry: resolveStartBlock(
    "PONDER_FEEDBACK_REGISTRY_START_BLOCK",
    "FeedbackRegistry",
  ),
  raterRegistry: resolveStartBlock(
    "PONDER_RATER_REGISTRY_START_BLOCK",
    "RaterRegistry",
  ),
  confidentialityEscrow: resolveStartBlock(
    "PONDER_CONFIDENTIALITY_ESCROW_START_BLOCK",
    "ConfidentialityEscrow",
  ),
};

function contractOnActiveNetwork(address: `0x${string}`, startBlock: number) {
  return {
    [activeNetwork]: {
      address,
      startBlock,
    },
  };
}

export default createConfig({
  networks: {
    [activeNetwork]: {
      chainId: NETWORKS[activeNetwork].chainId,
      transport: httpWithGetLogsBlockRange(
        getRpcUrl(activeNetwork),
        NETWORKS[activeNetwork].maxGetLogsBlockRange,
      ),
      pollingInterval: NETWORKS[activeNetwork].pollingInterval,
    },
  },

  contracts: {
    ContentRegistry: {
      abi: ContentRegistryAbi,
      network: contractOnActiveNetwork(
        addresses.contentRegistry,
        startBlocks.contentRegistry,
      ),
    },
    RoundVotingEngine: {
      abi: RoundVotingEngineAbi,
      network: contractOnActiveNetwork(
        addresses.roundVotingEngine,
        startBlocks.roundVotingEngine,
      ),
    },
    RoundRewardDistributor: {
      abi: RoundRewardDistributorAbi,
      network: contractOnActiveNetwork(
        addresses.roundRewardDistributor,
        startBlocks.roundRewardDistributor,
      ),
    },
    CategoryRegistry: {
      abi: CategoryRegistryAbi,
      network: contractOnActiveNetwork(
        addresses.categoryRegistry,
        startBlocks.categoryRegistry,
      ),
    },
    ProfileRegistry: {
      abi: ProfileRegistryAbi,
      network: contractOnActiveNetwork(
        addresses.profileRegistry,
        startBlocks.profileRegistry,
      ),
    },
    FrontendRegistry: {
      abi: FrontendRegistryAbi,
      network: contractOnActiveNetwork(
        addresses.frontendRegistry,
        startBlocks.frontendRegistry,
      ),
    },
    LoopReputation: {
      abi: LoopReputationAbi,
      network: contractOnActiveNetwork(
        addresses.loopReputation,
        startBlocks.loopReputation,
      ),
    },
    LaunchDistributionPool: {
      abi: LaunchDistributionPoolAbi,
      network: contractOnActiveNetwork(
        addresses.launchDistributionPool,
        startBlocks.launchDistributionPool,
      ),
    },
    ClusterPayoutOracle: {
      abi: ClusterPayoutOracleAbi,
      network: contractOnActiveNetwork(
        addresses.clusterPayoutOracle,
        startBlocks.clusterPayoutOracle,
      ),
    },
    AdvisoryVoteRecorder: {
      abi: AdvisoryVoteRecorderAbi,
      network: contractOnActiveNetwork(
        addresses.advisoryVoteRecorder,
        startBlocks.advisoryVoteRecorder,
      ),
    },
    QuestionRewardPoolEscrow: {
      abi: QuestionRewardPoolEscrowAbi,
      network: contractOnActiveNetwork(
        addresses.questionRewardPoolEscrow,
        startBlocks.questionRewardPoolEscrow,
      ),
    },
    FeedbackBonusEscrow: {
      abi: FeedbackBonusEscrowAbi,
      network: contractOnActiveNetwork(
        addresses.feedbackBonusEscrow,
        startBlocks.feedbackBonusEscrow,
      ),
    },
    FeedbackRegistry: {
      abi: FeedbackRegistryAbi,
      network: contractOnActiveNetwork(
        addresses.feedbackRegistry,
        startBlocks.feedbackRegistry,
      ),
    },
    RaterRegistry: {
      abi: RaterRegistryAbi,
      network: contractOnActiveNetwork(
        addresses.raterRegistry,
        startBlocks.raterRegistry,
      ),
    },
    ConfidentialityEscrow: {
      abi: ConfidentialityEscrowAbi,
      network: contractOnActiveNetwork(
        addresses.confidentialityEscrow,
        startBlocks.confidentialityEscrow,
      ),
    },
  },
});
