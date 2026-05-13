import { createConfig } from "ponder";
import { isAddress } from "viem";
import { http } from "viem";

import {
  AdvisoryVoteRecorderAbi,
  CategoryRegistryAbi,
  ContentRegistryAbi,
  LoopReputationAbi,
  FeedbackBonusEscrowAbi,
  FrontendRegistryAbi,
  LaunchDistributionPoolAbi,
  ParticipationPoolAbi,
  ProfileRegistryAbi,
  QuestionRewardPoolEscrowAbi,
  RaterRegistryAbi,
  RoundRewardDistributorAbi,
  RoundVotingEngineAbi,
  VoterIdNFTAbi,
} from "@rateloop/contracts/abis";
import {
  getSharedDeploymentAddress as getSharedArtifactAddress,
  getSharedDeploymentStartBlock as getSharedArtifactStartBlock,
} from "@rateloop/contracts/deployments";

type PonderNetworkName = "worldchainSepolia" | "hardhat" | "worldchain";

const isProduction = process.env.NODE_ENV === "production";

const NETWORKS: Record<
  PonderNetworkName,
  {
    chainId: number;
    defaultRpcUrl: string;
    pollingInterval: number;
  }
> = {
  worldchainSepolia: {
    chainId: 4801,
    defaultRpcUrl: "https://worldchain-sepolia.g.alchemy.com/public",
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
    pollingInterval: 5_000,
  },
};

function isPonderNetworkName(value: string | undefined): value is PonderNetworkName {
  return value === "worldchainSepolia" || value === "hardhat" || value === "worldchain";
}

