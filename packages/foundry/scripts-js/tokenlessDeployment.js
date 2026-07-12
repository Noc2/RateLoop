import { isAddress, zeroAddress } from "viem";

export const TOKENLESS_DEPLOYMENT_SCHEMA = "rateloop-tokenless-deployment-v1";
export const TOKENLESS_DEPLOYMENT_VERSION = 1;
export const TOKENLESS_BASE_SEPOLIA_CHAIN_ID = 84532;
export const TOKENLESS_BASE_SEPOLIA_NETWORK = "baseSepolia";

const LEGACY_PROTOCOL_CONTRACTS = new Set([
  "AdvisoryVoteRecorder",
  "CategoryRegistry",
  "ClusterPayoutOracle",
  "ConfidentialityEscrow",
  "ContentRegistry",
  "FeedbackBonusEscrow",
  "FeedbackRegistry",
  "FrontendRegistry",
  "LaunchDistributionPool",
  "LoopReputation",
  "ProfileRegistry",
  "ProtocolConfig",
  "QuestionRewardPoolEscrow",
  "RateLoopGovernor",
  "RaterRegistry",
  "RoundRewardDistributor",
  "RoundVotingEngine",
  "TimelockController",
  "X402QuestionSubmitter",
]);

const REQUIRED_CONTRACTS = ["TestUSDC", "CredentialIssuer", "TokenlessPanel"];
const OPTIONAL_CONTRACTS = ["X402PanelSubmitter"];
const ALLOWED_CONTRACTS = new Set([
  ...REQUIRED_CONTRACTS,
  ...OPTIONAL_CONTRACTS,
]);

function normalizeAddress(value, label) {
  if (!isAddress(value) || value.toLowerCase() === zeroAddress) {
    throw new Error(`${label} must be a non-zero address.`);
  }
  return value;
}

