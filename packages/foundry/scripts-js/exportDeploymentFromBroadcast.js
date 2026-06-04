import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { decodeFunctionData, getAddress, parseAbi } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEPLOY_TARGET_TO_CHAIN = {
  worldchain: { chainId: 480, networkName: "worldchain" },
  worldchainSepolia: { chainId: 4801, networkName: "worldchainSepolia" },
};

const PROXY_DEPLOYMENT_NAMES = [
  "FrontendRegistry",
  "ProfileRegistry",
  "ContentRegistry",
  "ProtocolConfig",
  "RoundVotingEngine",
  "RoundRewardDistributor",
  "RaterRegistry",
  "QuestionRewardPoolEscrow",
  "FeedbackRegistry",
  "FeedbackBonusEscrow",
];

const DIRECT_DEPLOYMENT_NAMES = new Set([
  "TimelockController",
  "LoopReputation",
  "RateLoopGovernor",
  "X402QuestionSubmitter",
  "CategoryRegistry",
  "ClusterPayoutOracle",
  "LaunchDistributionPool",
  "AdvisoryVoteRecorder",
]);

const ROLE_HASHES = {
  defaultAdmin:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  admin: "0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775",
  config: "0x82db594318110a04b6349ce48645aa69f0892751bc893d15e61d9e2b9c4630f5",
  arbiter: "0xbb08418a67729a078f87bbc8d02a770929bb68f5bfdf134ae2ead6ed38e2f4ae",
  minter: "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
  timelockProposer:
    "0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1",
  timelockCanceller:
    "0xfd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783",
  pauser: "0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a",
  seeder: "0x240afcd1926e36e0297a1eb63ba484f52ddbef788e7f4e9b38b0dcc66de129e1",
};

const PROTOCOL_CONFIG_COMPLETION_ABI = parseAbi([
  "function setClusterPayoutOracle(address value)",
  "function setAdvisoryVoteRecorder(address value)",
  "function setLaunchDistributionPool(address value)",
  "function renounceRole(bytes32 role,address account)",
]);

