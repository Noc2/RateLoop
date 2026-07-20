import { isAddress, keccak256, zeroAddress } from "viem";

export const TOKENLESS_DEPLOYMENT_SCHEMA = "rateloop-tokenless-deployment-v4";
export const TOKENLESS_DEPLOYMENT_VERSION = 4;
export const TOKENLESS_DEPLOYMENT_KEY_VERSION = "tokenless-v4";
export const TOKENLESS_BASE_SEPOLIA_CHAIN_ID = 84532;
export const TOKENLESS_BASE_SEPOLIA_NETWORK = "baseSepolia";

const REQUIRED_CONTRACTS = [
  "TestUSDC",
  "CredentialIssuer",
  "TokenlessPanel",
  "TokenlessFeedbackBonus",
];
const OPTIONAL_CONTRACTS = ["X402PanelSubmitter"];
const BEACON_VERIFIER_ARTIFACT = "QuicknetTBeaconVerifier";
const ALLOWED_CONTRACTS = new Set([
  ...REQUIRED_CONTRACTS,
  ...OPTIONAL_CONTRACTS,
]);
const ALLOWED_DEPLOYMENTS = new Set([
  ...ALLOWED_CONTRACTS,
  BEACON_VERIFIER_ARTIFACT,
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

function normalizeCodeHash(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new Error(`${label} must be a 32-byte hex hash.`);
  }
  return value.toLowerCase();
}

export async function attachTokenlessRuntimeCodeEvidence(
  artifact,
  { getBytecode, expectedBeaconVerifierRuntimeCodeHash },
) {
  const evidenced = structuredClone(artifact);
  for (const [name, contract] of Object.entries(evidenced.contracts)) {
    const code = await getBytecode(contract.address);
    if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(code)) {
      throw new Error(`${name} has no exact deployed runtime bytecode.`);
    }
    contract.runtimeCodeHash = keccak256(code).toLowerCase();
  }
  const beaconCode = await getBytecode(evidenced.beaconVerifier);
  if (
    typeof beaconCode !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})+$/u.test(beaconCode)
  ) {
    throw new Error("BeaconVerifier has no exact deployed runtime bytecode.");
  }
  const observedBeaconVerifierRuntimeCodeHash = keccak256(beaconCode).toLowerCase();
  const expectedBeaconVerifierHash = normalizeCodeHash(
    expectedBeaconVerifierRuntimeCodeHash,
    "compiled QuicknetTBeaconVerifier runtimeCodeHash",
  );
  if (observedBeaconVerifierRuntimeCodeHash !== expectedBeaconVerifierHash) {
    throw new Error(
      `QuicknetTBeaconVerifier runtime bytecode hash mismatch: compiled ${expectedBeaconVerifierHash}, deployed ${observedBeaconVerifierRuntimeCodeHash}.`,
    );
  }
  evidenced.beaconVerifierRuntimeCodeHash = observedBeaconVerifierRuntimeCodeHash;
  evidenced.runtimeCodeEvidenceComplete = true;
  return validateTokenlessDeploymentArtifact(evidenced, {
    requireRuntimeCodeEvidence: true,
    expectedBeaconVerifierRuntimeCodeHash: expectedBeaconVerifierHash,
  });
}

function transactionHash(transaction, label = "Transaction") {
  const hash = transaction.hash ?? transaction.transactionHash ?? null;
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error(`${label} hash is missing or malformed.`);
  }
  return hash.toLowerCase();
}

function receiptIndexes(receipts) {
  const successfulByAddress = new Map();
  const byHash = new Map();
  for (const receipt of receipts ?? []) {
    const hash = transactionHash(receipt, "Receipt");
    if (byHash.has(hash))
      throw new Error(`Duplicate receipt transaction hash ${hash}.`);
    byHash.set(hash, receipt);
    if (receipt.status !== "0x1" && receipt.status !== 1) continue;
    if (
      receipt.contractAddress === null ||
      receipt.contractAddress === undefined
    )
      continue;
    const normalizedAddress = normalizeAddress(
      receipt.contractAddress,
      `Receipt ${hash} contractAddress`,
    ).toLowerCase();
    const matches = successfulByAddress.get(normalizedAddress) ?? [];
    matches.push(receipt);
    successfulByAddress.set(normalizedAddress, matches);
  }
  return { byHash, successfulByAddress };
}

function deploymentLabel(contractName) {
  return contractName === "MockERC20" ? "TestUSDC" : contractName;
}

