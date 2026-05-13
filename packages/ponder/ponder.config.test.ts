import { afterEach, describe, expect, it, vi } from "vitest";
import deployedContracts from "@rateloop/contracts/deployedContracts";

type DeploymentChain = Record<string, { address: `0x${string}`; deployedOnBlock?: number }>;

const sharedDeployments = deployedContracts as Record<number, DeploymentChain | undefined>;
const chain31337 = sharedDeployments[31337];
const chain480 = sharedDeployments[480];
const chain4801 = sharedDeployments[4801];
const REQUIRED_PONDER_CONTRACTS = [
  "ContentRegistry",
  "RoundVotingEngine",
  "RoundRewardDistributor",
  "CategoryRegistry",
  "ProfileRegistry",
  "FrontendRegistry",
  "VoterIdNFT",
  "LoopReputation",
  "ParticipationPool",
  "LaunchDistributionPool",
  "AdvisoryVoteRecorder",
  "QuestionRewardPoolEscrow",
  "FeedbackBonusEscrow",
  "RaterRegistry",
] as const;

function getMissingPonderContracts(chain: DeploymentChain | undefined) {
  return REQUIRED_PONDER_CONTRACTS.filter(contractName => !chain?.[contractName]?.address);
}

function getExpectedChainStartBlock(chain: DeploymentChain | undefined) {
  const deployedBlocks = Object.values(chain ?? {})
    .map(contract => contract.deployedOnBlock)
    .filter((value): value is number => Number.isInteger(value) && value >= 0);

  return deployedBlocks.length > 0 ? Math.min(...deployedBlocks) : 0;
}

const expectedChain480StartBlock = getExpectedChainStartBlock(chain480);
const expectedContentRegistry480StartBlock =
  chain480?.ContentRegistry?.deployedOnBlock ?? expectedChain480StartBlock;
const expectedChainStartBlock = getExpectedChainStartBlock(chain4801);
const expectedContentRegistryStartBlock = chain4801?.ContentRegistry?.deployedOnBlock ?? expectedChainStartBlock;
const expectedQuestionRewardPoolEscrowStartBlock =
  chain4801?.QuestionRewardPoolEscrow?.deployedOnBlock ?? expectedChainStartBlock;
const expectedFeedbackBonusEscrowStartBlock =
  chain4801?.FeedbackBonusEscrow?.deployedOnBlock ?? expectedChainStartBlock;
const missingSepoliaPonderContracts = getMissingPonderContracts(chain4801);
const missingWorldChainPonderContracts = getMissingPonderContracts(chain480);
const missingHardhatPonderContracts = getMissingPonderContracts(chain31337);
const itWithSepoliaPonderArtifacts = chain4801 && missingSepoliaPonderContracts.length === 0 ? it : it.skip;
const itWithSepoliaContentRegistryArtifact = chain4801?.ContentRegistry ? it : it.skip;
const itWithMissingSepoliaPonderArtifacts = chain4801 && missingSepoliaPonderContracts.length > 0 ? it : it.skip;
const itWithWorldChainPonderArtifacts = chain480 && missingWorldChainPonderContracts.length === 0 ? it : it.skip;
const itWithHardhatArtifacts = chain31337 && missingHardhatPonderContracts.length === 0 ? it : it.skip;
const PONDER_CONFIG_TEST_TIMEOUT_MS = 30_000;
const ORIGINAL_ENV = { ...process.env };
const VALID_ENV = {
  PONDER_NETWORK: "worldchainSepolia",
  PONDER_RPC_URL_4801: "https://worldchain-sepolia.g.alchemy.com/public",
  PONDER_CONTENT_REGISTRY_ADDRESS: chain4801?.ContentRegistry?.address ?? "0x1111111111111111111111111111111111111111",
  PONDER_ROUND_VOTING_ENGINE_ADDRESS:
    chain4801?.RoundVotingEngine?.address ?? "0x2222222222222222222222222222222222222222",
  PONDER_ROUND_REWARD_DISTRIBUTOR_ADDRESS:
    chain4801?.RoundRewardDistributor?.address ?? "0x3333333333333333333333333333333333333333",
  PONDER_CATEGORY_REGISTRY_ADDRESS: chain4801?.CategoryRegistry?.address ?? "0x4444444444444444444444444444444444444444",
  PONDER_PROFILE_REGISTRY_ADDRESS: chain4801?.ProfileRegistry?.address ?? "0x5555555555555555555555555555555555555555",
  PONDER_FRONTEND_REGISTRY_ADDRESS:
    chain4801?.FrontendRegistry?.address ?? "0x6666666666666666666666666666666666666666",
  PONDER_VOTER_ID_NFT_ADDRESS: chain4801?.VoterIdNFT?.address ?? "0x7777777777777777777777777777777777777777",
  PONDER_LREP_ADDRESS: chain4801?.LoopReputation?.address ?? "0x8888888888888888888888888888888888888888",
  PONDER_PARTICIPATION_POOL_ADDRESS:
    chain4801?.ParticipationPool?.address ?? "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  PONDER_LAUNCH_DISTRIBUTION_POOL_ADDRESS:
    chain4801?.LaunchDistributionPool?.address ?? "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  PONDER_ADVISORY_VOTE_RECORDER_ADDRESS:
    chain4801?.AdvisoryVoteRecorder?.address ?? "0xffffffffffffffffffffffffffffffffffffffff",
  PONDER_QUESTION_REWARD_POOL_ESCROW_ADDRESS:
    chain4801?.QuestionRewardPoolEscrow?.address ?? "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  PONDER_QUESTION_REWARD_POOL_ESCROW_START_BLOCK: String(expectedQuestionRewardPoolEscrowStartBlock),
  PONDER_FEEDBACK_BONUS_ESCROW_ADDRESS:
    chain4801?.FeedbackBonusEscrow?.address ?? "0xcccccccccccccccccccccccccccccccccccccccc",
  PONDER_FEEDBACK_BONUS_ESCROW_START_BLOCK: String(expectedFeedbackBonusEscrowStartBlock),
  PONDER_RATER_REGISTRY_ADDRESS: chain4801?.RaterRegistry?.address ?? "0xdddddddddddddddddddddddddddddddddddddddd",
  PONDER_CONTENT_REGISTRY_START_BLOCK: String(expectedContentRegistryStartBlock),
};