const REQUIRED_COMPLETION_CALLS = [
  {
    label: "RaterRegistry.renounceRole(ADMIN_ROLE)",
    contractName: "RaterRegistry",
    target: "RaterRegistry",
    functionName: "renounceRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.admin, ctx.deployer],
  },
  {
    label: "RaterRegistry.renounceRole(SEEDER_ROLE)",
    contractName: "RaterRegistry",
    target: "RaterRegistry",
    functionName: "renounceRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.seeder, ctx.deployer],
  },
  {
    label: "FeedbackRegistry.renounceRole(CONFIG_ROLE)",
    contractName: "FeedbackRegistry",
    target: "FeedbackRegistry",
    functionName: "renounceRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.config, ctx.deployer],
  },
  {
    label: "ContentRegistry.renounceRole(CONFIG_ROLE)",
    contractName: "ContentRegistry",
    target: "ContentRegistry",
    functionName: "renounceRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.config, ctx.deployer],
  },
  {
    label: "ContentRegistry.renounceRole(PAUSER_ROLE)",
    contractName: "ContentRegistry",
    target: "ContentRegistry",
    functionName: "renounceRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.pauser, ctx.deployer],
  },
  {
    label: "ProfileRegistry.renounceRole(ADMIN_ROLE)",
    contractName: "ProfileRegistry",
    target: "ProfileRegistry",
    functionName: "renounceRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.admin, ctx.deployer],
  },
  {
    label: "FrontendRegistry.renounceRole(ADMIN_ROLE)",
    contractName: "FrontendRegistry",
    target: "FrontendRegistry",
    functionName: "renounceRole(bytes32,address)",
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
  },
  {
    label: "ClusterPayoutOracle.setRoundPayoutSnapshotConsumer(LAUNCH_CREDIT)",
    contractName: "ClusterPayoutOracle",
    target: "ClusterPayoutOracle",
    functionName: "setRoundPayoutSnapshotConsumer(uint8,address)",
    args: (ctx) => ["2", ctx.launchDistributionPool],
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
    args: (ctx) => ["43200", "5000000", ctx.governance],
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
  },
  {
    label: "LaunchDistributionPool.setClusterPayoutOracle",
    contractName: "LaunchDistributionPool",
    target: "LaunchDistributionPool",
    functionName: "setClusterPayoutOracle(address)",
    args: (ctx) => [ctx.clusterPayoutOracle],
  },
  {
    label: "LaunchDistributionPool.setRoundClusterReadyAtSource",
    contractName: "LaunchDistributionPool",
    target: "LaunchDistributionPool",
    functionName: "setRoundClusterReadyAtSource(address)",
    args: (ctx) => [ctx.roundVotingEngine],
  },
  {
    label: "LaunchDistributionPool.setAuthorizedCaller(RoundRewardDistributor)",
    contractName: "LaunchDistributionPool",
    target: "LaunchDistributionPool",
    functionName: "setAuthorizedCaller(address,bool)",
    args: (ctx) => [ctx.roundRewardDistributor, true],
  },
  {
    label: "ProtocolConfig.setAdvisoryVoteRecorder",
    contractName: "TransparentUpgradeableProxy",
    target: "ProtocolConfig",
    functionName: "setAdvisoryVoteRecorder",
    abi: PROTOCOL_CONFIG_COMPLETION_ABI,
    args: (ctx) => [ctx.advisoryVoteRecorder],
  },
  {
    label: "LaunchDistributionPool.setAuthorizedCaller(AdvisoryVoteRecorder)",
    contractName: "LaunchDistributionPool",
    target: "LaunchDistributionPool",
    functionName: "setAuthorizedCaller(address,bool)",
    args: (ctx) => [ctx.advisoryVoteRecorder, true],
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
    args: (ctx) => [ctx.governor],
  },
  {
    label: "LoopReputation.renounceRole(CONFIG_ROLE)",
    contractName: "LoopReputation",
    target: "LoopReputation",
    functionName: "renounceRole(bytes32,address)",
    args: (ctx) => [ROLE_HASHES.config, ctx.deployer],
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
  },
  {
    label: "LaunchDistributionPool.transferOwnership",
    contractName: "LaunchDistributionPool",
    target: "LaunchDistributionPool",
    functionName: "transferOwnership(address)",
    args: (ctx) => [ctx.governance],
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
    deployer: firstBroadcaster(transactions),
    governance: requireDeploymentAddress(deployments, "TimelockController"),
    timelockController: requireDeploymentAddress(
      deployments,
      "TimelockController"
    ),
    loopReputation: requireDeploymentAddress(deployments, "LoopReputation"),
    governor: requireDeploymentAddress(deployments, "RateLoopGovernor"),
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

function txArguments(tx, requirement) {
  if (Array.isArray(tx.arguments)) {
    return tx.arguments;
  }
  const decoded = decodedCall(tx, requirement);
  return decoded?.args || [];
}

function argumentMatches(actual, expected) {
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
  if (tx.contractName !== requirement.contractName) return false;
  if (!targetMatches(tx, expectedTargetAddress(requirement, ctx))) return false;
  if (txFunctionName(tx, requirement) !== requirement.functionName)
    return false;
  const expectedArgs =
    typeof requirement.args === "function"
      ? requirement.args(ctx)
      : requirement.args;
  if (!argumentsMatch(txArguments(tx, requirement), expectedArgs)) return false;
  requireSuccessfulReceipt(tx, receiptByHash);
  return true;
}

function assertRequiredCompletionCalls(
  transactions,
  receiptByHash,
  deployments
) {
  const ctx = completionContext(transactions, deployments);
  const missing = [];
  for (const requirement of REQUIRED_COMPLETION_CALLS) {
    const count = transactions.filter((tx) =>
      callMatches(tx, receiptByHash, requirement, ctx)
    ).length;
    if (count < 1) {
      missing.push(requirement.label);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Broadcast is missing required completion calls: ${missing.join(", ")}`
    );
  }
}

export function reconstructDeploymentExportFromBroadcast(
  broadcastData,
  networkName
) {
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
  assertRequiredCompletionCalls(transactions, receiptByHash, deployments);

  deployments.deploymentBlockNumber = latestBlockNumber;
  deployments.deploymentComplete = "true";
  deployments.networkName = networkName;
  return sortDeploymentExport(deployments);
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
  if (!deployTarget || deployTarget === "localhost") return;

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
