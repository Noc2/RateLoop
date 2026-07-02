import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { decodeFunctionData, getAddress, parseAbi } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEPLOY_TARGET_TO_CHAIN = {
  base: { chainId: 8453, networkName: "base" },
  baseSepolia: { chainId: 84532, networkName: "baseSepolia" },
  worldchain: { chainId: 480, networkName: "worldchain" },
  worldchainSepolia: { chainId: 4801, networkName: "worldchainSepolia" },
};
const DEFAULT_DEPLOYMENT_PROFILE_BY_NETWORK = {
  base: "production",
  worldchain: "production",
};
const PRODUCTION_NETWORK_NAMES = new Set(
  Object.entries(DEFAULT_DEPLOYMENT_PROFILE_BY_NETWORK)
    .filter(([, profile]) => profile === "production")
    .map(([network]) => network)
);
const DEFAULT_DEPLOYMENT_PROFILE = "default";
const RATELOOP_DEPLOYMENT_PROFILE_ENV = "RATELOOP_DEPLOYMENT_PROFILE";

const PROXY_DEPLOYMENT_NAMES = [
  "FrontendRegistry",
  "ProfileRegistry",
  "ContentRegistry",
  "ProtocolConfig",
  "RoundVotingEngine",
  "RoundRewardDistributor",
  "RaterRegistry",
  "QuestionRewardPoolEscrow",
  "ConfidentialityEscrow",
  "FeedbackRegistry",
  "FeedbackBonusEscrow",
];

const DIRECT_DEPLOYMENT_NAMES = new Set([
  "TimelockController",
  "LoopReputation",
  "RateLoopGovernor",
  "X402QuestionSubmitter",
  "CategoryRegistry",
  "RoundVotingEngineRbtsSettlementModule",
  "ClusterPayoutOracle",
  "LaunchDistributionPool",
  "AdvisoryVoteRecorder",
  "MockWorldIDRouter",
]);

const TREASURY_LREP_AMOUNT = 25_000_000n * 1_000_000n;
const DEFAULT_CLUSTER_PAYOUT_CHALLENGE_BOND = "5000000";

const ROLE_HASHES = {
  defaultAdmin:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  admin: "0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775",
  config: "0x82db594318110a04b6349ce48645aa69f0892751bc893d15e61d9e2b9c4630f5",
  arbiter: "0xbb08418a67729a078f87bbc8d02a770929bb68f5bfdf134ae2ead6ed38e2f4ae",
  minter: "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
  x402Gateway:
    "0xf8fc5b762a56b84305af28ac287dfaf08d491f8de4965459339ae40cec115613",
  timelockProposer:
    "0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1",
  timelockCanceller:
    "0xfd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783",
  pauser: "0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a",
  seeder: "0x240afcd1926e36e0297a1eb63ba484f52ddbef788e7f4e9b38b0dcc66de129e1",
};

const PROTOCOL_CONFIG_COMPLETION_ABI = parseAbi([
  "function setConfig(uint256 epochDuration,uint256 maxDuration,uint256 minVoters,uint256 maxVoters)",
  "function setClusterPayoutOracle(address value)",
  "function setAdvisoryVoteRecorder(address value)",
  "function setLaunchDistributionPool(address value)",
  "function setRewardDistributor(address value)",
  "function setFrontendRegistry(address value)",
  "function setCategoryRegistry(address value)",
  "function setRaterRegistry(address value)",
  "function setConfidentialityEscrow(address value)",
  "function renounceRole(bytes32 role,address account)",
]);

const CONTENT_REGISTRY_COMPLETION_ABI = parseAbi([
  "function pause()",
  "function unpause()",
  "function setVotingEngine(address value)",
  "function setQuestionRewardPoolEscrow(address value)",
  "function setProtocolConfig(address value)",
  "function setCategoryRegistry(address value)",
  "function grantRole(bytes32 role,address account)",
  "function renounceRole(bytes32 role,address account)",
]);

const RATER_REGISTRY_COMPLETION_ABI = parseAbi([
  "function setConfidentialityEscrow(address value)",
  "function renounceRole(bytes32 role,address account)",
]);

const CONFIDENTIALITY_ESCROW_COMPLETION_ABI = parseAbi([
  "function grantRole(bytes32 role,address account)",
  "function renounceRole(bytes32 role,address account)",
]);

const FEEDBACK_REGISTRY_COMPLETION_ABI = parseAbi([
  "function renounceRole(bytes32 role,address account)",
]);

const PROFILE_REGISTRY_COMPLETION_ABI = parseAbi([
  "function setRaterRegistry(address value)",
  "function renounceRole(bytes32 role,address account)",
]);

const FRONTEND_REGISTRY_COMPLETION_ABI = parseAbi([
  "function setVotingEngine(address value)",
  "function initializeFeeCreditor(address value)",
  "function renounceRole(bytes32 role,address account)",
]);

const TIMELOCK_AUTHORITY_ABI = parseAbi([
  "function grantRole(bytes32 role,address account)",
  "function revokeRole(bytes32 role,address account)",
  "function renounceRole(bytes32 role,address account)",
]);

const LOOP_REPUTATION_AUTHORITY_ABI = parseAbi([
  "function setGovernor(address governor)",
]);

const LOOP_REPUTATION_COMPLETION_ABI = parseAbi([
  "function mint(address to,uint256 amount)",
  "function setGovernor(address governor)",
  "function renounceRole(bytes32 role,address account)",
]);