function artifactName(contractName) {
  return contractName === "MockERC20" ? "MockERC20" : contractName;
}

function findCreates(broadcast) {
  const receipts = receiptIndexes(broadcast.receipts);
  const createTransactions = (broadcast.transactions ?? []).filter(
    (transaction) => transaction.transactionType === "CREATE",
  );
  const createHashes = new Set();
  for (const transaction of createTransactions) {
    const contractName = transaction.contractName ?? "unknown";
    const hash = transactionHash(
      transaction,
      `${contractName} CREATE transaction`,
    );
    if (createHashes.has(hash))
      throw new Error(`Duplicate CREATE transaction hash ${hash}.`);
    if (!receipts.byHash.has(hash)) {
      throw new Error(
        `Missing receipt for ${contractName} CREATE transaction ${hash}.`,
      );
    }
    createHashes.add(hash);
  }

  const creates = [];
  const usedReceiptHashes = new Set();

  for (const transaction of createTransactions) {
    const contractName = transaction.contractName ?? "unknown";
    const address = normalizeAddress(
      transaction.contractAddress,
      `${contractName} address`,
    );
    // Forge can permute CREATE hashes in deployCode broadcasts. The receipt's
    // deployed address is the stable identity, while the complete hash set is
    // still checked above so an unrelated receipt cannot be substituted.
    const matchingReceipts =
      receipts.successfulByAddress.get(address.toLowerCase()) ?? [];
    if (matchingReceipts.length !== 1) {
      throw new Error(
        `Expected exactly one successful receipt for ${contractName} at ${address}; found ${matchingReceipts.length}.`,
      );
    }
    const receipt = matchingReceipts[0];
    const receiptHash = transactionHash(
      receipt,
      `${contractName} deployment receipt`,
    );
    if (!createHashes.has(receiptHash)) {
      throw new Error(
        `Successful receipt ${receiptHash} for ${contractName} at ${address} is not referenced by a CREATE transaction.`,
      );
    }
    if (usedReceiptHashes.has(receiptHash)) {
      throw new Error(
        `Deployment receipt ${receiptHash} was reused by multiple CREATE transactions.`,
      );
    }
    usedReceiptHashes.add(receiptHash);

    creates.push({
      address,
      arguments: Array.isArray(transaction.arguments)
        ? transaction.arguments
        : [],
      blockNumber: normalizeBlockNumber(
        receipt.blockNumber,
        `${contractName} deployedOnBlock`,
      ),
      contractName: transaction.contractName,
    });
  }

  return creates;
}