async function loadPonderConfig(overrides: Record<string, string | undefined> = {}, removals: string[] = []) {
  vi.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    ...VALID_ENV,
    ...overrides,
  };

  for (const key of removals) {
    delete process.env[key];
  }

  return import("./ponder.config.ts");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("ponder config", () => {
  itWithSepoliaPonderArtifacts("derives supported-chain addresses and start blocks from shared deployment artifacts", async () => {
    const { default: config } = await loadPonderConfig(
      {},
      [
        "PONDER_CONTENT_REGISTRY_ADDRESS",
        "PONDER_ROUND_VOTING_ENGINE_ADDRESS",
        "PONDER_ROUND_REWARD_DISTRIBUTOR_ADDRESS",
        "PONDER_CATEGORY_REGISTRY_ADDRESS",
        "PONDER_PROFILE_REGISTRY_ADDRESS",
        "PONDER_FRONTEND_REGISTRY_ADDRESS",
        "PONDER_VOTER_ID_NFT_ADDRESS",
        "PONDER_LREP_ADDRESS",
        "PONDER_PARTICIPATION_POOL_ADDRESS",
        "PONDER_LAUNCH_DISTRIBUTION_POOL_ADDRESS",
        "PONDER_ADVISORY_VOTE_RECORDER_ADDRESS",
        "PONDER_QUESTION_REWARD_POOL_ESCROW_ADDRESS",
        "PONDER_FEEDBACK_BONUS_ESCROW_ADDRESS",
        "PONDER_RATER_REGISTRY_ADDRESS",
        "PONDER_CONTENT_REGISTRY_START_BLOCK",
        "PONDER_QUESTION_REWARD_POOL_ESCROW_START_BLOCK",
        "PONDER_FEEDBACK_BONUS_ESCROW_START_BLOCK",
      ],
    );

    const loadedConfig = config as any;

    expect(loadedConfig.contracts.ContentRegistry.network.worldchainSepolia.address).toBe(
      chain4801!.ContentRegistry.address,
    );
    expect(loadedConfig.contracts.RoundVotingEngine.network.worldchainSepolia.address).toBe(
      chain4801!.RoundVotingEngine.address,
    );
    expect(loadedConfig.contracts.LoopReputation.network.worldchainSepolia.address).toBe(
      chain4801!.LoopReputation.address,
    );
    expect(loadedConfig.contracts.ContentRegistry.network.worldchainSepolia.startBlock).toBe(
      expectedContentRegistryStartBlock,
    );
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  itWithWorldChainPonderArtifacts("derives World Chain mainnet addresses and start blocks from shared deployment artifacts", async () => {
    const { default: config } = await loadPonderConfig(
      {
        PONDER_NETWORK: "worldchain",
        PONDER_RPC_URL_480: "https://worldchain-mainnet.g.alchemy.com/public",
      },
      [
        "PONDER_CONTENT_REGISTRY_ADDRESS",
        "PONDER_ROUND_VOTING_ENGINE_ADDRESS",
        "PONDER_ROUND_REWARD_DISTRIBUTOR_ADDRESS",
        "PONDER_CATEGORY_REGISTRY_ADDRESS",
        "PONDER_PROFILE_REGISTRY_ADDRESS",
        "PONDER_FRONTEND_REGISTRY_ADDRESS",
        "PONDER_VOTER_ID_NFT_ADDRESS",
        "PONDER_LREP_ADDRESS",
        "PONDER_PARTICIPATION_POOL_ADDRESS",
        "PONDER_LAUNCH_DISTRIBUTION_POOL_ADDRESS",
        "PONDER_ADVISORY_VOTE_RECORDER_ADDRESS",
        "PONDER_QUESTION_REWARD_POOL_ESCROW_ADDRESS",
        "PONDER_FEEDBACK_BONUS_ESCROW_ADDRESS",
        "PONDER_RATER_REGISTRY_ADDRESS",
        "PONDER_CONTENT_REGISTRY_START_BLOCK",
        "PONDER_QUESTION_REWARD_POOL_ESCROW_START_BLOCK",
        "PONDER_FEEDBACK_BONUS_ESCROW_START_BLOCK",
      ],
    );

    const loadedConfig = config as any;

    expect(loadedConfig.contracts.ContentRegistry.network.worldchain.address).toBe(chain480!.ContentRegistry.address);
    expect(loadedConfig.contracts.RoundVotingEngine.network.worldchain.address).toBe(chain480!.RoundVotingEngine.address);
    expect(loadedConfig.contracts.LoopReputation.network.worldchain.address).toBe(chain480!.LoopReputation.address);
    expect(loadedConfig.contracts.ContentRegistry.network.worldchain.startBlock).toBe(expectedContentRegistry480StartBlock);
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  itWithSepoliaContentRegistryArtifact(
    "rejects stale Ponder address env overrides when shared deployment artifacts exist",
    async () => {
      await expect(
        loadPonderConfig({
          PONDER_CONTENT_REGISTRY_ADDRESS: "0x1111111111111111111111111111111111111111",
        }),
      ).rejects.toThrow("conflicts with ContentRegistry from shared deployment artifacts");
    },
    PONDER_CONFIG_TEST_TIMEOUT_MS,
  );

  itWithSepoliaPonderArtifacts("rejects stale Ponder start block env overrides when shared deployment artifacts exist", async () => {
    await expect(
      loadPonderConfig({
        PONDER_CONTENT_REGISTRY_START_BLOCK: String(expectedContentRegistryStartBlock + 1),
      }),
    ).rejects.toThrow("conflicts with ContentRegistry start block from shared deployment artifacts");
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  itWithMissingSepoliaPonderArtifacts("rejects non-local env address fallbacks when shared artifacts are missing", async () => {
    await expect(loadPonderConfig()).rejects.toThrow(
      `Missing shared deployment artifact for ${missingSepoliaPonderContracts[0]} on chain 4801`,
    );
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  itWithHardhatArtifacts("uses start block 0 for local hardhat even when artifacts contain deployment blocks", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { default: config } = await loadPonderConfig(
      {
        PONDER_NETWORK: "hardhat",
        PONDER_RPC_URL_31337: "http://127.0.0.1:8545",
        PONDER_CONTENT_REGISTRY_START_BLOCK: String(chain31337!.ContentRegistry.deployedOnBlock ?? 1),
      },
      [
        "PONDER_CONTENT_REGISTRY_ADDRESS",
        "PONDER_ROUND_VOTING_ENGINE_ADDRESS",
        "PONDER_ROUND_REWARD_DISTRIBUTOR_ADDRESS",
        "PONDER_CATEGORY_REGISTRY_ADDRESS",
        "PONDER_PROFILE_REGISTRY_ADDRESS",
        "PONDER_FRONTEND_REGISTRY_ADDRESS",
        "PONDER_VOTER_ID_NFT_ADDRESS",
        "PONDER_LREP_ADDRESS",
        "PONDER_PARTICIPATION_POOL_ADDRESS",
        "PONDER_LAUNCH_DISTRIBUTION_POOL_ADDRESS",
        "PONDER_ADVISORY_VOTE_RECORDER_ADDRESS",
        "PONDER_QUESTION_REWARD_POOL_ESCROW_ADDRESS",
        "PONDER_FEEDBACK_BONUS_ESCROW_ADDRESS",
        "PONDER_RATER_REGISTRY_ADDRESS",
      ],
    );

    const loadedConfig = config as any;

    expect(loadedConfig.contracts.ContentRegistry.network.hardhat.address).toBe(chain31337!.ContentRegistry.address);
    expect(loadedConfig.contracts.ContentRegistry.network.hardhat.startBlock).toBe(0);
    expect(loadedConfig.contracts.LoopReputation.network.hardhat.startBlock).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("using start block 0"));
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  itWithHardhatArtifacts("prefers local hardhat env addresses over shared deployment artifacts", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const localContentRegistryAddress = "0x1111111111111111111111111111111111111111";
    const { default: config } = await loadPonderConfig({
      PONDER_NETWORK: "hardhat",
      PONDER_RPC_URL_31337: "http://127.0.0.1:8545",
      PONDER_CONTENT_REGISTRY_ADDRESS: localContentRegistryAddress,
      PONDER_CONTENT_REGISTRY_START_BLOCK: String(chain31337!.ContentRegistry.deployedOnBlock ?? 1),
    });

    const loadedConfig = config as any;

    expect(loadedConfig.contracts.ContentRegistry.network.hardhat.address).toBe(localContentRegistryAddress);
    expect(loadedConfig.contracts.ContentRegistry.network.hardhat.address).not.toBe(
      chain31337!.ContentRegistry.address,
    );
    expect(loadedConfig.contracts.ContentRegistry.network.hardhat.startBlock).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Using PONDER_CONTENT_REGISTRY_ADDRESS"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("using start block 0"));
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);
});
