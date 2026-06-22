import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const WORLDCHAIN_SEPOLIA_CHAIN_ID = 4801;
const WORLDCHAIN_SEPOLIA_CHAIN_ID_HEX = "0x12c1";
const WORLDCHAIN_SEPOLIA_USDC = "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88";
export const WORLDCHAIN_SEPOLIA_READINESS_CONFIG = {
  appEnvName: "WORLDCHAIN_SEPOLIA_APP_URL",
  chainId: WORLDCHAIN_SEPOLIA_CHAIN_ID,
  chainIdHex: WORLDCHAIN_SEPOLIA_CHAIN_ID_HEX,
  deploymentPath: "packages/foundry/deployments/4801.json",
  label: "World Chain Sepolia",
  networkName: "worldchainSepolia",
  ponderEnvName: "WORLDCHAIN_SEPOLIA_PONDER_URL",
  ponderStatusKey: "worldchainSepolia",
  rpcEnvName: "WORLDCHAIN_SEPOLIA_RPC_URL",
  usdc: WORLDCHAIN_SEPOLIA_USDC,
};
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const SUBMISSION_MEDIA_VALIDATOR_SELECTOR = "0x738dbaa0";
const SUBMISSION_MEDIA_VALIDATOR_AUTHORIZED_EMITTER_SELECTOR = "0xb717bbbd";
const ADDRESS_WORD_RE = /^[a-fA-F0-9]{64}$/;
export const REQUIRED_SUBMISSION_MEDIA_VALIDATOR_SELECTORS = [
  "0x6773a34f", // validateContextSubmission(string,string[],string,string,string,bool)
  "0x6b974e07", // validateSubmissionDetails(string,bytes32,bool)
];

export function buildReadinessUrl(baseUrl, path) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/u, "");
  return new URL(normalizedPath, normalizedBase);
}

export function buildPonderUrl(baseUrl, path) {
  return buildReadinessUrl(baseUrl, path);
}

function normalizeReadinessAddress(value) {
  return typeof value === "string" && isAddress(value)
    ? value.toLowerCase()
    : null;
}

function expectedPonderDeploymentKey(readinessConfig, deploymentAddresses) {
  const contentRegistryAddress = deploymentAddresses.get("ContentRegistry");
  const feedbackRegistryAddress = deploymentAddresses.get("FeedbackRegistry");
  if (!contentRegistryAddress || !feedbackRegistryAddress) return null;
  return [
    String(readinessConfig.chainId),
    contentRegistryAddress.toLowerCase(),
    feedbackRegistryAddress.toLowerCase(),
  ].join(":");
}

export const REQUIRED_DEPLOYED_CONTRACTS = [
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
  "RaterRegistry",
  "RoundRewardDistributor",
  "RoundVotingEngine",
  "X402QuestionSubmitter",
];

export const PONDER_INDEXED_CONTRACTS = [
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
  "QuestionRewardPoolEscrow",
  "RaterRegistry",
  "RoundRewardDistributor",
  "RoundVotingEngine",
];

const PROXY_CONTRACTS = new Set([
  "ConfidentialityEscrow",
  "ContentRegistry",
  "FeedbackBonusEscrow",
  "FeedbackRegistry",
  "FrontendRegistry",
  "ProfileRegistry",
  "ProtocolConfig",
  "QuestionRewardPoolEscrow",
  "RaterRegistry",
  "RoundRewardDistributor",
  "RoundVotingEngine",
]);

export const REQUIRED_SELECTOR_CHECKS = [
  {
    contractName: "X402QuestionSubmitter",
    selectors: [
      "0x1c2fa657", // computeX402QuestionPaymentNonce with confidentiality config
      "0x61b030bc", // submitQuestionWithX402Payment with confidentiality config
      "0x2248a6e6", // submitQuestionWithX402OneShotPayment without confidentiality config
      "0x834f6ea9", // submitQuestionWithX402OneShotPayment with confidentiality config
      "0x8de79fb5", // feedbackBonusEscrow()
    ],
  },
  {
    contractName: "ContentRegistry",
    selectors: [
      "0x774922ea", // submitQuestionWithRewardAndRoundConfig with confidentiality config
    ],
  },
  {
    contractName: "ConfidentialityEscrow",
    selectors: [
      "0xe3de2a7a", // recordAccessNexus(uint256,address)
      "0x80fb3870", // recordConfidentialityNexusForRegistry(uint256,address,address)
    ],
  },
  {
    contractName: "ProtocolConfig",
    selectors: [
      "0xd5011d75", // confidentialityEscrow()
      "0xefdd8d2b", // revokeAdvisoryVoteRecorder(address)
    ],
  },
  {
    contractName: "RoundVotingEngine",
    selectors: [
      "0x6a951316", // setRole(bytes32,address,bool)
      "0x706f3d41", // roundConfidentialityEscrowSnapshotWord(uint256,uint256)
    ],
  },
];