function getActiveNetwork(): PonderNetworkName {
  const value = process.env.PONDER_NETWORK;

  if (!value) {
    if (isProduction) {
      throw new Error("Missing PONDER_NETWORK. Set it to hardhat, worldchainSepolia, or worldchain.");
    }

    return "hardhat";
  }

  if (!isPonderNetworkName(value)) {
    throw new Error(`Unsupported PONDER_NETWORK "${value}". Use hardhat, worldchainSepolia, or worldchain.`);
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

function getRpcUrl(network: PonderNetworkName): string {
  const { chainId, defaultRpcUrl } = NETWORKS[network];
  const key = `PONDER_RPC_URL_${chainId}`;
  const value = process.env[key] ?? (!isProduction ? defaultRpcUrl : undefined);

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
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`${key} must be a valid URL.`);
  }

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

      if (sharedAddress && envValue.toLowerCase() !== sharedAddress.toLowerCase()) {
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
        throw new Error(`${key} must be a valid address when provided for chain ${activeChainId}.`);
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

  const sharedStartBlock = getSharedArtifactStartBlock(activeChainId, contractName);

  if (sharedStartBlock !== undefined) {
    if (envValue) {
      const parsedEnvValue = Number(envValue);
      if (!Number.isFinite(parsedEnvValue) || !Number.isInteger(parsedEnvValue) || parsedEnvValue < 0) {
        throw new Error(`${key} must be a non-negative integer when provided for chain ${activeChainId}.`);
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
  contentRegistry: resolveAddress("PONDER_CONTENT_REGISTRY_ADDRESS", "ContentRegistry"),
  roundVotingEngine: resolveAddress("PONDER_ROUND_VOTING_ENGINE_ADDRESS", "RoundVotingEngine"),
  roundRewardDistributor: resolveAddress("PONDER_ROUND_REWARD_DISTRIBUTOR_ADDRESS", "RoundRewardDistributor"),
  categoryRegistry: resolveAddress("PONDER_CATEGORY_REGISTRY_ADDRESS", "CategoryRegistry"),
  profileRegistry: resolveAddress("PONDER_PROFILE_REGISTRY_ADDRESS", "ProfileRegistry"),
  frontendRegistry: resolveAddress("PONDER_FRONTEND_REGISTRY_ADDRESS", "FrontendRegistry"),
  voterIdNFT: resolveAddress("PONDER_VOTER_ID_NFT_ADDRESS", "VoterIdNFT"),
  loopReputation: resolveAddress("PONDER_LREP_ADDRESS", "LoopReputation"),
  participationPool: resolveAddress("PONDER_PARTICIPATION_POOL_ADDRESS", "ParticipationPool"),
  launchDistributionPool: resolveAddress("PONDER_LAUNCH_DISTRIBUTION_POOL_ADDRESS", "LaunchDistributionPool"),
  advisoryVoteRecorder: resolveAddress("PONDER_ADVISORY_VOTE_RECORDER_ADDRESS", "AdvisoryVoteRecorder"),
  questionRewardPoolEscrow: resolveAddress("PONDER_QUESTION_REWARD_POOL_ESCROW_ADDRESS", "QuestionRewardPoolEscrow"),
  feedbackBonusEscrow: resolveAddress("PONDER_FEEDBACK_BONUS_ESCROW_ADDRESS", "FeedbackBonusEscrow"),
  raterRegistry: resolveAddress("PONDER_RATER_REGISTRY_ADDRESS", "RaterRegistry"),
};

const startBlocks = {
  contentRegistry: resolveStartBlock("PONDER_CONTENT_REGISTRY_START_BLOCK", "ContentRegistry"),
  roundVotingEngine: resolveStartBlock("PONDER_ROUND_VOTING_ENGINE_START_BLOCK", "RoundVotingEngine"),
  roundRewardDistributor: resolveStartBlock("PONDER_ROUND_REWARD_DISTRIBUTOR_START_BLOCK", "RoundRewardDistributor"),
  categoryRegistry: resolveStartBlock("PONDER_CATEGORY_REGISTRY_START_BLOCK", "CategoryRegistry"),
  profileRegistry: resolveStartBlock("PONDER_PROFILE_REGISTRY_START_BLOCK", "ProfileRegistry"),
  frontendRegistry: resolveStartBlock("PONDER_FRONTEND_REGISTRY_START_BLOCK", "FrontendRegistry"),
  voterIdNFT: resolveStartBlock("PONDER_VOTER_ID_NFT_START_BLOCK", "VoterIdNFT"),
  loopReputation: resolveStartBlock("PONDER_LREP_START_BLOCK", "LoopReputation"),
  participationPool: resolveStartBlock("PONDER_PARTICIPATION_POOL_START_BLOCK", "ParticipationPool"),
  launchDistributionPool: resolveStartBlock("PONDER_LAUNCH_DISTRIBUTION_POOL_START_BLOCK", "LaunchDistributionPool"),
  advisoryVoteRecorder: resolveStartBlock("PONDER_ADVISORY_VOTE_RECORDER_START_BLOCK", "AdvisoryVoteRecorder"),
  questionRewardPoolEscrow: resolveStartBlock("PONDER_QUESTION_REWARD_POOL_ESCROW_START_BLOCK", "QuestionRewardPoolEscrow"),
  feedbackBonusEscrow: resolveStartBlock("PONDER_FEEDBACK_BONUS_ESCROW_START_BLOCK", "FeedbackBonusEscrow"),
  raterRegistry: resolveStartBlock("PONDER_RATER_REGISTRY_START_BLOCK", "RaterRegistry"),
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
      transport: http(getRpcUrl(activeNetwork)),
      pollingInterval: NETWORKS[activeNetwork].pollingInterval,
    },
  },

  contracts: {
    ContentRegistry: {
      abi: ContentRegistryAbi,
      network: contractOnActiveNetwork(addresses.contentRegistry, startBlocks.contentRegistry),
    },
    RoundVotingEngine: {
      abi: RoundVotingEngineAbi,
      network: contractOnActiveNetwork(addresses.roundVotingEngine, startBlocks.roundVotingEngine),
    },
    RoundRewardDistributor: {
      abi: RoundRewardDistributorAbi,
      network: contractOnActiveNetwork(addresses.roundRewardDistributor, startBlocks.roundRewardDistributor),
    },
    CategoryRegistry: {
      abi: CategoryRegistryAbi,
      network: contractOnActiveNetwork(addresses.categoryRegistry, startBlocks.categoryRegistry),
    },
    ProfileRegistry: {
      abi: ProfileRegistryAbi,
      network: contractOnActiveNetwork(addresses.profileRegistry, startBlocks.profileRegistry),
    },
    FrontendRegistry: {
      abi: FrontendRegistryAbi,
      network: contractOnActiveNetwork(addresses.frontendRegistry, startBlocks.frontendRegistry),
    },
    VoterIdNFT: {
      abi: VoterIdNFTAbi,
      network: contractOnActiveNetwork(addresses.voterIdNFT, startBlocks.voterIdNFT),
    },
    LoopReputation: {
      abi: LoopReputationAbi,
      network: contractOnActiveNetwork(addresses.loopReputation, startBlocks.loopReputation),
    },
    ParticipationPool: {
      abi: ParticipationPoolAbi,
      network: contractOnActiveNetwork(addresses.participationPool, startBlocks.participationPool),
    },
    LaunchDistributionPool: {
      abi: LaunchDistributionPoolAbi,
      network: contractOnActiveNetwork(addresses.launchDistributionPool, startBlocks.launchDistributionPool),
    },
    AdvisoryVoteRecorder: {
      abi: AdvisoryVoteRecorderAbi,
      network: contractOnActiveNetwork(addresses.advisoryVoteRecorder, startBlocks.advisoryVoteRecorder),
    },
    QuestionRewardPoolEscrow: {
      abi: QuestionRewardPoolEscrowAbi,
      network: contractOnActiveNetwork(addresses.questionRewardPoolEscrow, startBlocks.questionRewardPoolEscrow),
    },
    FeedbackBonusEscrow: {
      abi: FeedbackBonusEscrowAbi,
      network: contractOnActiveNetwork(addresses.feedbackBonusEscrow, startBlocks.feedbackBonusEscrow),
    },
    RaterRegistry: {
      abi: RaterRegistryAbi,
      network: contractOnActiveNetwork(addresses.raterRegistry, startBlocks.raterRegistry),
    },
  },
});