const REQUIRED_COMPLETION_CALLS = [
  {
    label: "ContentRegistry.pause",
    contractNames: ["ContentRegistry", "TransparentUpgradeableProxy"],
    target: "ContentRegistry",
    functionNames: ["pause", "pause()"],
    abi: CONTENT_REGISTRY_COMPLETION_ABI,
  },
  {
    label: "ContentRegistry.setVotingEngine",
    contractNames: ["ContentRegistry", "TransparentUpgradeableProxy"],
    target: "ContentRegistry",
    functionNames: ["setVotingEngine", "setVotingEngine(address)"],
    abi: CONTENT_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ctx.roundVotingEngine],
    final: true,
  },
  {
    label: "ContentRegistry.setQuestionRewardPoolEscrow",
    contractNames: ["ContentRegistry", "TransparentUpgradeableProxy"],
    target: "ContentRegistry",
    functionNames: [
      "setQuestionRewardPoolEscrow",
      "setQuestionRewardPoolEscrow(address)",
    ],
    abi: CONTENT_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ctx.questionRewardPoolEscrow],
    final: true,
  },
  {
    label: "ContentRegistry.unpause",
    contractNames: ["ContentRegistry", "TransparentUpgradeableProxy"],
    target: "ContentRegistry",
    functionNames: ["unpause", "unpause()"],
    abi: CONTENT_REGISTRY_COMPLETION_ABI,
  },
  {
    label: "ContentRegistry.setProtocolConfig",
    contractNames: ["ContentRegistry", "TransparentUpgradeableProxy"],
    target: "ContentRegistry",
    functionNames: ["setProtocolConfig", "setProtocolConfig(address)"],
    abi: CONTENT_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ctx.protocolConfig],
    final: true,
  },
  {
    label: "ContentRegistry.setCategoryRegistry",
    contractNames: ["ContentRegistry", "TransparentUpgradeableProxy"],
    target: "ContentRegistry",
    functionNames: ["setCategoryRegistry", "setCategoryRegistry(address)"],
    abi: CONTENT_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ctx.categoryRegistry],
    final: true,
  },
  {
    label: "ContentRegistry.grantRole(X402_GATEWAY_ROLE)",
    contractNames: ["ContentRegistry", "TransparentUpgradeableProxy"],
    target: "ContentRegistry",
    functionNames: ["grantRole", "grantRole(bytes32,address)"],
    abi: CONTENT_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ROLE_HASHES.x402Gateway, ctx.x402QuestionSubmitter],
  },
  {
    label: "RaterRegistry.renounceRole(ADMIN_ROLE)",
    contractNames: ["RaterRegistry", "TransparentUpgradeableProxy"],
    target: "RaterRegistry",
    functionNames: ["renounceRole", "renounceRole(bytes32,address)"],
    abi: RATER_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ROLE_HASHES.admin, ctx.deployer],
  },
  {
    label: "RaterRegistry.renounceRole(SEEDER_ROLE)",
    contractNames: ["RaterRegistry", "TransparentUpgradeableProxy"],
    target: "RaterRegistry",
    functionNames: ["renounceRole", "renounceRole(bytes32,address)"],
    abi: RATER_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ROLE_HASHES.seeder, ctx.deployer],
  },
  {
    label: "FeedbackRegistry.renounceRole(CONFIG_ROLE)",
    contractNames: ["FeedbackRegistry", "TransparentUpgradeableProxy"],
    target: "FeedbackRegistry",
    functionNames: ["renounceRole", "renounceRole(bytes32,address)"],
    abi: FEEDBACK_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ROLE_HASHES.config, ctx.deployer],
  },
  {
    label: "RaterRegistry.setConfidentialityEscrow",
    contractNames: ["RaterRegistry", "TransparentUpgradeableProxy"],
    target: "RaterRegistry",
    functionNames: [
      "setConfidentialityEscrow",
      "setConfidentialityEscrow(address)",
    ],
    abi: RATER_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ctx.confidentialityEscrow],
    final: true,
  },
  {
    label: "ProtocolConfig.setConfidentialityEscrow",
    contractName: "TransparentUpgradeableProxy",
    target: "ProtocolConfig",
    functionName: "setConfidentialityEscrow",
    abi: PROTOCOL_CONFIG_COMPLETION_ABI,
    args: (ctx) => [ctx.confidentialityEscrow],
    final: true,
  },
  {
    label: "ConfidentialityEscrow.renounceRole(PAUSER_ROLE)",
    contractNames: ["ConfidentialityEscrow", "TransparentUpgradeableProxy"],
    target: "ConfidentialityEscrow",
    functionNames: ["renounceRole", "renounceRole(bytes32,address)"],
    abi: CONFIDENTIALITY_ESCROW_COMPLETION_ABI,
    args: (ctx) => [ROLE_HASHES.pauser, ctx.deployer],
  },
  {
    label: "ConfidentialityEscrow.renounceRole(CONFIG_ROLE)",
    contractNames: ["ConfidentialityEscrow", "TransparentUpgradeableProxy"],
    target: "ConfidentialityEscrow",
    functionNames: ["renounceRole", "renounceRole(bytes32,address)"],
    abi: CONFIDENTIALITY_ESCROW_COMPLETION_ABI,
    args: (ctx) => [ROLE_HASHES.config, ctx.deployer],
  },
  {
    label: "ContentRegistry.renounceRole(CONFIG_ROLE)",
    contractNames: ["ContentRegistry", "TransparentUpgradeableProxy"],
    target: "ContentRegistry",
    functionNames: ["renounceRole", "renounceRole(bytes32,address)"],
    abi: CONTENT_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ROLE_HASHES.config, ctx.deployer],
  },
  {
    label: "ContentRegistry.renounceRole(PAUSER_ROLE)",
    contractNames: ["ContentRegistry", "TransparentUpgradeableProxy"],
    target: "ContentRegistry",
    functionNames: ["renounceRole", "renounceRole(bytes32,address)"],
    abi: CONTENT_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ROLE_HASHES.pauser, ctx.deployer],
  },
  {
    label: "ProfileRegistry.renounceRole(ADMIN_ROLE)",
    contractNames: ["ProfileRegistry", "TransparentUpgradeableProxy"],
    target: "ProfileRegistry",
    functionNames: ["renounceRole", "renounceRole(bytes32,address)"],
    abi: PROFILE_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ROLE_HASHES.admin, ctx.deployer],
  },
  {
    label: "FrontendRegistry.renounceRole(ADMIN_ROLE)",
    contractNames: ["FrontendRegistry", "TransparentUpgradeableProxy"],
    target: "FrontendRegistry",
    functionNames: ["renounceRole", "renounceRole(bytes32,address)"],
    abi: FRONTEND_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ROLE_HASHES.admin, ctx.deployer],
  },
  {
    label: "CategoryRegistry.renounceRole(ADMIN_ROLE)",
    contractName: "CategoryRegistry",
    target: "CategoryRegistry",
    functionName: "renounceRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.admin, ctx.deployer],
  },
  {
    label:
      "ClusterPayoutOracle.setRoundPayoutSnapshotConsumer(QUESTION_REWARD)",
    contractName: "ClusterPayoutOracle",
    target: "ClusterPayoutOracle",
    functionName: "setRoundPayoutSnapshotConsumer(uint8,address)",
    args: (ctx) => ["1", ctx.questionRewardPoolEscrow],
    final: true,
    keyArgCount: 1,
  },
  {
    label:
      "ClusterPayoutOracle.setRoundPayoutSnapshotConsumer(QUESTION_BUNDLE_REWARD)",
    contractName: "ClusterPayoutOracle",
    target: "ClusterPayoutOracle",
    functionName: "setRoundPayoutSnapshotConsumer(uint8,address)",
    args: (ctx) => ["4", ctx.questionRewardPoolEscrow],
    final: true,
    keyArgCount: 1,
  },
  {
    label: "ClusterPayoutOracle.setRoundPayoutSnapshotConsumer(LAUNCH_CREDIT)",
    contractName: "ClusterPayoutOracle",
    target: "ClusterPayoutOracle",
    functionName: "setRoundPayoutSnapshotConsumer(uint8,address)",
    args: (ctx) => ["2", ctx.launchDistributionPool],
    final: true,
    keyArgCount: 1,
  },
  {
    label: "ClusterPayoutOracle.setRoundPayoutSnapshotConsumer(PUBLIC_RATING)",
    contractName: "ClusterPayoutOracle",
    target: "ClusterPayoutOracle",
    functionName: "setRoundPayoutSnapshotConsumer(uint8,address)",
    args: (ctx) => ["3", ctx.contentRegistry],
    final: true,
    keyArgCount: 1,
  },
  {
    label: "ClusterPayoutOracle.setRoundPayoutSnapshotConsumer(RBTS_SETTLEMENT)",
    contractName: "ClusterPayoutOracle",
    target: "ClusterPayoutOracle",
    functionName: "setRoundPayoutSnapshotConsumer(uint8,address)",
    args: (ctx) => ["5", ctx.roundVotingEngine],
    final: true,
    keyArgCount: 1,
  },
  {
    label: "ClusterPayoutOracle.grantRole(DEFAULT_ADMIN_ROLE)",
    contractName: "ClusterPayoutOracle",
    target: "ClusterPayoutOracle",
    functionName: "grantRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.defaultAdmin, ctx.governance],
  },
  {
    label: "ClusterPayoutOracle.grantRole(CONFIG_ROLE)",
    contractName: "ClusterPayoutOracle",
    target: "ClusterPayoutOracle",
    functionName: "grantRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.config, ctx.governance],
  },
  {
    label: "ClusterPayoutOracle.grantRole(ARBITER_ROLE)",
    contractName: "ClusterPayoutOracle",
    target: "ClusterPayoutOracle",
    functionName: "grantRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.arbiter, ctx.governance],
  },
  {
    label: "ClusterPayoutOracle.setOracleConfig",
    contractName: "ClusterPayoutOracle",
    target: "ClusterPayoutOracle",
    functionName: "setOracleConfig(uint64,uint256,address)",
    args: (ctx) => [
      positiveUintArgument,
      DEFAULT_CLUSTER_PAYOUT_CHALLENGE_BOND,
      ctx.governance,
    ],
  },
  {
    label: "ClusterPayoutOracle.renounceRole(DEFAULT_ADMIN_ROLE)",
    contractName: "ClusterPayoutOracle",
    target: "ClusterPayoutOracle",
    functionName: "renounceRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.defaultAdmin, ctx.deployer],
  },
  {
    label: "ClusterPayoutOracle.renounceRole(CONFIG_ROLE)",
    contractName: "ClusterPayoutOracle",
    target: "ClusterPayoutOracle",
    functionName: "renounceRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.config, ctx.deployer],
  },
  {
    label: "ClusterPayoutOracle.renounceRole(ARBITER_ROLE)",
    contractName: "ClusterPayoutOracle",
    target: "ClusterPayoutOracle",
    functionName: "renounceRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.arbiter, ctx.deployer],
  },
  {
    label: "ProtocolConfig.setClusterPayoutOracle",
    contractName: "TransparentUpgradeableProxy",
    target: "ProtocolConfig",
    functionName: "setClusterPayoutOracle",
    abi: PROTOCOL_CONFIG_COMPLETION_ABI,
    args: (ctx) => [ctx.clusterPayoutOracle],
    final: true,
  },
  {
    label: "ProtocolConfig.setConfig",
    contractName: "TransparentUpgradeableProxy",
    target: "ProtocolConfig",
    functionName: "setConfig",
    abi: PROTOCOL_CONFIG_COMPLETION_ABI,
    args: () => ["1200", "1200", "3", "100"],
    final: true,
  },
  {
    label: "ProtocolConfig.setRewardDistributor",
    contractName: "TransparentUpgradeableProxy",
    target: "ProtocolConfig",
    functionName: "setRewardDistributor",
    abi: PROTOCOL_CONFIG_COMPLETION_ABI,
    args: (ctx) => [ctx.roundRewardDistributor],
    final: true,
  },
  {
    label: "ProtocolConfig.setFrontendRegistry",
    contractName: "TransparentUpgradeableProxy",
    target: "ProtocolConfig",
    functionName: "setFrontendRegistry",
    abi: PROTOCOL_CONFIG_COMPLETION_ABI,
    args: (ctx) => [ctx.frontendRegistry],
    final: true,
  },
  {
    label: "ProtocolConfig.setCategoryRegistry",
    contractName: "TransparentUpgradeableProxy",
    target: "ProtocolConfig",
    functionName: "setCategoryRegistry",
    abi: PROTOCOL_CONFIG_COMPLETION_ABI,
    args: (ctx) => [ctx.categoryRegistry],
    final: true,
  },
  {
    label: "ProtocolConfig.setRaterRegistry",
    contractName: "TransparentUpgradeableProxy",
    target: "ProtocolConfig",
    functionName: "setRaterRegistry",
    abi: PROTOCOL_CONFIG_COMPLETION_ABI,
    args: (ctx) => [ctx.raterRegistry],
    final: true,
  },
  {
    label: "ProfileRegistry.setRaterRegistry",
    contractNames: ["ProfileRegistry", "TransparentUpgradeableProxy"],
    target: "ProfileRegistry",
    functionNames: ["setRaterRegistry", "setRaterRegistry(address)"],
    abi: PROFILE_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ctx.raterRegistry],
    final: true,
  },
  {
    label: "FrontendRegistry.setVotingEngine",
    contractNames: ["FrontendRegistry", "TransparentUpgradeableProxy"],
    target: "FrontendRegistry",
    functionNames: ["setVotingEngine", "setVotingEngine(address)"],
    abi: FRONTEND_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ctx.roundVotingEngine],
    final: true,
  },
  {
    label: "FrontendRegistry.initializeFeeCreditor",
    contractNames: ["FrontendRegistry", "TransparentUpgradeableProxy"],
    target: "FrontendRegistry",
    functionNames: ["initializeFeeCreditor", "initializeFeeCreditor(address)"],
    abi: FRONTEND_REGISTRY_COMPLETION_ABI,
    args: (ctx) => [ctx.roundRewardDistributor],
    final: true,
  },
  {
    label: "LaunchDistributionPool.setClusterPayoutOracle",
    contractName: "LaunchDistributionPool",
    target: "LaunchDistributionPool",
    functionName: "setClusterPayoutOracle(address)",
    args: (ctx) => [ctx.clusterPayoutOracle],
    final: true,
  },
  {
    label: "LaunchDistributionPool.setRoundClusterReadyAtSource",
    contractName: "LaunchDistributionPool",
    target: "LaunchDistributionPool",
    functionName: "setRoundClusterReadyAtSource(address)",
    args: (ctx) => [ctx.roundVotingEngine],
    final: true,
  },
  {
    label: "LaunchDistributionPool.setAuthorizedCaller(RoundRewardDistributor)",
    contractName: "LaunchDistributionPool",
    target: "LaunchDistributionPool",
    functionName: "setAuthorizedCaller(address,bool)",
    args: (ctx) => [ctx.roundRewardDistributor, true],
    final: true,
    keyArgCount: 1,
  },
  {
    label: "LaunchDistributionPool.setAuthorizedCaller(AdvisoryVoteRecorder)",
    contractName: "LaunchDistributionPool",
    target: "LaunchDistributionPool",
    functionName: "setAuthorizedCaller(address,bool)",
    args: (ctx) => [ctx.advisoryVoteRecorder, true],
    final: true,
    keyArgCount: 1,
  },
  {
    label: "ProtocolConfig.setAdvisoryVoteRecorder",
    contractName: "TransparentUpgradeableProxy",
    target: "ProtocolConfig",
    functionName: "setAdvisoryVoteRecorder",
    abi: PROTOCOL_CONFIG_COMPLETION_ABI,
    args: (ctx) => [ctx.advisoryVoteRecorder],
    final: true,
  },
  {
    label: "LoopReputation.mint(Treasury)",
    contractName: "LoopReputation",
    target: "LoopReputation",
    functionName: "mint(address,uint256)",
    abi: LOOP_REPUTATION_COMPLETION_ABI,
    args: (ctx) => [ctx.governance, TREASURY_LREP_AMOUNT.toString()],
  },
  {
    label: "TimelockController.grantRole(PROPOSER_ROLE)",
    contractName: "TimelockController",
    target: "TimelockController",
    functionName: "grantRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.timelockProposer, ctx.governor],
  },
  {
    label: "TimelockController.grantRole(CANCELLER_ROLE)",
    contractName: "TimelockController",
    target: "TimelockController",
    functionName: "grantRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.timelockCanceller, ctx.governor],
  },
  {
    label: "TimelockController.renounceRole(DEFAULT_ADMIN_ROLE)",
    contractName: "TimelockController",
    target: "TimelockController",
    functionName: "renounceRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.defaultAdmin, ctx.deployer],
  },
  {
    label: "LoopReputation.setGovernor",
    contractName: "LoopReputation",
    target: "LoopReputation",
    functionName: "setGovernor(address)",
    abi: LOOP_REPUTATION_COMPLETION_ABI,
    args: (ctx) => [ctx.governor],
    final: true,
  },
  {
    label: "LoopReputation.renounceRole(CONFIG_ROLE)",
    contractName: "LoopReputation",
    target: "LoopReputation",
    functionName: "renounceRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.config, ctx.deployer],
  },
  {
    label: "LoopReputation.mint(LaunchDistributionPool)",
    contractName: "LoopReputation",
    target: "LoopReputation",
    functionName: "mint(address,uint256)",
    abi: LOOP_REPUTATION_COMPLETION_ABI,
    args: (ctx) => [ctx.launchDistributionPool, "75000000000000"],
  },
  {
    label: "LaunchDistributionPool.accountPrefundedPoolDeposit",
    contractName: "LaunchDistributionPool",
    target: "LaunchDistributionPool",
    functionName: "accountPrefundedPoolDeposit(uint256)",
    args: () => ["75000000000000"],
  },
  {
    label: "LaunchDistributionPool.setLegacyContributorRoot",
    contractName: "LaunchDistributionPool",
    target: "LaunchDistributionPool",
    functionName: "setLegacyContributorRoot(bytes32,uint256)",
    args: () => [
      "0xcaa28d15e6c6c1bb47d347a413cb808e40c38a7e43171ce9a131983a92b97d18",
      "9000000000000",
    ],
    final: true,
  },
  {
    label: "LaunchDistributionPool.transferOwnership",
    contractName: "LaunchDistributionPool",
    target: "LaunchDistributionPool",
    functionName: "transferOwnership(address)",
    args: (ctx) => [ctx.governance],
    final: true,
  },
  {
    label: "LoopReputation.renounceRole(MINTER_ROLE)",
    contractName: "LoopReputation",
    target: "LoopReputation",
    functionName: "renounceRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.minter, ctx.deployer],
  },
  {
    label: "ProtocolConfig.setLaunchDistributionPool",
    contractName: "TransparentUpgradeableProxy",
    target: "ProtocolConfig",
    functionName: "setLaunchDistributionPool",
    abi: PROTOCOL_CONFIG_COMPLETION_ABI,
    args: (ctx) => [ctx.launchDistributionPool],
    final: true,
  },
  {
    label: "ProtocolConfig.renounceRole",
    contractName: "TransparentUpgradeableProxy",
    target: "ProtocolConfig",
    functionName: "renounceRole",
    abi: PROTOCOL_CONFIG_COMPLETION_ABI,
    args: (ctx) => [ROLE_HASHES.config, ctx.deployer],
  },
];

function parseBlockNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  return Number(BigInt(value));
}

function checksum(address) {
  return getAddress(address);
}

function proxyAdminAddressFromReceipt(proxyAddress, receipt) {
  const proxy = proxyAddress.toLowerCase();
  const logAddress = receipt?.logs
    ?.map((log) => log.address?.toLowerCase())
    .find((address) => address && address !== proxy);
  if (!logAddress) {
    throw new Error(`Missing ProxyAdmin log address for proxy ${proxyAddress}`);
  }
  return checksum(logAddress);
}

function txInput(tx) {
  return tx?.transaction?.input || tx?.input || tx?.data || "";
}

function txTarget(tx) {
  return tx?.contractAddress || tx?.to || tx?.transaction?.to;
}

function txTargets(tx) {
  return [tx?.contractAddress, tx?.to, tx?.transaction?.to].filter(
    (target) => typeof target === "string" && target !== ""
  );
}

function txHash(tx) {
  return tx?.hash || tx?.transaction?.hash || tx?.transactionHash;
}

function normalizeHash(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function buildReceiptByTransactionHash(receipts) {
  const receiptByHash = new Map();
  for (const [index, receipt] of receipts.entries()) {
    const receiptHash = normalizeHash(receipt?.transactionHash);
    if (!receiptHash) {
      throw new Error(`Receipt ${index} is missing transactionHash`);
    }
    if (receiptByHash.has(receiptHash)) {
      throw new Error(`Duplicate receipt for transaction ${receiptHash}`);
    }
    receiptByHash.set(receiptHash, receipt);
  }
  return receiptByHash;
}

function receiptForTransaction(tx, receiptByHash) {
  const hash = normalizeHash(txHash(tx));
  if (!hash) {
    throw new Error(
      `Broadcast transaction is missing hash for ${
        tx.contractName || "unknown contract"
      }`
    );
  }
  const receipt = receiptByHash.get(hash);
  if (!receipt) {
    throw new Error(`Missing receipt for transaction ${hash}`);
  }
  return receipt;
}

function receiptSucceeded(receipt) {
  return receipt.status === "0x1" || receipt.status === 1;
}

function requireSuccessfulReceipt(tx, receiptByHash) {
  const receipt = receiptForTransaction(tx, receiptByHash);
  if (!receiptSucceeded(receipt)) {
    throw new Error(
      `Broadcast transaction ${normalizeHash(txHash(tx))} failed`
    );
  }
  return receipt;
}

function deploymentAddressByName(deployments, contractName) {
  return Object.entries(deployments).find(
    ([address, deployedContractName]) =>
      address.startsWith("0x") && deployedContractName === contractName
  )?.[0];
}

function requireDeploymentAddress(deployments, contractName) {
  const address = deploymentAddressByName(deployments, contractName);
  if (!address)
    throw new Error(`Missing deployment address for ${contractName}`);
  return address;
}

function firstBroadcaster(transactions) {
  const sender = transactions
    .map((tx) => tx?.transaction?.from || tx?.from)
    .find((from) => typeof from === "string" && from !== "");
  if (!sender) {
    throw new Error("Broadcast is missing deployer sender");
  }
  return checksum(sender);
}

function completionContext(transactions, deployments) {
  return {
    networkName: deployments.networkName,
    deployer: firstBroadcaster(transactions),
    governance: requireDeploymentAddress(deployments, "TimelockController"),
    timelockController: requireDeploymentAddress(
      deployments,
      "TimelockController"
    ),
    loopReputation: requireDeploymentAddress(deployments, "LoopReputation"),
    governor: requireDeploymentAddress(deployments, "RateLoopGovernor"),
    x402QuestionSubmitter: requireDeploymentAddress(
      deployments,
      "X402QuestionSubmitter"
    ),
    categoryRegistry: requireDeploymentAddress(deployments, "CategoryRegistry"),
    clusterPayoutOracle: requireDeploymentAddress(
      deployments,
      "ClusterPayoutOracle"
    ),
    launchDistributionPool: requireDeploymentAddress(
      deployments,
      "LaunchDistributionPool"
    ),
    advisoryVoteRecorder: requireDeploymentAddress(
      deployments,
      "AdvisoryVoteRecorder"
    ),
    frontendRegistry: requireDeploymentAddress(deployments, "FrontendRegistry"),
    profileRegistry: requireDeploymentAddress(deployments, "ProfileRegistry"),
    contentRegistry: requireDeploymentAddress(deployments, "ContentRegistry"),
    protocolConfig: requireDeploymentAddress(deployments, "ProtocolConfig"),
    roundVotingEngine: requireDeploymentAddress(
      deployments,
      "RoundVotingEngine"
    ),
    roundRewardDistributor: requireDeploymentAddress(
      deployments,
      "RoundRewardDistributor"
    ),
    raterRegistry: requireDeploymentAddress(deployments, "RaterRegistry"),
    questionRewardPoolEscrow: requireDeploymentAddress(
      deployments,
      "QuestionRewardPoolEscrow"
    ),
    confidentialityEscrow: requireDeploymentAddress(
      deployments,
      "ConfidentialityEscrow"
    ),
    feedbackRegistry: requireDeploymentAddress(deployments, "FeedbackRegistry"),
    feedbackBonusEscrow: requireDeploymentAddress(
      deployments,
      "FeedbackBonusEscrow"
    ),
  };
}

function expectedTargetAddress(requirement, ctx) {
  if (typeof requirement.target === "function") return requirement.target(ctx);
  return ctx[lowerFirst(requirement.target)];
}

function contractNameMatches(tx, requirement) {
  const names = requirement.contractNames || [requirement.contractName];
  return names.includes(tx.contractName);
}

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function addressEquals(left, right) {
  try {
    return checksum(left) === checksum(right);
  } catch {
    return false;
  }
}

function targetMatches(tx, expectedTarget) {
  const targets = txTargets(tx);
  return (
    targets.length > 0 &&
    targets.every((target) => addressEquals(target, expectedTarget))
  );
}

function decodedCall(tx, requirement) {
  if (!requirement.abi) {
    return null;
  }
  const data = txInput(tx);
  if (!data || data === "0x") {
    return null;
  }
  try {
    return decodeFunctionData({ abi: requirement.abi, data });
  } catch {
    return null;
  }
}

function txFunctionName(tx, requirement) {
  const decoded = decodedCall(tx, requirement);
  return decoded?.functionName || tx.function;
}

function functionNameMatches(tx, requirement) {
  const actual = txFunctionName(tx, requirement);
  const expectedNames = requirement.functionNames || [requirement.functionName];
  return expectedNames.some((expected) =>
    functionNamesEquivalent(actual, expected)
  );
}

function functionNamesEquivalent(actual, expected) {
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  return functionBaseName(actual) === functionBaseName(expected);
}

function functionBaseName(functionName) {
  return String(functionName).split("(")[0];
}

function txArguments(tx, requirement) {
  if (Array.isArray(tx.arguments)) {
    return tx.arguments;
  }
  const decoded = decodedCall(tx, requirement);
  return decoded?.args || [];
}

function argumentMatches(actual, expected) {
  if (typeof expected === "function") {
    try {
      return expected(actual);
    } catch {
      return false;
    }
  }
  if (typeof expected === "boolean") {
    return (
      actual === expected || String(actual).toLowerCase() === String(expected)
    );
  }
  if (typeof expected === "number" || typeof expected === "bigint") {
    try {
      return BigInt(actual) === BigInt(expected);
    } catch {
      return false;
    }
  }
  if (
    typeof expected === "string" &&
    expected.startsWith("0x") &&
    expected.length === 42
  ) {
    return typeof actual === "string" && addressEquals(actual, expected);
  }
  if (typeof expected === "string" && expected.startsWith("0x")) {
    return (
      typeof actual === "string" &&
      actual.toLowerCase() === expected.toLowerCase()
    );
  }
  try {
    return BigInt(actual) === BigInt(expected);
  } catch {
    return String(actual).toLowerCase() === String(expected).toLowerCase();
  }
}

function positiveUintArgument(actual) {
  try {
    return BigInt(actual) > 0n;
  } catch {
    return false;
  }
}

function argumentsMatch(actualArgs, expectedArgs) {
  if (!expectedArgs) return true;
  if (!Array.isArray(actualArgs) || actualArgs.length < expectedArgs.length) {
    return false;
  }
  return expectedArgs.every((expected, index) =>
    argumentMatches(actualArgs[index], expected)
  );
}

function callMatches(tx, receiptByHash, requirement, ctx) {
  if (tx.transactionType !== "CALL") return false;
  if (!contractNameMatches(tx, requirement)) return false;
  if (!targetMatches(tx, expectedTargetAddress(requirement, ctx))) return false;
  if (!functionNameMatches(tx, requirement)) return false;
  const expectedArgs =
    typeof requirement.args === "function"
      ? requirement.args(ctx)
      : requirement.args;
  if (!argumentsMatch(txArguments(tx, requirement), expectedArgs)) return false;
  requireSuccessfulReceipt(tx, receiptByHash);
  return true;
}

function callShapeMatches(tx, receiptByHash, requirement, ctx) {
  if (tx.transactionType !== "CALL") return false;
  if (!contractNameMatches(tx, requirement)) return false;
  if (!targetMatches(tx, expectedTargetAddress(requirement, ctx))) return false;
  if (!functionNameMatches(tx, requirement)) return false;
  const keyArgCount = requirement.keyArgCount || 0;
  if (keyArgCount > 0) {
    const expectedArgs =
      typeof requirement.args === "function"
        ? requirement.args(ctx)
        : requirement.args;
    if (
      !argumentsMatch(
        txArguments(tx, requirement).slice(0, keyArgCount),
        expectedArgs.slice(0, keyArgCount)
      )
    ) {
      return false;
    }
  }
  requireSuccessfulReceipt(tx, receiptByHash);
  return true;
}

function callInfo(tx, abi) {
  const decoded = decodedCall(tx, { abi });
  return {
    functionName: decoded?.functionName || tx.function,
    args: Array.isArray(tx.arguments) ? tx.arguments : decoded?.args || [],
  };
}

function assertProxyAdminsPinnedToGovernance(transactions, deployments) {
  const ctx = completionContext(transactions, deployments);
  let proxyIndex = 0;
  for (const tx of transactions) {
    if (
      (tx.transactionType !== "CREATE" && tx.transactionType !== "CREATE2") ||
      tx.contractName !== "TransparentUpgradeableProxy"
    ) {
      continue;
    }

    const deploymentName = PROXY_DEPLOYMENT_NAMES[proxyIndex];
    proxyIndex++;
    const admin = tx.arguments?.[1];
    if (!admin || !addressEquals(admin, ctx.governance)) {
      throw new Error(
        `${deploymentName} proxy admin is not initialized to governance`
      );
    }
  }
}

function assertNoUnexpectedAuthorityMutations(transactions, deployments) {
  const ctx = completionContext(transactions, deployments);
  for (const tx of transactions) {
    if (tx.transactionType !== "CALL") continue;
    if (targetMatches(tx, ctx.timelockController)) {
      const { functionName, args } = callInfo(tx, TIMELOCK_AUTHORITY_ABI);
      const [role, account] = args;
      if (
        functionName === "grantRole" ||
        functionName === "grantRole(bytes32,address)"
      ) {
        if (
          role === ROLE_HASHES.timelockProposer ||
          role === ROLE_HASHES.timelockCanceller
        ) {
          if (!addressEquals(account, ctx.governor)) {
            throw new Error(
              "TimelockController grants governance role to unexpected account"
            );
          }
        }
        if (role === ROLE_HASHES.defaultAdmin) {
          throw new Error("TimelockController grants DEFAULT_ADMIN_ROLE");
        }
      }
      if (
        (functionName === "revokeRole" ||
          functionName === "revokeRole(bytes32,address)" ||
          functionName === "renounceRole" ||
          functionName === "renounceRole(bytes32,address)") &&
        (role === ROLE_HASHES.timelockProposer ||
          role === ROLE_HASHES.timelockCanceller) &&
        addressEquals(account, ctx.governor)
      ) {
        throw new Error("TimelockController removes governor authority");
      }
    }

    if (targetMatches(tx, ctx.loopReputation)) {
      const { functionName, args } = callInfo(
        tx,
        LOOP_REPUTATION_AUTHORITY_ABI
      );
      if (
        (functionName === "setGovernor" ||
          functionName === "setGovernor(address)") &&
        !addressEquals(args[0], ctx.governor)
      ) {
        throw new Error(
          "LoopReputation.setGovernor targets unexpected account"
        );
      }
    }
  }
}

function assertContentRegistryEndsUnpaused(
  transactions,
  receiptByHash,
  deployments
) {
  const ctx = completionContext(transactions, deployments);
  let paused = false;
  for (const tx of transactions) {
    if (
      tx.transactionType !== "CALL" ||
      !targetMatches(tx, ctx.contentRegistry)
    ) {
      continue;
    }
    const { functionName } = callInfo(tx, CONTENT_REGISTRY_COMPLETION_ABI);
    if (functionName === "pause" || functionName === "pause()") {
      requireSuccessfulReceipt(tx, receiptByHash);
      paused = true;
    }
    if (functionName === "unpause" || functionName === "unpause()") {
      requireSuccessfulReceipt(tx, receiptByHash);
      paused = false;
    }
  }
  if (paused) {
    throw new Error("ContentRegistry remains paused after deployment");
  }
}

function assertRequiredCompletionCalls(
  transactions,
  receiptByHash,
  deployments
) {
  const ctx = completionContext(transactions, deployments);
  const missing = [];
  const staleFinal = [];
  for (const requirement of REQUIRED_COMPLETION_CALLS) {
    if (requirement.requiredWhen && !requirement.requiredWhen(ctx)) {
      continue;
    }
    const count = transactions.filter((tx) =>
      callMatches(tx, receiptByHash, requirement, ctx)
    ).length;
    if (count < 1) {
      missing.push(requirement.label);
    }
    if (requirement.final) {
      const shaped = transactions.filter((tx) =>
        callShapeMatches(tx, receiptByHash, requirement, ctx)
      );
      if (
        shaped.length > 0 &&
        !callMatches(shaped[shaped.length - 1], receiptByHash, requirement, ctx)
      ) {
        staleFinal.push(requirement.label);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Broadcast is missing required completion calls: ${missing.join(", ")}`
    );
  }
  if (staleFinal.length > 0) {
    throw new Error(
      `Broadcast final state does not match required completion calls: ${staleFinal.join(
        ", "
      )}`
    );
  }
}

export function reconstructDeploymentExportFromBroadcast(
  broadcastData,
  networkName,
  { deploymentProfile = resolveDeploymentProfile(networkName) } = {}
) {
  if (
    PRODUCTION_NETWORK_NAMES.has(networkName) &&
    deploymentProfile !== "production"
  ) {
    throw new Error(
      `${networkName} deployment exports must use deploymentProfile=production`
    );
  }

  const transactions = broadcastData.transactions || [];
  const receipts = broadcastData.receipts || [];
  const receiptByHash = buildReceiptByTransactionHash(receipts);
  const deployments = {};
  let latestBlockNumber = 0;
  let proxyIndex = 0;

  for (const receipt of receipts) {
    latestBlockNumber = Math.max(
      latestBlockNumber,
      parseBlockNumber(receipt?.blockNumber)
    );
  }

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];

    if (tx.transactionType !== "CREATE" && tx.transactionType !== "CREATE2") {
      continue;
    }

    if (!tx.contractAddress) continue;
    const receipt = requireSuccessfulReceipt(tx, receiptByHash);

    if (tx.contractName === "TransparentUpgradeableProxy") {
      const deploymentName = PROXY_DEPLOYMENT_NAMES[proxyIndex];
      if (!deploymentName) {
        throw new Error(
          `Unexpected extra TransparentUpgradeableProxy deployment at transaction ${i}`
        );
      }
      const proxyAddress = checksum(tx.contractAddress);
      deployments[proxyAddress] = deploymentName;
      deployments[
        proxyAdminAddressFromReceipt(proxyAddress, receipt)
      ] = `${deploymentName}ProxyAdmin`;
      proxyIndex++;
      continue;
    }

    if (DIRECT_DEPLOYMENT_NAMES.has(tx.contractName)) {
      deployments[checksum(tx.contractAddress)] = tx.contractName;
    }
  }

  if (proxyIndex !== PROXY_DEPLOYMENT_NAMES.length) {
    throw new Error(
      `Expected ${PROXY_DEPLOYMENT_NAMES.length} proxy deployments, found ${proxyIndex}`
    );
  }
  if (latestBlockNumber === 0) {
    throw new Error("Latest broadcast has no receipt block numbers");
  }

  deployments.networkName = networkName;

  assertProxyAdminsPinnedToGovernance(transactions, deployments);
  assertRequiredCompletionCalls(transactions, receiptByHash, deployments);
  assertContentRegistryEndsUnpaused(transactions, receiptByHash, deployments);
  assertNoUnexpectedAuthorityMutations(transactions, deployments);

  deployments.deploymentBlockNumber = latestBlockNumber;
  deployments.deploymentComplete = "true";
  deployments.deploymentProfile = deploymentProfile;
  deployments.networkName = networkName;
  return sortDeploymentExport(deployments);
}

export function resolveDeploymentProfile(networkName, env = process.env) {
  const value = env[RATELOOP_DEPLOYMENT_PROFILE_ENV]?.trim();
  if (
    PRODUCTION_NETWORK_NAMES.has(networkName) &&
    value &&
    value !== "production"
  ) {
    throw new Error(
      `${RATELOOP_DEPLOYMENT_PROFILE_ENV} must be production for mainnet deployment exports`
    );
  }
  return (
    value ||
    DEFAULT_DEPLOYMENT_PROFILE_BY_NETWORK[networkName] ||
    DEFAULT_DEPLOYMENT_PROFILE
  );
}

function sortDeploymentExport(deployments) {
  const sorted = {};
  Object.entries(deployments)
    .filter(([key]) => key.startsWith("0x"))
    .sort(([left], [right]) =>
      left.toLowerCase().localeCompare(right.toLowerCase())
    )
    .forEach(([address, contractName]) => {
      sorted[address] = contractName;
    });

  sorted.deploymentBlockNumber = deployments.deploymentBlockNumber;
  sorted.deploymentComplete = deployments.deploymentComplete;
  sorted.deploymentProfile = deployments.deploymentProfile;
  sorted.networkName = deployments.networkName;
  return sorted;
}

export function refreshDeploymentExportFromLatestBroadcast({
  projectRoot,
  deployTarget,
}) {
  const chain = DEPLOY_TARGET_TO_CHAIN[deployTarget];
  if (!chain) return false;

  const broadcastPath = join(
    projectRoot,
    "broadcast",
    "Deploy.s.sol",
    String(chain.chainId),
    "run-latest.json"
  );
  if (!existsSync(broadcastPath)) {
    throw new Error(`Missing latest broadcast file: ${broadcastPath}`);
  }

  const broadcastData = JSON.parse(readFileSync(broadcastPath, "utf8"));
  const deploymentExport = reconstructDeploymentExportFromBroadcast(
    broadcastData,
    chain.networkName
  );

  const deploymentsDir = join(projectRoot, "deployments");
  mkdirSync(deploymentsDir, { recursive: true });
  writeFileSync(
    join(deploymentsDir, `${chain.chainId}.json`),
    `${JSON.stringify(deploymentExport, null, 2)}\n`
  );
  return true;
}

function main() {
  const deployTarget = process.env.DEPLOY_TARGET_NETWORK;
  if (!deployTarget) {
    const rpcUrl = process.env.RPC_URL?.trim();
    if (!rpcUrl || rpcUrl === "localhost") return;
    throw new Error(
      "DEPLOY_TARGET_NETWORK is required to export non-local deployment broadcasts. Use `yarn deploy --network <network>` or set DEPLOY_TARGET_NETWORK to the intended supported network."
    );
  }
  if (deployTarget === "localhost") return;

  const refreshed = refreshDeploymentExportFromLatestBroadcast({
    projectRoot: join(__dirname, ".."),
    deployTarget,
  });
  if (refreshed) {
    console.log(`Refreshed deployment export for ${deployTarget}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