export const REQUIRED_ADDRESS_WIRING_CHECKS = [
  {
    contractName: "ContentRegistry",
    selector: "0x19c90f6d", // votingEngine()
    expectedContractName: "RoundVotingEngine",
    label: "ContentRegistry votingEngine",
  },
  {
    contractName: "ContentRegistry",
    selector: "0x3cd4049c", // questionRewardPoolEscrow()
    expectedContractName: "QuestionRewardPoolEscrow",
    label: "ContentRegistry questionRewardPoolEscrow",
  },
  {
    contractName: "ContentRegistry",
    selector: "0xf5efbb4f", // protocolConfig()
    expectedContractName: "ProtocolConfig",
    label: "ContentRegistry protocolConfig",
  },
  {
    contractName: "QuestionRewardPoolEscrow",
    selector: "0xe1b361ac", // questionRewardPoolEscrowConfigShape()
    expectedContractName: "ContentRegistry",
    label: "QuestionRewardPoolEscrow registry",
    outputIndex: 0,
  },
  {
    contractName: "QuestionRewardPoolEscrow",
    selector: "0xe1b361ac", // questionRewardPoolEscrowConfigShape()
    expectedContractName: "RoundVotingEngine",
    label: "QuestionRewardPoolEscrow votingEngine",
    outputIndex: 1,
  },
  {
    contractName: "FeedbackBonusEscrow",
    selector: "0x7b103999", // registry()
    expectedContractName: "ContentRegistry",
    label: "FeedbackBonusEscrow registry",
  },
  {
    contractName: "FeedbackBonusEscrow",
    selector: "0x19c90f6d", // votingEngine()
    expectedContractName: "RoundVotingEngine",
    label: "FeedbackBonusEscrow votingEngine",
  },
  {
    contractName: "FeedbackBonusEscrow",
    selector: "0xf9a3b6e1", // feedbackRegistry()
    expectedContractName: "FeedbackRegistry",
    label: "FeedbackBonusEscrow feedbackRegistry",
  },
  {
    contractName: "FeedbackRegistry",
    selector: "0x19c90f6d", // votingEngine()
    expectedContractName: "RoundVotingEngine",
    label: "FeedbackRegistry votingEngine",
  },
  {
    contractName: "ProtocolConfig",
    selector: "0xd5011d75", // confidentialityEscrow()
    expectedContractName: "ConfidentialityEscrow",
    label: "ProtocolConfig confidentialityEscrow",
  },
  {
    contractName: "ProtocolConfig",
    selector: "0x53b86ffb", // raterRegistry()
    expectedContractName: "RaterRegistry",
    label: "ProtocolConfig raterRegistry",
  },
  {
    contractName: "ProtocolConfig",
    selector: "0xc940f190", // frontendRegistry()
    expectedContractName: "FrontendRegistry",
    label: "ProtocolConfig frontendRegistry",
  },
  {
    contractName: "ProtocolConfig",
    selector: "0xacc2166a", // rewardDistributor()
    expectedContractName: "RoundRewardDistributor",
    label: "ProtocolConfig rewardDistributor",
  },
  {
    contractName: "ProtocolConfig",
    selector: "0x1ba71c58", // clusterPayoutOracle()
    expectedContractName: "ClusterPayoutOracle",
    label: "ProtocolConfig clusterPayoutOracle",
  },
  {
    contractName: "ProtocolConfig",
    selector: "0xa79660de", // advisoryVoteRecorder()
    expectedContractName: "AdvisoryVoteRecorder",
    label: "ProtocolConfig advisoryVoteRecorder",
  },
  {
    contractName: "ProtocolConfig",
    selector: "0xced2665e", // launchDistributionPool()
    expectedContractName: "LaunchDistributionPool",
    label: "ProtocolConfig launchDistributionPool",
  },
  {
    contractName: "ConfidentialityEscrow",
    selector: "0x7b103999", // registry()
    expectedContractName: "ContentRegistry",
    label: "ConfidentialityEscrow registry",
  },
  {
    contractName: "ConfidentialityEscrow",
    selector: "0xf5efbb4f", // protocolConfig()
    expectedContractName: "ProtocolConfig",
    label: "ConfidentialityEscrow protocolConfig",
  },
  {
    contractName: "RaterRegistry",
    selector: "0xd5011d75", // confidentialityEscrow()
    expectedContractName: "ConfidentialityEscrow",
    label: "RaterRegistry confidentialityEscrow",
  },
  {
    contractName: "FrontendRegistry",
    selector: "0x19c90f6d", // votingEngine()
    expectedContractName: "RoundVotingEngine",
    label: "FrontendRegistry votingEngine",
  },
  {
    contractName: "FrontendRegistry",
    selector: "0x8ea89ffb", // feeCreditorForEngine(address)
    expectedContractName: "RoundRewardDistributor",
    label: "FrontendRegistry feeCreditorForEngine(RoundVotingEngine)",
    arguments: ["RoundVotingEngine"],
  },
  {
    contractName: "RoundRewardDistributor",
    selector: "0x7b103999", // registry()
    expectedContractName: "ContentRegistry",
    label: "RoundRewardDistributor registry",
  },
  {
    contractName: "RoundRewardDistributor",
    selector: "0x19c90f6d", // votingEngine()
    expectedContractName: "RoundVotingEngine",
    label: "RoundRewardDistributor votingEngine",
  },
  {
    contractName: "RoundVotingEngine",
    selector: "0xf5efbb4f", // protocolConfig()
    expectedContractName: "ProtocolConfig",
    label: "RoundVotingEngine protocolConfig",
  },
  {
    contractName: "ClusterPayoutOracle",
    selector: "0xc940f190", // frontendRegistry()
    expectedContractName: "FrontendRegistry",
    label: "ClusterPayoutOracle frontendRegistry",
  },
  {
    contractName: "LaunchDistributionPool",
    selector: "0x53b86ffb", // raterRegistry()
    expectedContractName: "RaterRegistry",
    label: "LaunchDistributionPool raterRegistry",
  },
  {
    contractName: "LaunchDistributionPool",
    selector: "0x1ba71c58", // clusterPayoutOracle()
    expectedContractName: "ClusterPayoutOracle",
    label: "LaunchDistributionPool clusterPayoutOracle",
  },
  {
    contractName: "ProfileRegistry",
    selector: "0x53b86ffb", // raterRegistry()
    expectedContractName: "RaterRegistry",
    label: "ProfileRegistry raterRegistry",
  },
  {
    contractName: "X402QuestionSubmitter",
    selector: "0x7b103999", // registry()
    expectedContractName: "ContentRegistry",
    label: "X402QuestionSubmitter registry",
  },
  {
    contractName: "X402QuestionSubmitter",
    selector: "0x3cd4049c", // questionRewardPoolEscrow()
    expectedContractName: "QuestionRewardPoolEscrow",
    label: "X402QuestionSubmitter questionRewardPoolEscrow",
  },
  {
    contractName: "X402QuestionSubmitter",
    selector: "0x8de79fb5", // feedbackBonusEscrow()
    expectedContractName: "FeedbackBonusEscrow",
    label: "X402QuestionSubmitter feedbackBonusEscrow",
  },
];

