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

export function reconstructDeploymentExportFromBroadcast(
  broadcastData,
  networkName
) {
  const transactions = broadcastData.transactions || [];
  const receipts = broadcastData.receipts || [];
  const deployments = {};
  let latestBlockNumber = 0;
  let proxyIndex = 0;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const receipt = receipts[i];
    latestBlockNumber = Math.max(
      latestBlockNumber,
      parseBlockNumber(receipt?.blockNumber)
    );

    if (tx.transactionType !== "CREATE" && tx.transactionType !== "CREATE2") {
      continue;
    }

    if (!tx.contractAddress) continue;

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