function normalizeBlockNumber(value, label) {
  const parsed =
    typeof value === "string" && value.startsWith("0x")
      ? Number.parseInt(value, 16)
      : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive block number.`);
  }
  return parsed;
}

function transactionHash(transaction) {
  return transaction.hash ?? transaction.transactionHash ?? null;
}

function successfulReceiptByHash(receipts) {
  const byHash = new Map();
  for (const receipt of receipts ?? []) {
    const hash = receipt.transactionHash?.toLowerCase();
    if (hash) byHash.set(hash, receipt);
  }
  return byHash;
}

function deploymentLabel(contractName) {
  return contractName === "MockERC20" ? "TestUSDC" : contractName;
}

function artifactName(contractName) {
  return contractName === "MockERC20" ? "MockERC20" : contractName;
}

function findCreates(broadcast) {
  const receipts = successfulReceiptByHash(broadcast.receipts);
  const creates = [];

  for (const transaction of broadcast.transactions ?? []) {
    if (transaction.transactionType !== "CREATE") continue;
    const receipt = receipts.get(transactionHash(transaction)?.toLowerCase());
    if (!receipt) {
      throw new Error(
        `Missing receipt for ${transaction.contractName ?? "unknown"} CREATE.`
      );
    }
    if (receipt.status === "0x0" || receipt.status === 0) {
      throw new Error(
        `${transaction.contractName ?? "unknown"} CREATE transaction reverted.`
      );
    }

    creates.push({
      address: normalizeAddress(
        transaction.contractAddress ?? receipt.contractAddress,
        `${transaction.contractName ?? "unknown"} address`
      ),
      arguments: Array.isArray(transaction.arguments)
        ? transaction.arguments
        : [],
      blockNumber: normalizeBlockNumber(
        receipt.blockNumber,
        `${transaction.contractName ?? "unknown"} deployedOnBlock`
      ),
      contractName: transaction.contractName,
    });
  }

  return creates;
}

function oneDeployment(creates, label) {
  const matches = creates.filter(
    (deployment) => deploymentLabel(deployment.contractName) === label
  );
  if (matches.length !== 1) {
    throw new Error(
      `Tokenless broadcast must deploy exactly one ${label}; found ${matches.length}.`
    );
  }
  return matches[0];
}

function optionalDeployment(creates, label) {
  const matches = creates.filter(
    (deployment) => deploymentLabel(deployment.contractName) === label
  );
  if (matches.length > 1) {
    throw new Error(
      `Tokenless broadcast may deploy at most one ${label}; found ${matches.length}.`
    );
  }
  return matches[0] ?? null;
}

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

export function buildTokenlessDeploymentKey({
  chainId,
  credentialIssuer,
  panel,
  x402PanelSubmitter,
}) {
  return [
    "tokenless-v1",
    String(chainId),
    panel.toLowerCase(),
    credentialIssuer.toLowerCase(),
    (x402PanelSubmitter ?? zeroAddress).toLowerCase(),
  ].join(":");
}

export function reconstructTokenlessDeploymentFromBroadcast(
  broadcast,
  {
    chainId = TOKENLESS_BASE_SEPOLIA_CHAIN_ID,
    networkName = TOKENLESS_BASE_SEPOLIA_NETWORK,
  } = {}
) {
  if (chainId !== TOKENLESS_BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `tokenless-v1 only supports Base Sepolia (${TOKENLESS_BASE_SEPOLIA_CHAIN_ID}); received ${chainId}.`
    );
  }
  if (networkName !== TOKENLESS_BASE_SEPOLIA_NETWORK) {
    throw new Error(
      `tokenless-v1 networkName must be ${TOKENLESS_BASE_SEPOLIA_NETWORK}.`
    );
  }

  const creates = findCreates(broadcast);
  const mixedLegacyNames = creates
    .map((deployment) => deployment.contractName)
    .filter((contractName) => LEGACY_PROTOCOL_CONTRACTS.has(contractName));
  if (mixedLegacyNames.length > 0) {
    throw new Error(
      `Refusing mixed legacy/tokenless deployment broadcast: ${[
        ...new Set(mixedLegacyNames),
      ].join(", ")}.`
    );
  }

  const testUsdc = oneDeployment(creates, "TestUSDC");
  const credentialIssuer = oneDeployment(creates, "CredentialIssuer");
  const panel = oneDeployment(creates, "TokenlessPanel");
  const x402PanelSubmitter = optionalDeployment(creates, "X402PanelSubmitter");

  if (
    panel.arguments.length < 2 ||
    !sameAddress(panel.arguments[0], testUsdc.address) ||
    !sameAddress(panel.arguments[1], credentialIssuer.address)
  ) {
    throw new Error(
      "TokenlessPanel constructor wiring must match the exported TestUSDC and CredentialIssuer addresses."
    );
  }

  if (
    x402PanelSubmitter &&
    (x402PanelSubmitter.arguments.length < 2 ||
      !sameAddress(x402PanelSubmitter.arguments[0], testUsdc.address) ||
      !sameAddress(x402PanelSubmitter.arguments[1], panel.address))
  ) {
    throw new Error(
      "X402PanelSubmitter constructor wiring must match the exported TestUSDC and TokenlessPanel addresses."
    );
  }

  const contracts = {};
  for (const [label, deployment] of [
    ["TestUSDC", testUsdc],
    ["CredentialIssuer", credentialIssuer],
    ["TokenlessPanel", panel],
    ["X402PanelSubmitter", x402PanelSubmitter],
  ]) {
    if (!deployment) continue;
    contracts[label] = {
      address: deployment.address,
      artifact: artifactName(deployment.contractName),
      deployedOnBlock: deployment.blockNumber,
    };
  }

  const deploymentBlockNumber = Math.max(
    ...Object.values(contracts).map((contract) => contract.deployedOnBlock)
  );
  const deploymentKey = buildTokenlessDeploymentKey({
    chainId,
    credentialIssuer: credentialIssuer.address,
    panel: panel.address,
    x402PanelSubmitter: x402PanelSubmitter?.address,
  });

  return validateTokenlessDeploymentArtifact({
    schemaVersion: TOKENLESS_DEPLOYMENT_SCHEMA,
    version: TOKENLESS_DEPLOYMENT_VERSION,
    deploymentComplete: true,
    deploymentProfile: "test",
    networkName,
    chainId,
    deploymentBlockNumber,
    deploymentKey,
    contracts,
    testCurrency: {
      contract: "TestUSDC",
      decimals: 6,
      symbol: "tUSDC",
      unrestrictedMint: true,
    },
  });
}

export function validateTokenlessDeploymentArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") {
    throw new Error("Tokenless deployment artifact must be an object.");
  }
  if (artifact.schemaVersion !== TOKENLESS_DEPLOYMENT_SCHEMA) {
    throw new Error(
      `Unsupported tokenless deployment schema ${String(
        artifact.schemaVersion
      )}.`
    );
  }
  if (artifact.version !== TOKENLESS_DEPLOYMENT_VERSION) {
    throw new Error(
      `Unsupported tokenless deployment version ${String(artifact.version)}.`
    );
  }
  if (artifact.deploymentComplete !== true) {
    throw new Error("Tokenless deployment artifact is not marked complete.");
  }
  if (
    artifact.chainId !== TOKENLESS_BASE_SEPOLIA_CHAIN_ID ||
    artifact.networkName !== TOKENLESS_BASE_SEPOLIA_NETWORK
  ) {
    throw new Error("Tokenless deployment artifact is not for Base Sepolia.");
  }
  normalizeBlockNumber(artifact.deploymentBlockNumber, "deploymentBlockNumber");

  const contracts = artifact.contracts;
  if (!contracts || typeof contracts !== "object") {
    throw new Error("Tokenless deployment artifact contracts are missing.");
  }
  for (const name of Object.keys(contracts)) {
    if (!ALLOWED_CONTRACTS.has(name)) {
      throw new Error(
        `Unexpected contract ${name} in tokenless-v1 deployment artifact.`
      );
    }
  }
  for (const name of REQUIRED_CONTRACTS) {
    const contract = contracts[name];
    if (!contract) {
      throw new Error(`Tokenless deployment artifact is missing ${name}.`);
    }
    normalizeAddress(contract.address, `${name} address`);
    normalizeBlockNumber(contract.deployedOnBlock, `${name} deployedOnBlock`);
    if (typeof contract.artifact !== "string" || !contract.artifact) {
      throw new Error(`${name} artifact name is missing.`);
    }
  }
  if (contracts.X402PanelSubmitter) {
    normalizeAddress(
      contracts.X402PanelSubmitter.address,
      "X402PanelSubmitter address"
    );
    normalizeBlockNumber(
      contracts.X402PanelSubmitter.deployedOnBlock,
      "X402PanelSubmitter deployedOnBlock"
    );
  }

  const expectedKey = buildTokenlessDeploymentKey({
    chainId: artifact.chainId,
    credentialIssuer: contracts.CredentialIssuer.address,
    panel: contracts.TokenlessPanel.address,
    x402PanelSubmitter: contracts.X402PanelSubmitter?.address,
  });
  if (artifact.deploymentKey !== expectedKey) {
    throw new Error(
      "Tokenless deployment key does not match the exported contract addresses."
    );
  }

  return artifact;
}

export function serializeTokenlessDeploymentArtifact(artifact) {
  return `${JSON.stringify(
    validateTokenlessDeploymentArtifact(artifact),
    null,
    2
  )}\n`;
}