function isAddress(value) {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

function addCheck(checks, failures, ok, message) {
  checks.push({ ok, message });
  if (!ok) failures.push(message);
}

function readEnvAssignment(source, key) {
  for (const line of source.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(trimmedLine);
    if (match?.[1] !== key) {
      continue;
    }

    return match[2].trim().replace(/^(['"])(.*)\1$/u, "$2");
  }

  return undefined;
}

function readEnvValue({ env, envSource }, key) {
  const sourceValue =
    typeof envSource === "string"
      ? readEnvAssignment(envSource, key)
      : undefined;
  return sourceValue ?? env?.[key]?.trim();
}

export function addBasePreconfirmationEnvChecks({
  chainId,
  checks,
  env = process.env,
  envSource,
  failures,
  sourceLabel = "environment",
}) {
  const browserPreconfEnvName = `NEXT_PUBLIC_BASE_PRECONF_RPC_URL_${chainId}`;
  const serverPreconfEnvName = `RATELOOP_SERVER_BASE_PRECONF_RPC_URL_${chainId}`;
  const rpcEnvName = `NEXT_PUBLIC_RPC_URL_${chainId}`;
  const browserPreconfEnabled =
    readEnvValue({ env, envSource }, "NEXT_PUBLIC_USE_BASE_PRECONF_RPC") ===
    "true";
  const serverPreconfEnabled =
    readEnvValue({ env, envSource }, "RATELOOP_SERVER_USE_BASE_PRECONF_RPC") ===
    "true";

  addCheck(
    checks,
    failures,
    !readEnvValue({ env, envSource }, browserPreconfEnvName),
    `${sourceLabel} does not configure removed ${browserPreconfEnvName}`,
  );
  addCheck(
    checks,
    failures,
    !readEnvValue({ env, envSource }, serverPreconfEnvName),
    `${sourceLabel} does not configure removed ${serverPreconfEnvName}`,
  );

  if (browserPreconfEnabled || serverPreconfEnabled) {
    addCheck(
      checks,
      failures,
      Boolean(readEnvValue({ env, envSource }, rpcEnvName)),
      `${sourceLabel} reuses ${rpcEnvName} for Base preconfirmation`,
    );
  }
}

export function buildDeploymentAddressMap(deploymentJson) {
  const byName = new Map();
  for (const [key, value] of Object.entries(deploymentJson)) {
    if (isAddress(key) && typeof value === "string") {
      byName.set(value, key);
    }
  }
  return byName;
}

function extractBalancedObject(source, openBraceIndex) {
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex, index + 1);
    }
  }
  return undefined;
}

export function parseGeneratedContractsForChain(
  source,
  chainId = WORLDCHAIN_SEPOLIA_READINESS_CONFIG.chainId,
) {
  const marker = `  ${chainId}: {`;
  const start = source.indexOf(marker);
  if (start === -1) return new Map();

  const nextChainMatch = /\n  \d+: \{/g;
  nextChainMatch.lastIndex = start + marker.length;
  const next = nextChainMatch.exec(source);
  const chainSource = source.slice(start, next?.index ?? source.length);
  const contracts = new Map();

  for (const contractName of REQUIRED_DEPLOYED_CONTRACTS) {
    const keyMatch = new RegExp(`(?:^|[\\s{,])${contractName}:\\s*\\{`).exec(
      chainSource,
    );
    if (!keyMatch) continue;

    // Parse only inside this contract's own balanced object so a missing field
    // can never borrow a value from the next contract entry.
    const contractSource = extractBalancedObject(
      chainSource,
      keyMatch.index + keyMatch[0].length - 1,
    );
    if (!contractSource) continue;

    const addressMatch = /address:\s*"([^"]+)"/.exec(contractSource);
    const deployedOnBlockMatch = /deployedOnBlock:\s*(\d+)/.exec(
      contractSource,
    );
    contracts.set(contractName, {
      address: addressMatch?.[1],
      deployedOnBlock: deployedOnBlockMatch
        ? Number(deployedOnBlockMatch[1])
        : undefined,
    });
  }

  return contracts;
}

