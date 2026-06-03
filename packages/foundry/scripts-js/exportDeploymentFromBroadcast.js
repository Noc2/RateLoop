import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getAddress } from "viem";

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

const PROTOCOL_CONFIG_PROXY_COMPLETION_SELECTORS = [
  ["ProtocolConfig.setClusterPayoutOracle", "0x440616e4"],
  ["ProtocolConfig.setLaunchDistributionPool", "0xa0ad8aa9"],
  ["ProtocolConfig.renounceRole", "0x36568abe"],
];

const REQUIRED_COMPLETION_CALLS = [
  {
    label: "RaterRegistry.freezeWorldIdVerifierConfig",
    contractName: "RaterRegistry",
    functionName: "freezeWorldIdVerifierConfig()",
  },
  {
    label: "RaterRegistry.renounceRole(ADMIN_ROLE)",
    contractName: "RaterRegistry",
    functionName: "renounceRole(bytes32,address)",
    firstArgument: ROLE_HASHES.admin,
  },
  {
    label: "RaterRegistry.renounceRole(SEEDER_ROLE)",
    contractName: "RaterRegistry",
    functionName: "renounceRole(bytes32,address)",
    firstArgument: ROLE_HASHES.seeder,
  },
  {
    label: "FeedbackRegistry.renounceRole(CONFIG_ROLE)",
    contractName: "FeedbackRegistry",
    functionName: "renounceRole(bytes32,address)",
    firstArgument: ROLE_HASHES.config,
  },
  {
    label: "ContentRegistry.renounceRole(CONFIG_ROLE)",
    contractName: "ContentRegistry",
    functionName: "renounceRole(bytes32,address)",
    firstArgument: ROLE_HASHES.config,
  },
  {
    label: "ContentRegistry.renounceRole(PAUSER_ROLE)",
    contractName: "ContentRegistry",
    functionName: "renounceRole(bytes32,address)",
    firstArgument: ROLE_HASHES.pauser,
  },
  {
    label: "ProfileRegistry.renounceRole(ADMIN_ROLE)",
    contractName: "ProfileRegistry",
    functionName: "renounceRole(bytes32,address)",
    firstArgument: ROLE_HASHES.admin,
  },
  {
    label: "FrontendRegistry.renounceRole(ADMIN_ROLE)",
    contractName: "FrontendRegistry",
    functionName: "renounceRole(bytes32,address)",
    firstArgument: ROLE_HASHES.admin,
  },
  {
    label: "CategoryRegistry.renounceRole(ADMIN_ROLE)",
    contractName: "CategoryRegistry",
    functionName: "renounceRole(bytes32,address)",
    firstArgument: ROLE_HASHES.admin,
  },
  {
    label: "ClusterPayoutOracle.setRoundPayoutSnapshotConsumer",
    contractName: "ClusterPayoutOracle",
    functionName: "setRoundPayoutSnapshotConsumer(uint8,address)",
    minCount: 2,
  },
  {
    label: "ClusterPayoutOracle.grantRole(DEFAULT_ADMIN_ROLE)",
    contractName: "ClusterPayoutOracle",
    functionName: "grantRole(bytes32,address)",
    firstArgument: ROLE_HASHES.defaultAdmin,
  },
  {
    label: "ClusterPayoutOracle.grantRole(CONFIG_ROLE)",
    contractName: "ClusterPayoutOracle",
    functionName: "grantRole(bytes32,address)",
    firstArgument: ROLE_HASHES.config,
  },
  {
    label: "ClusterPayoutOracle.grantRole(ARBITER_ROLE)",
    contractName: "ClusterPayoutOracle",
    functionName: "grantRole(bytes32,address)",
    firstArgument: ROLE_HASHES.arbiter,
  },
  {
    label: "ClusterPayoutOracle.setOracleConfig",
    contractName: "ClusterPayoutOracle",
    functionName: "setOracleConfig(uint64,uint256,address)",
  },
  {
    label: "ClusterPayoutOracle.renounceRole(DEFAULT_ADMIN_ROLE)",
    contractName: "ClusterPayoutOracle",
    functionName: "renounceRole(bytes32,address)",
    firstArgument: ROLE_HASHES.defaultAdmin,
  },
  {
    label: "ClusterPayoutOracle.renounceRole(CONFIG_ROLE)",
    contractName: "ClusterPayoutOracle",
    functionName: "renounceRole(bytes32,address)",
    firstArgument: ROLE_HASHES.config,
  },
  {
    label: "ClusterPayoutOracle.renounceRole(ARBITER_ROLE)",
    contractName: "ClusterPayoutOracle",
    functionName: "renounceRole(bytes32,address)",
    firstArgument: ROLE_HASHES.arbiter,
  },
  {
    label: "LaunchDistributionPool.setClusterPayoutOracle",
    contractName: "LaunchDistributionPool",
    functionName: "setClusterPayoutOracle(address)",
  },
  {
    label: "LaunchDistributionPool.setRoundClusterReadyAtSource",
    contractName: "LaunchDistributionPool",
    functionName: "setRoundClusterReadyAtSource(address)",
  },
  {
    label: "LaunchDistributionPool.setAuthorizedCaller",
    contractName: "LaunchDistributionPool",
    functionName: "setAuthorizedCaller(address,bool)",
    minCount: 2,
  },
  {
    label: "TimelockController.grantRole(PROPOSER_ROLE)",
    contractName: "TimelockController",
    functionName: "grantRole(bytes32,address)",
    firstArgument: ROLE_HASHES.timelockProposer,
  },
  {
    label: "TimelockController.grantRole(CANCELLER_ROLE)",
    contractName: "TimelockController",
    functionName: "grantRole(bytes32,address)",
    firstArgument: ROLE_HASHES.timelockCanceller,
  },
  {
    label: "TimelockController.renounceRole(DEFAULT_ADMIN_ROLE)",
    contractName: "TimelockController",
    functionName: "renounceRole(bytes32,address)",
    firstArgument: ROLE_HASHES.defaultAdmin,
  },
  {
    label: "LoopReputation.setGovernor",
    contractName: "LoopReputation",
    functionName: "setGovernor(address)",
  },
  {
    label: "LoopReputation.renounceRole(CONFIG_ROLE)",
    contractName: "LoopReputation",
    functionName: "renounceRole(bytes32,address)",
    firstArgument: ROLE_HASHES.config,
  },
  {
    label: "LaunchDistributionPool.accountPrefundedPoolDeposit",
    contractName: "LaunchDistributionPool",
    functionName: "accountPrefundedPoolDeposit(uint256)",
  },
  {
    label: "LaunchDistributionPool.setLegacyContributorRoot",
    contractName: "LaunchDistributionPool",
    functionName: "setLegacyContributorRoot(bytes32,uint256)",
  },
  {
    label: "LaunchDistributionPool.transferOwnership",
    contractName: "LaunchDistributionPool",
    functionName: "transferOwnership(address)",
  },
  {
    label: "LoopReputation.renounceRole(MINTER_ROLE)",
    contractName: "LoopReputation",
    functionName: "renounceRole(bytes32,address)",
    firstArgument: ROLE_HASHES.minter,
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

function callMatches(tx, receiptByHash, requirement) {
  if (tx.transactionType !== "CALL") return false;
  if (tx.contractName !== requirement.contractName) return false;
  if (tx.function !== requirement.functionName) return false;
  if (requirement.firstArgument) {
    const firstArgument = tx.arguments?.[0];
    if (
      typeof firstArgument !== "string" ||
      firstArgument.toLowerCase() !== requirement.firstArgument.toLowerCase()
    ) {
      return false;
    }
  }
  requireSuccessfulReceipt(tx, receiptByHash);
  return true;
}

function assertRequiredCompletionCalls(
  transactions,
  receiptByHash,
  deployments
) {
  const missing = [];
  for (const requirement of REQUIRED_COMPLETION_CALLS) {
    const count = transactions.filter((tx) =>
      callMatches(tx, receiptByHash, requirement)
    ).length;
    if (count < (requirement.minCount || 1)) {
      missing.push(requirement.label);
    }
  }

  const protocolConfigAddress = Object.entries(deployments).find(
    ([address, contractName]) =>
      address.startsWith("0x") && contractName === "ProtocolConfig"
  )?.[0];
  if (!protocolConfigAddress) {
    missing.push("ProtocolConfig deployment");
  } else {
    for (const [
      label,
      selector,
    ] of PROTOCOL_CONFIG_PROXY_COMPLETION_SELECTORS) {
      const found = transactions.some((tx, index) => {
        const target = txTarget(tx);
        const matches =
          tx.transactionType === "CALL" &&
          typeof target === "string" &&
          target.toLowerCase() === protocolConfigAddress.toLowerCase() &&
          txInput(tx).toLowerCase().startsWith(selector);
        if (!matches) return false;
        requireSuccessfulReceipt(tx, receiptByHash);
        return true;
      });
      if (!found) missing.push(label);
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
