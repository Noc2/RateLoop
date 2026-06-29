import { createHash } from "node:crypto";
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
  keeperEnvName: "WORLDCHAIN_SEPOLIA_KEEPER_URL",
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
const ROUND_PAYOUT_SNAPSHOT_CONSUMER_SELECTOR = "0x2fc1e72a";
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

function expectedPonderDatabaseSchema(readinessConfig, deploymentAddresses) {
  const deploymentKey = expectedPonderDeploymentKey(
    readinessConfig,
    deploymentAddresses,
  );
  if (!deploymentKey) return null;

  const hash = createHash("sha256").update(deploymentKey).digest("hex").slice(0, 16);
  return `rateloop_deployment_${hash}`;
}

function isRecentPastDate(value, maxAgeMs = 2 * 60 * 60 * 1000) {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;

  const ageMs = Date.now() - time;
  return ageMs >= 0 && ageMs <= maxAgeMs;
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

export const REQUIRED_REMOVED_POST_CREATION_FUNDING_SELECTORS = [
  {
    contractName: "QuestionRewardPoolEscrow",
    selector: "0x61a66a9d",
    label: "QuestionRewardPoolEscrow createRewardPool",
  },
  {
    contractName: "QuestionRewardPoolEscrow",
    selector: "0xac197a0f",
    label: "QuestionRewardPoolEscrow createRewardPoolWithAuthorization",
  },
  {
    contractName: "QuestionRewardPoolEscrow",
    selector: "0x211d3e3f",
    label: "QuestionRewardPoolEscrow createPurposeRewardPool",
  },
  {
    contractName: "FeedbackBonusEscrow",
    selector: "0x12462f17",
    label: "FeedbackBonusEscrow createFeedbackBonusPool",
  },
  {
    contractName: "FeedbackBonusEscrow",
    selector: "0x5714f732",
    label: "FeedbackBonusEscrow createFeedbackBonusPoolWithAsset",
  },
  {
    contractName: "FeedbackBonusEscrow",
    selector: "0x948d70e7",
    label: "FeedbackBonusEscrow createFeedbackBonusPoolWithAuthorization",
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

export const REQUIRED_CLUSTER_PAYOUT_ORACLE_CONSUMERS = [
  {
    domain: 1,
    expectedContractName: "QuestionRewardPoolEscrow",
    label: "ClusterPayoutOracle question reward consumer",
  },
  {
    domain: 2,
    expectedContractName: "LaunchDistributionPool",
    label: "ClusterPayoutOracle launch credit consumer",
  },
  {
    domain: 3,
    expectedContractName: "ContentRegistry",
    label: "ClusterPayoutOracle public rating consumer",
  },
  {
    domain: 4,
    expectedContractName: "QuestionRewardPoolEscrow",
    label: "ClusterPayoutOracle question bundle reward consumer",
  },
];

const OFFCHAIN_RUNTIME_REQUIRED_ENVS = [
  {
    name: "NODE_ENV",
    isValid: (value) => value === "production",
    message: "NODE_ENV is production for live service checks",
  },
  {
    name: "PONDER_KEEPER_WORK_TOKEN",
    isValid: (value) => Boolean(value),
    message: "PONDER_KEEPER_WORK_TOKEN is configured for Keeper/Ponder",
  },
  {
    name: "KEEPER_DATABASE_URL",
    isValid: (value) => /^postgres(?:ql)?:\/\//u.test(value ?? ""),
    message: "KEEPER_DATABASE_URL is configured for Keeper locking",
  },
  {
    name: "CORS_ORIGIN",
    isValid: (value) => Boolean(value),
    message: "CORS_ORIGIN is configured for Ponder production API",
  },
  {
    name: "PONDER_METADATA_SYNC_TOKEN",
    isValid: (value) => Boolean(value),
    message: "PONDER_METADATA_SYNC_TOKEN is configured for Ponder metadata sync",
  },
  {
    name: "RATE_LIMIT_TRUSTED_IP_HEADERS",
    isValid: (value) => Boolean(value),
    message:
      "RATE_LIMIT_TRUSTED_IP_HEADERS is configured for Ponder rate limiting",
  },
];

const LOOPBACK_BIND_ADDRESSES = new Set(["127.0.0.1", "::1", "localhost"]);

function isAddress(value) {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

function addCheck(checks, failures, ok, message) {
  checks.push({ ok, message });
  if (!ok) failures.push(message);
}

function readRuntimeEnv(env, name) {
  const value = env[name]?.trim();
  return value ? value : "";
}

function isLoopbackBindAddress(value) {
  const normalized = value?.trim();
  return Boolean(
    normalized &&
      (LOOPBACK_BIND_ADDRESSES.has(normalized) ||
        normalized.startsWith("127.")),
  );
}

function isPublicBindAddress(value) {
  const normalized = value?.trim();
  return Boolean(normalized && !isLoopbackBindAddress(normalized));
}

function isTruthyEnvValue(value) {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function usesAutomaticFileCorrelationArtifacts(env) {
  if (
    !isTruthyEnvValue(
      readRuntimeEnv(env, "KEEPER_CORRELATION_SNAPSHOTS_ENABLED"),
    )
  ) {
    return false;
  }

  const snapshotMode =
    readRuntimeEnv(env, "KEEPER_CORRELATION_SNAPSHOTS_MODE") ||
    (readRuntimeEnv(env, "KEEPER_CORRELATION_SNAPSHOT_ARTIFACT_PATH")
      ? "file"
      : "auto");
  const artifactStorage =
    readRuntimeEnv(env, "KEEPER_CORRELATION_ARTIFACT_STORAGE") || "file";

  return snapshotMode === "auto" && artifactStorage === "file";
}

function normalizeArtifactUrlPrefix(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}

function normalizedArtifactAllowlistPrefixSet(value) {
  return new Set(
    value
      .split(",")
      .map(normalizeArtifactUrlPrefix)
      .filter(Boolean),
  );
}

function normalizeArtifactAllowlistPrefixes(value) {
  return value
    .split(",")
    .map(normalizeArtifactUrlPrefix)
    .filter(Boolean)
    .sort()
    .join(",");
}

export function validateArtifactAllowlistParity({ checks, env = process.env, failures }) {
  const keeperAllowlist = readRuntimeEnv(env, "KEEPER_ARTIFACT_HTTPS_ALLOWLIST");
  const payoutAllowlist = readRuntimeEnv(env, "PAYOUT_ARTIFACT_HTTPS_ALLOWLIST");
  if (!keeperAllowlist || !payoutAllowlist) {
    return;
  }
  const publicArtifactBaseUrl = readRuntimeEnv(
    env,
    "KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL",
  );
  const normalizedPublicArtifactBaseUrl = normalizeArtifactUrlPrefix(publicArtifactBaseUrl);

  addCheck(
    checks,
    failures,
    normalizeArtifactAllowlistPrefixes(keeperAllowlist) ===
      normalizeArtifactAllowlistPrefixes(payoutAllowlist),
    "KEEPER_ARTIFACT_HTTPS_ALLOWLIST matches PAYOUT_ARTIFACT_HTTPS_ALLOWLIST when both are set",
  );

  if (normalizedPublicArtifactBaseUrl) {
    addCheck(
      checks,
      failures,
      normalizedArtifactAllowlistPrefixSet(keeperAllowlist).has(normalizedPublicArtifactBaseUrl),
      "KEEPER_ARTIFACT_HTTPS_ALLOWLIST includes KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL",
    );
    addCheck(
      checks,
      failures,
      normalizedArtifactAllowlistPrefixSet(payoutAllowlist).has(normalizedPublicArtifactBaseUrl),
      "PAYOUT_ARTIFACT_HTTPS_ALLOWLIST includes KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL",
    );
  }
}

export function validateOffchainRuntimeEnv({
  checks,
  env = process.env,
  failures,
  requireTargets = false,
}) {
  for (const check of OFFCHAIN_RUNTIME_REQUIRED_ENVS) {
    const value = readRuntimeEnv(env, check.name);
    addCheck(
      checks,
      failures,
      !requireTargets || check.isValid(value),
      check.message,
    );
  }

  const metricsBindAddress = readRuntimeEnv(env, "METRICS_BIND_ADDRESS");
  if (isPublicBindAddress(metricsBindAddress)) {
    const metricsAuthToken = readRuntimeEnv(env, "METRICS_AUTH_TOKEN");
    addCheck(
      checks,
      failures,
      metricsAuthToken.length >= 16,
      "METRICS_AUTH_TOKEN is configured when Keeper metrics are public",
    );
  }

  const usesAutoFileArtifacts = usesAutomaticFileCorrelationArtifacts(env);
  const artifactPublicBaseUrl = readRuntimeEnv(
    env,
    "KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL",
  );
  if (usesAutoFileArtifacts) {
    addCheck(
      checks,
      failures,
      Boolean(artifactPublicBaseUrl),
      "KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL is configured when Keeper auto correlation snapshots use file artifacts",
    );
    addCheck(
      checks,
      failures,
      !artifactPublicBaseUrl || isHttpsUrl(artifactPublicBaseUrl),
      "KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL is HTTPS when Keeper auto correlation snapshots use file artifacts",
    );
  }

  const publishesPublicFileArtifacts =
    usesAutoFileArtifacts && Boolean(artifactPublicBaseUrl);
  if (
    publishesPublicFileArtifacts &&
    isLoopbackBindAddress(metricsBindAddress)
  ) {
    addCheck(
      checks,
      failures,
      false,
      "METRICS_BIND_ADDRESS is non-loopback when Keeper publishes public correlation artifacts",
    );
  }

  validateArtifactAllowlistParity({ checks, env, failures });
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

async function rpcRaw(rpcUrl, method, params = []) {
  const response = await fetchWithTimeout(rpcUrl, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    headers: { "content-type": "application/json" },
  });
  if (!response.ok)
    throw new Error(`${method} returned HTTP ${response.status}`);
  return response.json();
}

async function rpc(rpcUrl, method, params = []) {
  const body = await rpcRaw(rpcUrl, method, params);
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

function encodeUint8Argument(value) {
  return Number(value).toString(16).padStart(64, "0");
}

function buildAddressCallData(selector, argumentAddresses = []) {
  return `${selector}${argumentAddresses.map(encodeAddressArgument).join("")}`;
}

function buildUint8CallData(selector, value) {
  return `${selector}${encodeUint8Argument(value)}`;
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

async function getClusterPayoutOracleConsumer(
  rpcUrl,
  deploymentAddresses,
  consumerCheck,
) {
  const oracleAddress = deploymentAddresses.get("ClusterPayoutOracle");
  if (!oracleAddress) return undefined;
  const result = await rpc(rpcUrl, "eth_call", [
    {
      to: oracleAddress,
      data: buildUint8CallData(
        ROUND_PAYOUT_SNAPSHOT_CONSUMER_SELECTOR,
        consumerCheck.domain,
      ),
    },
    "latest",
  ]);
  return parseAddressResult(result);
}

async function validateLiveClusterPayoutOracleConsumers({
  checks,
  deploymentAddresses,
  failures,
  rpcUrl,
}) {
  for (const consumerCheck of REQUIRED_CLUSTER_PAYOUT_ORACLE_CONSUMERS) {
    const expectedAddress = deploymentAddresses.get(
      consumerCheck.expectedContractName,
    );
    const actualAddress = await getClusterPayoutOracleConsumer(
      rpcUrl,
      deploymentAddresses,
      consumerCheck,
    );
    addCheck(
      checks,
      failures,
      sameAddress(actualAddress, expectedAddress),
      `${consumerCheck.label} points to ${consumerCheck.expectedContractName} deployment`,
    );
  }
}

export async function validateLiveReadiness({
  appUrl,
  deploymentJson,
  keeperUrl,
  ponderUrl,
  readinessConfig = WORLDCHAIN_SEPOLIA_READINESS_CONFIG,
  requireTargets = false,
  rpcUrl,
}) {
  const checks = [];
  const failures = [];
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);

  validateOffchainRuntimeEnv({ checks, failures, requireTargets });

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

      for (const removedSelectorCheck of REQUIRED_REMOVED_POST_CREATION_FUNDING_SELECTORS) {
        const address = deploymentAddresses.get(
          removedSelectorCheck.contractName,
        );
        if (!address) continue;
        const { code, target } = await getSelectorProbeCode(
          rpcUrl,
          removedSelectorCheck.contractName,
          address,
        );
        addCheck(
          checks,
          failures,
          !bytecodeContainsSelector(code, removedSelectorCheck.selector),
          `${target} bytecode omits removed selector ${removedSelectorCheck.selector} (${removedSelectorCheck.label})`,
        );
      }

      await validateLiveDeploymentWiring({
        checks,
        deploymentAddresses,
        failures,
        rpcUrl,
      });
      await validateLiveClusterPayoutOracleConsumers({
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
        const expectedDatabaseSchema = expectedPonderDatabaseSchema(
          readinessConfig,
          deploymentAddresses,
        );
        const ponderDatabaseSchema =
          typeof deployment?.databaseSchema === "string" &&
          deployment.databaseSchema.trim()
            ? deployment.databaseSchema.trim()
            : null;
        const ponderDatabaseSchemaSource =
          typeof deployment?.databaseSchemaSource === "string" &&
          deployment.databaseSchemaSource.trim()
            ? deployment.databaseSchemaSource.trim()
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
        addCheck(
          checks,
          failures,
          Boolean(expectedDatabaseSchema) &&
            ponderDatabaseSchema === expectedDatabaseSchema,
          "Ponder database schema matches deployment artifact",
        );
        addCheck(
          checks,
          failures,
          ponderDatabaseSchemaSource === "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY",
          "Ponder database schema source is protocol deployment key",
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

      if (requireTargets) {
        const keeperWorkToken = process.env.PONDER_KEEPER_WORK_TOKEN?.trim();
        if (keeperWorkToken) {
          const keeperWorkUrl = buildPonderUrl(ponderUrl, "/keeper/work");
          keeperWorkUrl.searchParams.set(
            "now",
            String(Math.floor(Date.now() / 1000)),
          );
          keeperWorkUrl.searchParams.set(
            "dormancyPeriod",
            String(30 * 24 * 60 * 60),
          );
          keeperWorkUrl.searchParams.set("feedbackBonusForfeitMinAge", "0");
          keeperWorkUrl.searchParams.set("limit", "1");
          const keeperWorkResponse = await fetchWithTimeout(keeperWorkUrl, {
            headers: {
              authorization: `Bearer ${keeperWorkToken}`,
            },
          });
          addCheck(
            checks,
            failures,
            keeperWorkResponse.ok,
            `Ponder /keeper/work accepts Keeper bearer token (HTTP ${keeperWorkResponse.status})`,
          );
        } else {
          addCheck(
            checks,
            failures,
            false,
            "Ponder /keeper/work live probe skipped because PONDER_KEEPER_WORK_TOKEN is unset",
          );
        }
      }
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

  if (keeperUrl) {
    try {
      const liveResponse = await fetchWithTimeout(
        buildReadinessUrl(keeperUrl, "/live"),
      );
      addCheck(
        checks,
        failures,
        liveResponse.ok,
        `Keeper /live returns HTTP ${liveResponse.status}`,
      );
      if (liveResponse.ok) {
        const liveBody = await liveResponse.json().catch(() => null);
        addCheck(
          checks,
          failures,
          liveBody?.status === "ok",
          "Keeper /live reports status ok",
        );
      }

      const metricsAuthToken = process.env.METRICS_AUTH_TOKEN?.trim();
      if (metricsAuthToken) {
        const healthResponse = await fetchWithTimeout(
          buildReadinessUrl(keeperUrl, "/health"),
          {
            headers: {
              authorization: `Bearer ${metricsAuthToken}`,
            },
          },
        );
        addCheck(
          checks,
          failures,
          healthResponse.ok,
          `Keeper /health returns HTTP ${healthResponse.status}`,
        );
        if (healthResponse.ok) {
          const health = await healthResponse.json().catch(() => null);
          addCheck(
            checks,
            failures,
            health?.status === "ok",
            "Keeper /health reports status ok",
          );
          addCheck(
            checks,
            failures,
            isRecentPastDate(health?.lastRun),
            "Keeper /health reports a recent lastRun",
          );
          addCheck(
            checks,
            failures,
            Number(health?.consecutiveErrors) === 0,
            "Keeper /health reports zero consecutiveErrors",
          );
        }
      } else {
        addCheck(
          checks,
          failures,
          !requireTargets,
          "Keeper /health live probe skipped because METRICS_AUTH_TOKEN is unset",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addCheck(
        checks,
        failures,
        false,
        `Keeper readiness probe failed: ${message}`,
      );
    }
  } else {
    addCheck(
      checks,
      failures,
      !requireTargets,
      `live Keeper probe skipped because ${readinessConfig.keeperEnvName ?? "KEEPER_URL"} is unset`,
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