export function validateOfflineReadiness(
  { deploymentJson, deployedContractsSource, protocolSource },
  readinessConfig = WORLDCHAIN_SEPOLIA_READINESS_CONFIG,
) {
  const checks = [];
  const failures = [];
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  const generatedContracts = parseGeneratedContractsForChain(
    deployedContractsSource,
    readinessConfig.chainId,
  );

  addCheck(
    checks,
    failures,
    deploymentJson.networkName === readinessConfig.networkName,
    `deployment artifact targets ${readinessConfig.networkName}`,
  );
  addCheck(
    checks,
    failures,
    deploymentJson.deploymentComplete === "true",
    "deployment artifact is marked complete",
  );
  addCheck(
    checks,
    failures,
    Number.isInteger(deploymentJson.deploymentBlockNumber) &&
      deploymentJson.deploymentBlockNumber > 0,
    "deployment artifact has a positive deployment block",
  );

  for (const contractName of REQUIRED_DEPLOYED_CONTRACTS) {
    const deploymentAddress = deploymentAddresses.get(contractName);
    addCheck(
      checks,
      failures,
      isAddress(deploymentAddress),
      `${contractName} has an address in ${readinessConfig.deploymentPath}`,
    );

    const generated = generatedContracts.get(contractName);
    addCheck(
      checks,
      failures,
      isAddress(generated?.address),
      `${contractName} has an address in packages/contracts/src/deployedContracts.ts`,
    );

    if (deploymentAddress && generated?.address) {
      addCheck(
        checks,
        failures,
        deploymentAddress.toLowerCase() === generated.address.toLowerCase(),
        `${contractName} address matches between foundry and generated contract artifacts`,
      );
    }

    if (PONDER_INDEXED_CONTRACTS.includes(contractName)) {
      addCheck(
        checks,
        failures,
        Number.isInteger(generated?.deployedOnBlock) &&
          generated.deployedOnBlock > 0,
        `${contractName} has a positive generated deployedOnBlock for Ponder start blocks`,
      );
    }
  }

  addCheck(
    checks,
    failures,
    protocolSource.includes(
      `${readinessConfig.chainId}: "${readinessConfig.usdc}"`,
    ),
    `Next.js default USDC address is configured for ${readinessConfig.label}`,
  );

  return { ok: failures.length === 0, checks, failures };
}

