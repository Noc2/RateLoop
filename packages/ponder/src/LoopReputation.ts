import { getSharedDeploymentAddress } from "@rateloop/contracts/deployments";
import { ponder } from "ponder:registry";
import { tokenHolder, tokenTransfer } from "ponder:schema";
import { isAddress } from "viem";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PONDER_NETWORK_CHAIN_IDS: Record<string, number> = {
  hardhat: 31337,
  worldchainSepolia: 4801,
  worldchain: 480,
};

const INDEXED_CONTRACT_NAMES = [
  "ContentRegistry",
  "RoundVotingEngine",
  "RoundRewardDistributor",
  "CategoryRegistry",
  "ProfileRegistry",
  "FrontendRegistry",
  "VoterIdNFT",
  "LoopReputation",
  "ParticipationPool",
  "QuestionRewardPoolEscrow",
  "FeedbackBonusEscrow",
  "RaterRegistry",
] as const;

type IndexedContractName = (typeof INDEXED_CONTRACT_NAMES)[number];

const INDEXED_CONTRACT_ENV_KEYS: Partial<Record<IndexedContractName, string>> = {
  ContentRegistry: "PONDER_CONTENT_REGISTRY_ADDRESS",
  RoundVotingEngine: "PONDER_ROUND_VOTING_ENGINE_ADDRESS",
  RoundRewardDistributor: "PONDER_ROUND_REWARD_DISTRIBUTOR_ADDRESS",
  CategoryRegistry: "PONDER_CATEGORY_REGISTRY_ADDRESS",
  ProfileRegistry: "PONDER_PROFILE_REGISTRY_ADDRESS",
  FrontendRegistry: "PONDER_FRONTEND_REGISTRY_ADDRESS",
  VoterIdNFT: "PONDER_VOTER_ID_NFT_ADDRESS",
  ParticipationPool: "PONDER_PARTICIPATION_POOL_ADDRESS",
  QuestionRewardPoolEscrow: "PONDER_QUESTION_REWARD_POOL_ESCROW_ADDRESS",
  FeedbackBonusEscrow: "PONDER_FEEDBACK_BONUS_ESCROW_ADDRESS",
  RaterRegistry: "PONDER_RATER_REGISTRY_ADDRESS",
};

function addExcludedAddress(addresses: Set<string>, address: string | undefined) {
  if (address && isAddress(address)) {
    addresses.add(address.toLowerCase());
  }
}

function buildExcludedAddresses() {
  const addresses = new Set<string>();
  const networkName = process.env.PONDER_NETWORK || "hardhat";
  const chainId = PONDER_NETWORK_CHAIN_IDS[networkName];

  if (chainId !== undefined) {
    for (const contractName of INDEXED_CONTRACT_NAMES) {
      addExcludedAddress(addresses, getSharedDeploymentAddress(chainId, contractName));
      const envKey = INDEXED_CONTRACT_ENV_KEYS[contractName];
      if (envKey) {
        addExcludedAddress(addresses, process.env[envKey]?.trim());
      }
    }
  }

  addExcludedAddress(addresses, process.env.PONDER_DEPLOYER_ADDRESS?.trim());

  return addresses;
}

const excludedAddresses = buildExcludedAddresses();

ponder.on("LoopReputation:Transfer", async ({ event, context }) => {
  const { from, to, value } = event.args;

  // Record every transfer for balance history
  await context.db
    .insert(tokenTransfer)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      from: from,
      to: to,
      amount: value,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
    })
    .onConflictDoNothing();

  // Track token holders (skip burns and known contracts)
  if (to === ZERO_ADDRESS) return;
  if (excludedAddresses.has(to.toLowerCase())) return;

  await context.db
    .insert(tokenHolder)
    .values({
      address: to,
      firstSeenAt: event.block.timestamp,
    })
    .onConflictDoNothing();
});