function oneDeployment(creates, label) {
  const matches = creates.filter(
    (deployment) => deploymentLabel(deployment.contractName) === label,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Tokenless broadcast must deploy exactly one ${label}; found ${matches.length}.`,
    );
  }
  return matches[0];
}

function optionalDeployment(creates, label) {
  const matches = creates.filter(
    (deployment) => deploymentLabel(deployment.contractName) === label,
  );
  if (matches.length > 1) {
    throw new Error(
      `Tokenless broadcast may deploy at most one ${label}; found ${matches.length}.`,
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
  feedbackBonus,
}) {
  return [
    TOKENLESS_DEPLOYMENT_KEY_VERSION,
    String(chainId),
    panel.toLowerCase(),
    credentialIssuer.toLowerCase(),
    (x402PanelSubmitter ?? zeroAddress).toLowerCase(),
    feedbackBonus.toLowerCase(),
  ].join(":");
}

export function reconstructTokenlessDeploymentFromBroadcast(
  broadcast,
  {
    chainId = TOKENLESS_BASE_SEPOLIA_CHAIN_ID,
    networkName = TOKENLESS_BASE_SEPOLIA_NETWORK,
  } = {},
) {
  if (chainId !== TOKENLESS_BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `${TOKENLESS_DEPLOYMENT_KEY_VERSION} only supports Base Sepolia (${TOKENLESS_BASE_SEPOLIA_CHAIN_ID}); received ${chainId}.`,
    );
  }
  if (networkName !== TOKENLESS_BASE_SEPOLIA_NETWORK) {
    throw new Error(
      `${TOKENLESS_DEPLOYMENT_KEY_VERSION} networkName must be ${TOKENLESS_BASE_SEPOLIA_NETWORK}.`,
    );
  }

  const creates = findCreates(broadcast);
  const unexpectedNames = creates
    .map((deployment) => deploymentLabel(deployment.contractName))
    .filter((contractName) => !ALLOWED_DEPLOYMENTS.has(contractName));
  if (unexpectedNames.length > 0) {
    throw new Error(
      `Refusing mixed or unknown tokenless deployment broadcast: ${[
        ...new Set(unexpectedNames),
      ].join(", ")}.`,
    );
  }

  const testUsdc = oneDeployment(creates, "TestUSDC");
  const credentialIssuer = oneDeployment(creates, "CredentialIssuer");
  const beaconVerifierDeployment = oneDeployment(
    creates,
    BEACON_VERIFIER_ARTIFACT,
  );
  const panel = oneDeployment(creates, "TokenlessPanel");
  const feedbackBonus = oneDeployment(creates, "TokenlessFeedbackBonus");
  const x402PanelSubmitter = optionalDeployment(creates, "X402PanelSubmitter");

  if (
    feedbackBonus.arguments.length < 2 ||
    !sameAddress(feedbackBonus.arguments[0], testUsdc.address) ||
    !sameAddress(feedbackBonus.arguments[1], credentialIssuer.address)
  ) {
    throw new Error(
      "TokenlessFeedbackBonus constructor wiring must match the exported TestUSDC and CredentialIssuer addresses.",
    );
  }

  if (
    panel.arguments.length < 3 ||
    !sameAddress(panel.arguments[0], testUsdc.address) ||
    !sameAddress(panel.arguments[1], credentialIssuer.address)
  ) {
    throw new Error(
      "TokenlessPanel constructor wiring must match the exported TestUSDC and CredentialIssuer addresses.",
    );
  }
  const beaconVerifier = normalizeAddress(
    panel.arguments[2],
    "TokenlessPanel beacon verifier",
  );
  if (!sameAddress(beaconVerifier, beaconVerifierDeployment.address)) {
    throw new Error(
      "TokenlessPanel beacon verifier must be the QuicknetTBeaconVerifier deployed in the same broadcast.",
    );
  }

  if (
    x402PanelSubmitter &&
    (x402PanelSubmitter.arguments.length < 2 ||
      !sameAddress(x402PanelSubmitter.arguments[0], testUsdc.address) ||
      !sameAddress(x402PanelSubmitter.arguments[1], panel.address))
  ) {
    throw new Error(
      "X402PanelSubmitter constructor wiring must match the exported TestUSDC and TokenlessPanel addresses.",
    );
  }

  const contracts = {};
  for (const [label, deployment] of [
    ["TestUSDC", testUsdc],
    ["CredentialIssuer", credentialIssuer],
    ["TokenlessPanel", panel],
    ["TokenlessFeedbackBonus", feedbackBonus],
    ["X402PanelSubmitter", x402PanelSubmitter],
  ]) {
    if (!deployment) continue;
    contracts[label] = {
      address: deployment.address,
      artifact: artifactName(deployment.contractName),
      deployedOnBlock: deployment.blockNumber,
    };
  }

  // Ponder applies this single start block to every indexed contract, so it must
  // be the earliest deployed block or constructor events emitted before the last
  // deployment (e.g. the credential issuer's initial signer epoch) are skipped.
  const deploymentBlockNumber = Math.min(
    ...Object.values(contracts).map((contract) => contract.deployedOnBlock),
  );
  const deploymentKey = buildTokenlessDeploymentKey({
    chainId,
    credentialIssuer: credentialIssuer.address,
    panel: panel.address,
    x402PanelSubmitter: x402PanelSubmitter?.address,
    feedbackBonus: feedbackBonus.address,
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
    beaconVerifier,
    beaconVerifierArtifact: BEACON_VERIFIER_ARTIFACT,
    beaconVerifierDeployedOnBlock: beaconVerifierDeployment.blockNumber,
    contracts,
    testCurrency: {
      contract: "TestUSDC",
      decimals: 6,
      symbol: "tUSDC",
      unrestrictedMint: true,
    },
  });
}

export function validateTokenlessDeploymentArtifact(
  artifact,
  {
    requireRuntimeCodeEvidence = false,
    expectedBeaconVerifierRuntimeCodeHash,
  } = {},
) {
  if (!artifact || typeof artifact !== "object") {
    throw new Error("Tokenless deployment artifact must be an object.");
  }
  if (artifact.schemaVersion !== TOKENLESS_DEPLOYMENT_SCHEMA) {
    throw new Error(
      `Unsupported tokenless deployment schema ${String(
        artifact.schemaVersion,
      )}.`,
    );
  }
  if (artifact.version !== TOKENLESS_DEPLOYMENT_VERSION) {
    throw new Error(
      `Unsupported tokenless deployment version ${String(artifact.version)}.`,
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
  normalizeAddress(artifact.beaconVerifier, "beaconVerifier");
  if (artifact.beaconVerifierArtifact !== BEACON_VERIFIER_ARTIFACT) {
    throw new Error(
      `Tokenless deployment beacon verifier artifact must be ${BEACON_VERIFIER_ARTIFACT}.`,
    );
  }
  normalizeBlockNumber(
    artifact.beaconVerifierDeployedOnBlock,
    "beaconVerifierDeployedOnBlock",
  );
  if (artifact.beaconVerifierRuntimeCodeHash !== undefined) {
    normalizeCodeHash(
      artifact.beaconVerifierRuntimeCodeHash,
      "beaconVerifierRuntimeCodeHash",
    );
  }
  if (expectedBeaconVerifierRuntimeCodeHash !== undefined) {
    const expectedHash = normalizeCodeHash(
      expectedBeaconVerifierRuntimeCodeHash,
      "compiled QuicknetTBeaconVerifier runtimeCodeHash",
    );
    if (artifact.beaconVerifierRuntimeCodeHash !== expectedHash) {
      throw new Error(
        "Tokenless deployment beacon verifier runtime code hash does not match the compiled artifact.",
      );
    }
  }
  if (
    requireRuntimeCodeEvidence &&
    (artifact.runtimeCodeEvidenceComplete !== true ||
      artifact.beaconVerifierRuntimeCodeHash === undefined)
  ) {
    throw new Error("Tokenless deployment runtime bytecode evidence is incomplete.");
  }

  const contracts = artifact.contracts;
  if (!contracts || typeof contracts !== "object") {
    throw new Error("Tokenless deployment artifact contracts are missing.");
  }
  for (const name of Object.keys(contracts)) {
    if (!ALLOWED_CONTRACTS.has(name)) {
      throw new Error(
        `Unexpected contract ${name} in ${TOKENLESS_DEPLOYMENT_KEY_VERSION} deployment artifact.`,
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
    if (contract.runtimeCodeHash !== undefined) {
      normalizeCodeHash(contract.runtimeCodeHash, `${name} runtimeCodeHash`);
    } else if (requireRuntimeCodeEvidence) {
      throw new Error(`${name} runtimeCodeHash is missing.`);
    }
  }
  if (contracts.X402PanelSubmitter) {
    normalizeAddress(
      contracts.X402PanelSubmitter.address,
      "X402PanelSubmitter address",
    );
    normalizeBlockNumber(
      contracts.X402PanelSubmitter.deployedOnBlock,
      "X402PanelSubmitter deployedOnBlock",
    );
  }

  normalizeAddress(
    contracts.TokenlessFeedbackBonus.address,
    "TokenlessFeedbackBonus address",
  );

  // The exported common start block must equal the earliest deployed block of
  // every included contract; Ponder indexes from it and any larger value would
  // skip earlier constructor events.
  const minimumDeployedBlock = Math.min(
    ...Object.values(contracts).map((contract) =>
      normalizeBlockNumber(contract.deployedOnBlock, "contract deployedOnBlock"),
    ),
  );
  if (
    normalizeBlockNumber(artifact.deploymentBlockNumber, "deploymentBlockNumber") !==
    minimumDeployedBlock
  ) {
    throw new Error(
      "Tokenless deployment block must equal the earliest contract deployment block.",
    );
  }

  const expectedKey = buildTokenlessDeploymentKey({
    chainId: artifact.chainId,
    credentialIssuer: contracts.CredentialIssuer.address,
    panel: contracts.TokenlessPanel.address,
    x402PanelSubmitter: contracts.X402PanelSubmitter?.address,
    feedbackBonus: contracts.TokenlessFeedbackBonus.address,
  });
  if (artifact.deploymentKey !== expectedKey) {
    throw new Error(
      "Tokenless deployment key does not match the exported contract addresses.",
    );
  }

  return artifact;
}

export function serializeTokenlessDeploymentArtifact(artifact) {
  return `${JSON.stringify(
    validateTokenlessDeploymentArtifact(artifact, {
      requireRuntimeCodeEvidence: true,
    }),
    null,
    2,
  )}\n`;
}