export function loadOfflineInputs(
  root = repoRoot,
  readinessConfig = WORLDCHAIN_SEPOLIA_READINESS_CONFIG,
) {
  return {
    deploymentJson: JSON.parse(
      readFileSync(join(root, readinessConfig.deploymentPath), "utf8"),
    ),
    deployedContractsSource: readFileSync(
      join(root, "packages/contracts/src/deployedContracts.ts"),
      "utf8",
    ),
    protocolSource: readFileSync(
      join(root, "packages/contracts/src/protocol.ts"),
      "utf8",
    ),
  };
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function rpc(rpcUrl, method, params = []) {
  const response = await fetchWithTimeout(rpcUrl, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    headers: { "content-type": "application/json" },
  });
  if (!response.ok)
    throw new Error(`${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error)
    throw new Error(
      `${method} failed: ${body.error.message ?? JSON.stringify(body.error)}`,
    );
  return body.result;
}

function parseStorageAddress(value) {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    return undefined;
  }
  const address = `0x${value.slice(-40)}`;
  return address === "0x0000000000000000000000000000000000000000"
    ? undefined
    : address;
}

function parseAddressWords(value) {
  if (typeof value !== "string" || !value.startsWith("0x")) return [];
  const hex = value.slice(2);
  if (hex.length === 0 || hex.length % 64 !== 0) return [];

  const addresses = [];
  for (let index = 0; index < hex.length; index += 64) {
    const word = hex.slice(index, index + 64);
    if (!ADDRESS_WORD_RE.test(word)) return [];
    const address = `0x${word.slice(-40)}`;
    addresses.push(
      address === "0x0000000000000000000000000000000000000000"
        ? undefined
        : address,
    );
  }
  return addresses;
}

function parseAddressResult(value, outputIndex = 0) {
  return parseAddressWords(value)[outputIndex];
}

function encodeAddressArgument(value) {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function buildAddressCallData(selector, argumentAddresses = []) {
  return `${selector}${argumentAddresses.map(encodeAddressArgument).join("")}`;
}

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

export function bytecodeContainsSelector(code, selector) {
  return (
    typeof code === "string" &&
    code.toLowerCase().includes(selector.toLowerCase().slice(2))
  );
}

export async function getSelectorProbeCode(rpcUrl, contractName, address) {
  if (!PROXY_CONTRACTS.has(contractName)) {
    return {
      address,
      code: await rpc(rpcUrl, "eth_getCode", [address, "latest"]),
      target: contractName,
    };
  }

  const implementation = parseStorageAddress(
    await rpc(rpcUrl, "eth_getStorageAt", [
      address,
      EIP1967_IMPLEMENTATION_SLOT,
      "latest",
    ]),
  );
  return {
    address: implementation ?? address,
    code: await rpc(rpcUrl, "eth_getCode", [
      implementation ?? address,
      "latest",
    ]),
    target: implementation ? `${contractName} implementation` : contractName,
  };
}

export async function getSubmissionMediaValidatorAddress(
  rpcUrl,
  contentRegistryAddress,
) {
  return parseStorageAddress(
    await rpc(rpcUrl, "eth_call", [
      { to: contentRegistryAddress, data: SUBMISSION_MEDIA_VALIDATOR_SELECTOR },
      "latest",
    ]),
  );
}

export async function getSubmissionMediaValidatorAuthorizedEmitter(
  rpcUrl,
  validatorAddress,
) {
  return parseStorageAddress(
    await rpc(rpcUrl, "eth_call", [
      {
        to: validatorAddress,
        data: SUBMISSION_MEDIA_VALIDATOR_AUTHORIZED_EMITTER_SELECTOR,
      },
      "latest",
    ]),
  );
}

export async function getAddressWiringValue(
  rpcUrl,
  deploymentAddresses,
  wiringCheck,
) {
  const address = deploymentAddresses.get(wiringCheck.contractName);
  if (!address) return undefined;
  const argumentAddresses = (wiringCheck.arguments ?? []).map((contractName) =>
    deploymentAddresses.get(contractName),
  );
  if (argumentAddresses.some((value) => !isAddress(value))) return undefined;
  const result = await rpc(rpcUrl, "eth_call", [
    {
      to: address,
      data: buildAddressCallData(wiringCheck.selector, argumentAddresses),
    },
    "latest",
  ]);
  return parseAddressResult(result, wiringCheck.outputIndex ?? 0);
}

async function validateLiveDeploymentWiring({
  checks,
  deploymentAddresses,
  failures,
  rpcUrl,
}) {
  for (const wiringCheck of REQUIRED_ADDRESS_WIRING_CHECKS) {
    const expectedAddress = deploymentAddresses.get(
      wiringCheck.expectedContractName,
    );
    const actualAddress = await getAddressWiringValue(
      rpcUrl,
      deploymentAddresses,
      wiringCheck,
    );
    addCheck(
      checks,
      failures,
      sameAddress(actualAddress, expectedAddress),
      `${wiringCheck.label} points to ${wiringCheck.expectedContractName} deployment`,
    );
  }
}

export async function validateLiveReadiness({
  appUrl,
  deploymentJson,
  ponderUrl,
  readinessConfig = WORLDCHAIN_SEPOLIA_READINESS_CONFIG,
  requireTargets = false,
  rpcUrl,
}) {
  const checks = [];
  const failures = [];
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);

  if (rpcUrl) {
    try {
      const chainId = await rpc(rpcUrl, "eth_chainId");
      addCheck(
        checks,
        failures,
        String(chainId).toLowerCase() === readinessConfig.chainIdHex,
        `RPC reports ${readinessConfig.label} chainId ${readinessConfig.chainId}`,
      );

      for (const contractName of REQUIRED_DEPLOYED_CONTRACTS) {
        const address = deploymentAddresses.get(contractName);
        if (!address) continue;
        const code = await rpc(rpcUrl, "eth_getCode", [address, "latest"]);
        addCheck(
          checks,
          failures,
          typeof code === "string" && code !== "0x",
          `${contractName} has bytecode on RPC`,
        );
      }

      for (const selectorCheck of REQUIRED_SELECTOR_CHECKS) {
        const address = deploymentAddresses.get(selectorCheck.contractName);
        if (!address) continue;
        const { code, target } = await getSelectorProbeCode(
          rpcUrl,
          selectorCheck.contractName,
          address,
        );
        for (const selector of selectorCheck.selectors) {
          addCheck(
            checks,
            failures,
            bytecodeContainsSelector(code, selector),
            `${target} bytecode contains selector ${selector}`,
          );
        }
      }

      await validateLiveDeploymentWiring({
        checks,
        deploymentAddresses,
        failures,
        rpcUrl,
      });

      const contentRegistryAddress = deploymentAddresses.get("ContentRegistry");
      if (contentRegistryAddress) {
        const validatorAddress = await getSubmissionMediaValidatorAddress(
          rpcUrl,
          contentRegistryAddress,
        );
        addCheck(
          checks,
          failures,
          isAddress(validatorAddress),
          "ContentRegistry submissionMediaValidator has an address",
        );
        if (validatorAddress) {
          const validatorCode = await rpc(rpcUrl, "eth_getCode", [
            validatorAddress,
            "latest",
          ]);
          addCheck(
            checks,
            failures,
            typeof validatorCode === "string" && validatorCode !== "0x",
            "ContentRegistry submissionMediaValidator has bytecode",
          );
          for (const selector of REQUIRED_SUBMISSION_MEDIA_VALIDATOR_SELECTORS) {
            addCheck(
              checks,
              failures,
              bytecodeContainsSelector(validatorCode, selector),
              `ContentRegistry submissionMediaValidator bytecode contains selector ${selector}`,
            );
          }
          const authorizedEmitter =
            await getSubmissionMediaValidatorAuthorizedEmitter(
              rpcUrl,
              validatorAddress,
            );
          addCheck(
            checks,
            failures,
            authorizedEmitter?.toLowerCase() ===
              contentRegistryAddress.toLowerCase(),
            "ContentRegistry submissionMediaValidator authorizedEmitter is ContentRegistry",
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addCheck(
        checks,
        failures,
        false,
        `RPC readiness probe failed: ${message}`,
      );
    }
  } else {
    addCheck(
      checks,
      failures,
      !requireTargets,
      `live RPC probe skipped because ${readinessConfig.rpcEnvName} is unset`,
    );
  }

  if (ponderUrl) {
    try {
      const statusUrl = buildPonderUrl(ponderUrl, "/status");
      const response = await fetchWithTimeout(statusUrl);
      addCheck(
        checks,
        failures,
        response.ok,
        `Ponder /status returns HTTP ${response.status}`,
      );
      if (response.ok) {
        const status = await response.json().catch(() => null);
        const blockNumber =
          status?.[readinessConfig.ponderStatusKey]?.block?.number;
        addCheck(
          checks,
          failures,
          Number(blockNumber) >= Number(deploymentJson.deploymentBlockNumber),
          "Ponder has indexed at or beyond the deployment block",
        );
      }

      const deploymentUrl = buildPonderUrl(ponderUrl, "/deployment");
      const deploymentResponse = await fetchWithTimeout(deploymentUrl);
      addCheck(
        checks,
        failures,
        deploymentResponse.ok,
        `Ponder /deployment returns HTTP ${deploymentResponse.status}`,
      );
      if (deploymentResponse.ok) {
        const deployment = await deploymentResponse.json().catch(() => null);
        const contentRegistryAddress =
          deploymentAddresses.get("ContentRegistry");
        const feedbackRegistryAddress =
          deploymentAddresses.get("FeedbackRegistry");
        const expectedDeploymentKey = expectedPonderDeploymentKey(
          readinessConfig,
          deploymentAddresses,
        );
        const ponderChainId =
          typeof deployment?.chainId === "number"
            ? deployment.chainId
            : typeof deployment?.chainId === "string"
              ? Number(deployment.chainId)
              : NaN;
        const ponderContentRegistry = normalizeReadinessAddress(
          deployment?.contentRegistryAddress,
        );
        const ponderFeedbackRegistry = normalizeReadinessAddress(
          deployment?.feedbackRegistryAddress,
        );
        const ponderDeploymentKey =
          typeof deployment?.deploymentKey === "string" &&
          deployment.deploymentKey.trim()
            ? deployment.deploymentKey.trim().toLowerCase()
            : null;
        addCheck(
          checks,
          failures,
          ponderChainId === readinessConfig.chainId,
          `Ponder deployment reports ${readinessConfig.label} chainId ${readinessConfig.chainId}`,
        );
        addCheck(
          checks,
          failures,
          Boolean(contentRegistryAddress) &&
            ponderContentRegistry === contentRegistryAddress.toLowerCase(),
          "Ponder deployment ContentRegistry matches deployment artifact",
        );
        addCheck(
          checks,
          failures,
          Boolean(feedbackRegistryAddress) &&
            ponderFeedbackRegistry === feedbackRegistryAddress.toLowerCase(),
          "Ponder deployment FeedbackRegistry matches deployment artifact",
        );
        addCheck(
          checks,
          failures,
          Boolean(expectedDeploymentKey) &&
            ponderDeploymentKey === expectedDeploymentKey,
          "Ponder deployment key matches deployment artifact",
        );
      }

      const metadataSyncHeaders = { "content-type": "application/json" };
      const metadataSyncToken = process.env.PONDER_METADATA_SYNC_TOKEN?.trim();
      if (metadataSyncToken) {
        metadataSyncHeaders.authorization = `Bearer ${metadataSyncToken}`;
      }
      const metadataSyncResponse = await fetchWithTimeout(
        buildPonderUrl(ponderUrl, "/question-metadata"),
        {
          body: "{",
          headers: metadataSyncHeaders,
          method: "POST",
        },
      );
      addCheck(
        checks,
        failures,
        metadataSyncResponse.status === 400,
        `Ponder /question-metadata auth reaches JSON validation (HTTP ${metadataSyncResponse.status})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addCheck(
        checks,
        failures,
        false,
        `Ponder readiness probe failed: ${message}`,
      );
    }
  } else {
    addCheck(
      checks,
      failures,
      !requireTargets,
      `live Ponder probe skipped because ${readinessConfig.ponderEnvName} is unset`,
    );
  }

  if (appUrl) {
    for (const path of ["/", "/ask", "/docs/ai", "/api/agent/templates"]) {
      try {
        const response = await fetchWithTimeout(
          buildReadinessUrl(appUrl, path),
        );
        addCheck(
          checks,
          failures,
          response.status < 500,
          `app route ${path} returns below HTTP 500`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addCheck(
          checks,
          failures,
          false,
          `app route ${path} probe failed: ${message}`,
        );
      }
    }

    try {
      const response = await fetchWithTimeout(
        buildReadinessUrl(appUrl, "/api/ponder/availability"),
      );
      addCheck(
        checks,
        failures,
        response.status < 500,
        "app route /api/ponder/availability returns below HTTP 500",
      );
      if (response.status < 500) {
        const body = await response.json().catch(() => null);
        const expectedDeploymentKey = expectedPonderDeploymentKey(
          readinessConfig,
          deploymentAddresses,
        );
        const appExpectedDeploymentKey =
          typeof body?.expectedDeploymentKey === "string" &&
          body.expectedDeploymentKey.trim()
            ? body.expectedDeploymentKey.trim().toLowerCase()
            : null;
        addCheck(
          checks,
          failures,
          Boolean(expectedDeploymentKey) &&
            appExpectedDeploymentKey === expectedDeploymentKey,
          `app expects ${readinessConfig.label} Ponder deployment`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addCheck(
        checks,
        failures,
        false,
        `app route /api/ponder/availability probe failed: ${message}`,
      );
    }
  } else {
    addCheck(
      checks,
      failures,
      !requireTargets,
      `live app probe skipped because ${readinessConfig.appEnvName} is unset`,
    );
  }

  return { ok: failures.length === 0, checks, failures };
}

function parseArgs(argv) {
  return {
    live: argv.includes("--live"),
    json: argv.includes("--json"),
    requireLiveTargets: argv.includes("--require-live-targets"),
  };
}

function printResult(title, result, json = false) {
  if (json) {
    console.log(JSON.stringify({ title, ...result }, null, 2));
    return;
  }

  console.log(`\n${title}`);
  for (const check of result.checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const offlineInputs = loadOfflineInputs();
  const offlineResult = validateOfflineReadiness(offlineInputs);
  printResult(
    "World Chain Sepolia offline readiness",
    offlineResult,
    args.json,
  );

  let liveResult = { ok: true, checks: [], failures: [] };
  if (args.live) {
    liveResult = await validateLiveReadiness({
      appUrl: process.env.WORLDCHAIN_SEPOLIA_APP_URL,
      deploymentJson: offlineInputs.deploymentJson,
      ponderUrl: process.env.WORLDCHAIN_SEPOLIA_PONDER_URL,
      requireTargets: args.requireLiveTargets,
      rpcUrl: process.env.WORLDCHAIN_SEPOLIA_RPC_URL,
    });
    printResult("World Chain Sepolia live readiness", liveResult, args.json);
  }

  if (!offlineResult.ok || !liveResult.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
