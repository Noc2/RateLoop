import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PONDER_INDEXED_CONTRACTS,
  REQUIRED_ADDRESS_WIRING_CHECKS,
  REQUIRED_CLUSTER_PAYOUT_ORACLE_CONSUMERS,
  REQUIRED_DEPLOYED_CONTRACTS,
  REQUIRED_REMOVED_POST_CREATION_FUNDING_SELECTORS,
  REQUIRED_SELECTOR_CHECKS,
  REQUIRED_SUBMISSION_MEDIA_VALIDATOR_SELECTORS,
  addBasePreconfirmationEnvChecks,
  buildDeploymentAddressMap,
  buildPonderUrl,
  buildReadinessUrl,
  parseGeneratedContractsForChain,
  validateArtifactAllowlistParity,
  validateOffchainRuntimeEnv,
  validateLiveReadiness,
  validateOfflineReadiness,
} from "./check-worldchain-sepolia-readiness.mjs";
import {
  BASE_SEPOLIA_READINESS_CONFIG,
  DEFAULT_BASE_SEPOLIA_NEXT_ENV_FILE,
  baseSepoliaNotDeployedMessage,
  resolveBaseSepoliaNextEnvFilePath,
  validateBaseSepoliaOfflineReadiness,
} from "./check-base-sepolia-readiness.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function addressFor(index) {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

function makeDeploymentJson(overrides = {}) {
  const deploymentJson = {
    deploymentBlockNumber: 100,
    deploymentComplete: "true",
    networkName: "worldchainSepolia",
  };
  REQUIRED_DEPLOYED_CONTRACTS.forEach((contractName, index) => {
    deploymentJson[addressFor(index + 1)] = contractName;
  });
  return { ...deploymentJson, ...overrides };
}

function makeGeneratedContractsSource(overrides = {}, chainId = 4801) {
  const contracts = REQUIRED_DEPLOYED_CONTRACTS.map((contractName, index) => {
    const address = overrides[contractName]?.address ?? addressFor(index + 1);
    const deployedOnBlock =
      overrides[contractName]?.deployedOnBlock ?? index + 101;
    return `
    ${contractName}: {
      address: "${address}",
      abi: [],
      deployedOnBlock: ${deployedOnBlock},
    },`;
  }).join("");

  return `
const deployedContracts = {
  ${chainId}: {${contracts}
  },
  31337: {},
};`;
}

const protocolSource =
  'const WORLD_CHAIN_USDC_BY_CHAIN_ID = { 4801: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88" };';
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

function encodeStorageAddress(address) {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function encodeAddressWords(...addresses) {
  return `0x${addresses.map((address) => address.toLowerCase().replace(/^0x/, "").padStart(64, "0")).join("")}`;
}

function encodeAddressCallData(selector, addresses = []) {
  return `${selector}${addresses.map((address) => address.toLowerCase().replace(/^0x/, "").padStart(64, "0")).join("")}`;
}

function encodeUint256(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function handlePayoutTimingCall(call, deploymentAddresses, overrides = {}) {
  const clusterPayoutOracleAddress = deploymentAddresses.get("ClusterPayoutOracle");
  const frontendRegistryAddress = deploymentAddresses.get("FrontendRegistry");
  const data = String(call.data ?? "").toLowerCase();
  if (call.to === clusterPayoutOracleAddress && data === "0x861a1412") {
    return encodeUint256(overrides.challengeWindowSeconds ?? 15 * 60);
  }
  if (call.to === clusterPayoutOracleAddress && data === "0xf25cb0ca") {
    return encodeUint256(overrides.finalizationVetoWindowSeconds ?? 15 * 60);
  }
  if (call.to === clusterPayoutOracleAddress && data === "0x967dd972") {
    return encodeUint256(
      overrides.launchPayoutFinalityBudgetSeconds ?? 60 * 60,
    );
  }
  if (call.to === frontendRegistryAddress && data === "0x925703f1") {
    return encodeUint256(overrides.feeWithdrawalDelaySeconds ?? 60 * 60);
  }
  return undefined;
}

function selectorBytecode() {
  return `0x${[
    ...REQUIRED_SELECTOR_CHECKS.flatMap((check) => check.selectors),
    ...REQUIRED_SUBMISSION_MEDIA_VALIDATOR_SELECTORS,
  ]
    .map((selector) => selector.slice(2))
    .join("")}`;
}

function expectedDeploymentKeyFor(deploymentJson, chainId = 4801) {
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  return [
    String(chainId),
    deploymentAddresses.get("ContentRegistry").toLowerCase(),
    deploymentAddresses.get("FeedbackRegistry").toLowerCase(),
  ].join(":");
}

function expectedDatabaseSchemaFor(deploymentJson, chainId = 4801) {
  return `rateloop_deployment_${createHash("sha256").update(expectedDeploymentKeyFor(deploymentJson, chainId)).digest("hex").slice(0, 16)}`;
}

function indexerHealthResponse(status = "ok") {
  return new Response(JSON.stringify({ status }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function handleWiringCall(call, deploymentAddresses, overrides = {}) {
  for (const check of REQUIRED_ADDRESS_WIRING_CHECKS) {
    const to = deploymentAddresses.get(check.contractName);
    const argumentAddresses = (check.arguments ?? []).map((contractName) =>
      deploymentAddresses.get(contractName),
    );
    if (!to || argumentAddresses.some((address) => !address)) continue;
    const expectedData = encodeAddressCallData(
      check.selector,
      argumentAddresses,
    );
    if (
      call.to !== to ||
      call.data.toLowerCase() !== expectedData.toLowerCase()
    )
      continue;

    if (check.selector === "0xe1b361ac") {
      return encodeAddressWords(
        overrides["QuestionRewardPoolEscrow registry"] ??
          deploymentAddresses.get("ContentRegistry"),
        overrides["QuestionRewardPoolEscrow votingEngine"] ??
          deploymentAddresses.get("RoundVotingEngine"),
      );
    }

    return encodeAddressWords(
      overrides[check.label] ??
        deploymentAddresses.get(check.expectedContractName),
    );
  }
  const oracleAddress = deploymentAddresses.get("ClusterPayoutOracle");
  if (
    oracleAddress &&
    call.to === oracleAddress &&
    call.data.toLowerCase().startsWith("0x2fc1e72a")
  ) {
    const domain = Number(BigInt(`0x${call.data.slice(-64)}`));
    const consumerCheck = REQUIRED_CLUSTER_PAYOUT_ORACLE_CONSUMERS.find(
      (check) => check.domain === domain,
    );
    if (consumerCheck) {
      return encodeAddressWords(
        overrides[consumerCheck.label] ??
          deploymentAddresses.get(consumerCheck.expectedContractName),
      );
    }
  }
  if (oracleAddress && call.to === oracleAddress) {
    const data = call.data.toLowerCase();
    if (data === "0x861a1412") return encodeUint256(15 * 60);
    if (data === "0xf25cb0ca") return encodeUint256(15 * 60);
    if (data === "0x967dd972") return encodeUint256(60 * 60);
  }
  return undefined;
}

function mockRpc(handler) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    const result = handler(body.method, body.params ?? []);
    if (result && typeof result === "object" && "httpStatus" in result) {
      return new Response(result.body ?? "", {
        headers: result.headers ?? {},
        status: result.httpStatus,
      });
    }
    const responseBody =
      result && typeof result === "object" && "error" in result
        ? { jsonrpc: "2.0", id: body.id, error: result.error }
        : { jsonrpc: "2.0", id: body.id, result };
    return new Response(
      JSON.stringify(responseBody),
      {
        headers: { "content-type": "application/json" },
        status: 200,
      },
    );
  };
  return () => {
    globalThis.fetch = previousFetch;
  };
}

test("buildDeploymentAddressMap reads foundry address to contract mappings", () => {
  const map = buildDeploymentAddressMap({
    "0x0000000000000000000000000000000000000001": "ContentRegistry",
    networkName: "worldchainSepolia",
  });

  assert.equal(
    map.get("ContentRegistry"),
    "0x0000000000000000000000000000000000000001",
  );
});

test("parseGeneratedContractsForChain extracts addresses and deployed blocks for Sepolia", () => {
  const contracts = parseGeneratedContractsForChain(
    makeGeneratedContractsSource(),
  );

  assert.equal(
    contracts.get("ContentRegistry").address,
    addressFor(REQUIRED_DEPLOYED_CONTRACTS.indexOf("ContentRegistry") + 1),
  );
  assert.equal(
    contracts.get("ContentRegistry").deployedOnBlock,
    REQUIRED_DEPLOYED_CONTRACTS.indexOf("ContentRegistry") + 101,
  );
});

test("parseGeneratedContractsForChain does not borrow deployedOnBlock from the next contract", () => {
  const source = `
const deployedContracts = {
  4801: {
    AdvisoryVoteRecorder: {
      address: "${addressFor(1)}",
      abi: [],
    },
    CategoryRegistry: {
      address: "${addressFor(2)}",
      abi: [],
      deployedOnBlock: 222,
    },
  },
  31337: {},
};`;

  const contracts = parseGeneratedContractsForChain(source);

  assert.equal(contracts.get("AdvisoryVoteRecorder").address, addressFor(1));
  assert.equal(
    contracts.get("AdvisoryVoteRecorder").deployedOnBlock,
    undefined,
  );
  assert.equal(contracts.get("CategoryRegistry").deployedOnBlock, 222);
});

test("buildPonderUrl preserves path-prefixed Ponder base URLs", () => {
  assert.equal(
    buildPonderUrl("https://ponder.example.test/indexer", "/status").toString(),
    "https://ponder.example.test/indexer/status",
  );
  assert.equal(
    buildPonderUrl("https://ponder.example.test/indexer/", "rounds").toString(),
    "https://ponder.example.test/indexer/rounds",
  );
});

test("ProtocolConfig is required but not marked as Ponder-indexed", () => {
  assert(REQUIRED_DEPLOYED_CONTRACTS.includes("ProtocolConfig"));
  assert.equal(PONDER_INDEXED_CONTRACTS.includes("ProtocolConfig"), false);
});

test("required ClusterPayoutOracle consumers cover all deployed payout domains", () => {
  assert.deepEqual(
    REQUIRED_CLUSTER_PAYOUT_ORACLE_CONSUMERS.map((check) => check.domain),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    REQUIRED_CLUSTER_PAYOUT_ORACLE_CONSUMERS.map(
      (check) => check.expectedContractName,
    ),
    [
      "QuestionRewardPoolEscrow",
      "LaunchDistributionPool",
      "ContentRegistry",
      "QuestionRewardPoolEscrow",
      "RoundVotingEngine",
    ],
  );
});

test("validateOffchainRuntimeEnv fails closed for required live service env", () => {
  const checks = [];
  const failures = [];

  validateOffchainRuntimeEnv({
    checks,
    env: {},
    failures,
    requireTargets: true,
  });

  assert(failures.some((message) => message.includes("NODE_ENV")));
  assert(
    failures.some((message) => message.includes("PONDER_KEEPER_WORK_TOKEN")),
  );
  assert(failures.some((message) => message.includes("KEEPER_DATABASE_URL")));
  assert(failures.some((message) => message.includes("CORS_ORIGIN")));
  assert(
    failures.some((message) =>
      message.includes("RATE_LIMIT_TRUSTED_IP_HEADERS"),
    ),
  );
});

test("validateOffchainRuntimeEnv accepts configured production runtime env", () => {
  const checks = [];
  const failures = [];

  validateOffchainRuntimeEnv({
    checks,
    env: {
      CORS_ORIGIN: "https://www.rateloop.ai",
      KEEPER_DATABASE_URL: "postgres://keeper.example/rateloop",
      METRICS_AUTH_TOKEN: "0123456789abcdef",
      METRICS_BIND_ADDRESS: "0.0.0.0",
      NODE_ENV: "production",
      PONDER_KEEPER_WORK_TOKEN: "shared-keeper-token",
      PONDER_METADATA_SYNC_TOKEN: "shared-metadata-sync-token",
      RATE_LIMIT_TRUSTED_IP_HEADERS: "x-forwarded-for",
    },
    failures,
    requireTargets: true,
  });

  assert.deepEqual(failures, []);
  assert(checks.some((check) => check.message.includes("METRICS_AUTH_TOKEN")));
});

test("validateOffchainRuntimeEnv rejects public file artifacts on loopback metrics", () => {
  const checks = [];
  const failures = [];

  validateOffchainRuntimeEnv({
    checks,
    env: {
      KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
      KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL:
        "https://artifacts.example.com/rateloop",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
      METRICS_BIND_ADDRESS: "127.0.0.1",
    },
    failures,
  });

  assert(
    failures.some((message) =>
      message.includes(
        "METRICS_BIND_ADDRESS is non-loopback when Keeper publishes public correlation artifacts",
      ),
    ),
  );
});

test("validateOffchainRuntimeEnv requires public HTTPS URL for automatic file artifacts", () => {
  const checks = [];
  const failures = [];

  validateOffchainRuntimeEnv({
    checks,
    env: {
      KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
    },
    failures,
  });

  assert(
    failures.some((message) =>
      message.includes("KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL is configured"),
    ),
  );
});

test("validateOffchainRuntimeEnv treats unset live artifact storage as file", () => {
  const checks = [];
  const failures = [];

  validateOffchainRuntimeEnv({
    checks,
    env: {
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
    },
    failures,
  });

  assert(
    failures.some((message) =>
      message.includes("KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL is configured"),
    ),
  );
});

test("validateOffchainRuntimeEnv requires HTTPS public artifact URLs", () => {
  const checks = [];
  const failures = [];

  validateOffchainRuntimeEnv({
    checks,
    env: {
      KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
      KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL:
        "http://artifacts.example.com/rateloop",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
    },
    failures,
  });

  assert(
    failures.some((message) =>
      message.includes("KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL is HTTPS"),
    ),
  );
});

test("validateOffchainRuntimeEnv permits loopback metrics for data-uri artifacts", () => {
  const checks = [];
  const failures = [];

  validateOffchainRuntimeEnv({
    checks,
    env: {
      KEEPER_CORRELATION_ARTIFACT_STORAGE: "data-uri",
      KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL:
        "https://artifacts.example.com/rateloop",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
      METRICS_BIND_ADDRESS: "127.0.0.1",
    },
    failures,
  });

  assert.deepEqual(failures, []);
});

test("validateArtifactAllowlistParity requires matching keeper and ponder allowlists", () => {
  const matchingChecks = [];
  const matchingFailures = [];

  validateArtifactAllowlistParity({
    checks: matchingChecks,
    env: {
      KEEPER_ARTIFACT_HTTPS_ALLOWLIST: "https://keeper.example.com/artifacts/",
      KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL: "https://keeper.example.com/artifacts",
      PAYOUT_ARTIFACT_HTTPS_ALLOWLIST: "https://keeper.example.com/artifacts",
    },
    failures: matchingFailures,
  });

  assert.deepEqual(matchingFailures, []);

  const mismatchChecks = [];
  const mismatchFailures = [];

  validateArtifactAllowlistParity({
    checks: mismatchChecks,
    env: {
      KEEPER_ARTIFACT_HTTPS_ALLOWLIST: "https://keeper.example.com/artifacts",
      KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL: "https://keeper.example.com/artifacts",
      PAYOUT_ARTIFACT_HTTPS_ALLOWLIST: "https://other.example.com/artifacts",
    },
    failures: mismatchFailures,
  });

  assert.equal(mismatchFailures.length, 2);
  assert(
    mismatchFailures.some((message) =>
      message.includes("KEEPER_ARTIFACT_HTTPS_ALLOWLIST matches PAYOUT_ARTIFACT_HTTPS_ALLOWLIST"),
    ),
  );
  assert(
    mismatchFailures.some((message) =>
      message.includes("PAYOUT_ARTIFACT_HTTPS_ALLOWLIST includes KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL"),
    ),
  );

  const missingPublicBaseChecks = [];
  const missingPublicBaseFailures = [];

  validateArtifactAllowlistParity({
    checks: missingPublicBaseChecks,
    env: {
      KEEPER_ARTIFACT_HTTPS_ALLOWLIST: "https://keeper.example.com/artifacts",
      KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL: "https://keeper.example.com/published-artifacts/",
      PAYOUT_ARTIFACT_HTTPS_ALLOWLIST: "https://keeper.example.com/artifacts/",
    },
    failures: missingPublicBaseFailures,
  });

  assert.equal(missingPublicBaseFailures.length, 2);
  assert(
    missingPublicBaseFailures.some((message) =>
      message.includes("KEEPER_ARTIFACT_HTTPS_ALLOWLIST includes KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL"),
    ),
  );
  assert(
    missingPublicBaseFailures.some((message) =>
      message.includes("PAYOUT_ARTIFACT_HTTPS_ALLOWLIST includes KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL"),
    ),
  );
});

test("validateOfflineReadiness flags a contract whose deployedOnBlock is missing", () => {
  const deployedContractsSource = makeGeneratedContractsSource().replace(
    /\n\s*deployedOnBlock: 101,/,
    "",
  );

  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource,
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes(
        `${REQUIRED_DEPLOYED_CONTRACTS[0]} has a positive generated deployedOnBlock`,
      ),
    ),
  );
});

test("validateOfflineReadiness accepts synchronized Sepolia deployment artifacts", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    protocolSource,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("validateOfflineReadiness accepts synchronized Base Sepolia deployment artifacts", () => {
  const result = validateOfflineReadiness(
    {
      deploymentJson: makeDeploymentJson({ networkName: "baseSepolia" }),
      deployedContractsSource: makeGeneratedContractsSource({}, 84532),
      protocolSource:
        'const USDC_BY_CHAIN_ID = { 84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };',
    },
    BASE_SEPOLIA_READINESS_CONFIG,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("validateBaseSepoliaOfflineReadiness accepts a staging app env that targets Base Sepolia", () => {
  const result = validateBaseSepoliaOfflineReadiness({
    deploymentJson: makeDeploymentJson({ networkName: "baseSepolia" }),
    deployedContractsSource: makeGeneratedContractsSource({}, 84532),
    protocolSource:
      'const USDC_BY_CHAIN_ID = { 84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };',
    appEnvSource: "NEXT_PUBLIC_TARGET_NETWORKS=84532\n",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("validateBaseSepoliaOfflineReadiness warns on the known stale x402 submitter", () => {
  const staleSubmitter = "0x24AB19e0D8052DEc62bEc59e986e336adc4721F3";
  const deploymentJson = makeDeploymentJson({ networkName: "baseSepolia" });
  const x402Address = buildDeploymentAddressMap(deploymentJson).get(
    "X402QuestionSubmitter",
  );
  delete deploymentJson[x402Address];
  deploymentJson[staleSubmitter] = "X402QuestionSubmitter";

  const result = validateBaseSepoliaOfflineReadiness({
    deploymentJson,
    deployedContractsSource: makeGeneratedContractsSource(
      {
        X402QuestionSubmitter: {
          address: staleSubmitter,
        },
      },
      84532,
    ),
    protocolSource:
      'const USDC_BY_CHAIN_ID = { 84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };',
    appEnvSource: "NEXT_PUBLIC_TARGET_NETWORKS=84532\n",
  });

  assert.equal(result.ok, true);
  assert.match(result.warnings?.[0] ?? "", /known stale staging submitter/);
});

test("validateBaseSepoliaOfflineReadiness can require one-shot Feedback Bonus x402 support", () => {
  const staleSubmitter = "0x24AB19e0D8052DEc62bEc59e986e336adc4721F3";
  const deploymentJson = makeDeploymentJson({ networkName: "baseSepolia" });
  const x402Address = buildDeploymentAddressMap(deploymentJson).get(
    "X402QuestionSubmitter",
  );
  delete deploymentJson[x402Address];
  deploymentJson[staleSubmitter] = "X402QuestionSubmitter";

  const result = validateBaseSepoliaOfflineReadiness(
    {
      deploymentJson,
      deployedContractsSource: makeGeneratedContractsSource(
        {
          X402QuestionSubmitter: {
            address: staleSubmitter,
          },
        },
        84532,
      ),
      protocolSource:
        'const USDC_BY_CHAIN_ID = { 84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };',
      appEnvSource: "NEXT_PUBLIC_TARGET_NETWORKS=84532\n",
    },
    { requireOneShotFeedbackBonusX402: true },
  );

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes(
        "one-shot Feedback Bonus x402 submissions remain disabled",
      ),
    ),
  );
});

test("Base Sepolia readiness defaults to the committed staging env fixture", () => {
  assert.equal(
    resolveBaseSepoliaNextEnvFilePath({}),
    DEFAULT_BASE_SEPOLIA_NEXT_ENV_FILE,
  );
  assert.equal(
    resolveBaseSepoliaNextEnvFilePath({
      BASE_SEPOLIA_NEXT_ENV_FILE: "custom.env",
    }),
    "custom.env",
  );
});

test("validateBaseSepoliaOfflineReadiness rejects a staging app env that targets Base mainnet", () => {
  const result = validateBaseSepoliaOfflineReadiness({
    deploymentJson: makeDeploymentJson({ networkName: "baseSepolia" }),
    deployedContractsSource: makeGeneratedContractsSource({}, 84532),
    protocolSource:
      'const USDC_BY_CHAIN_ID = { 84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };',
    appEnvSource: "NEXT_PUBLIC_TARGET_NETWORKS=8453\n",
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("Next.js staging env targets Base Sepolia"),
    ),
  );
});

test("validateOfflineReadiness rejects stale generated contract addresses", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource({
      ContentRegistry: {
        address: "0xffffffffffffffffffffffffffffffffffffffff",
      },
    }),
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("ContentRegistry address matches"),
    ),
  );
});

test("validateOfflineReadiness rejects missing World Chain Sepolia USDC config", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    protocolSource: "const WORLD_CHAIN_USDC_BY_CHAIN_ID = {};",
  });

  assert.equal(result.ok, false);
  assert(result.failures.some((message) => message.includes("USDC address")));
});

test("validateOfflineReadiness rejects missing x402 submitter deployment", () => {
  const deploymentJson = makeDeploymentJson();
  const x402Address = buildDeploymentAddressMap(deploymentJson).get(
    "X402QuestionSubmitter",
  );
  delete deploymentJson[x402Address];

  const result = validateOfflineReadiness({
    deploymentJson,
    deployedContractsSource: makeGeneratedContractsSource(),
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("X402QuestionSubmitter has an address"),
    ),
  );
});

test("validateOfflineReadiness rejects missing confidentiality escrow deployment", () => {
  const deploymentJson = makeDeploymentJson();
  const escrowAddress = buildDeploymentAddressMap(deploymentJson).get(
    "ConfidentialityEscrow",
  );
  delete deploymentJson[escrowAddress];

  const result = validateOfflineReadiness({
    deploymentJson,
    deployedContractsSource: makeGeneratedContractsSource(),
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("ConfidentialityEscrow has an address"),
    ),
  );
});

test("validateLiveReadiness can skip missing targets for ad-hoc local use", async () => {
  const result = await validateLiveReadiness({
    deploymentJson: makeDeploymentJson(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("validateLiveReadiness retries transient RPC HTTP rate limits", async () => {
  const deploymentJson = makeDeploymentJson();
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  const contentRegistryAddress = deploymentAddresses.get("ContentRegistry");
  const submissionMediaValidatorAddress = addressFor(102);
  let chainIdAttempts = 0;
  const restoreFetch = mockRpc((method, params) => {
    if (method === "eth_chainId") {
      chainIdAttempts += 1;
      if (chainIdAttempts === 1) {
        return { httpStatus: 429, headers: { "retry-after": "0" } };
      }
      return "0x12c1";
    }
    if (method === "eth_call") {
      if (
        params[0].to === contentRegistryAddress &&
        params[0].data === "0x738dbaa0"
      ) {
        return encodeStorageAddress(submissionMediaValidatorAddress);
      }
      if (
        params[0].to === submissionMediaValidatorAddress &&
        params[0].data === "0xb717bbbd"
      ) {
        return encodeStorageAddress(contentRegistryAddress);
      }
      const timingResult = handlePayoutTimingCall(params[0], deploymentAddresses);
      if (timingResult) return timingResult;
      const wiringResult = handleWiringCall(params[0], deploymentAddresses);
      if (wiringResult) return wiringResult;
      throw new Error(`Unexpected eth_call ${JSON.stringify(params[0])}`);
    }
    if (method === "eth_getStorageAt") {
      assert.equal(params[1], EIP1967_IMPLEMENTATION_SLOT);
      return encodeStorageAddress(addressFor(0));
    }
    if (method === "eth_getCode") return selectorBytecode();
    throw new Error(`Unexpected RPC method ${method}`);
  });

  try {
    const result = await validateLiveReadiness({
      deploymentJson,
      rpcUrl: "https://rpc.example",
    });

    assert.equal(result.ok, true, result.failures.join("\n"));
    assert.equal(chainIdAttempts, 2);
  } finally {
    restoreFetch();
  }
});

test("validateLiveReadiness rejects payout finality budgets above one hour", async () => {
  const deploymentJson = makeDeploymentJson();
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  const contentRegistryAddress = deploymentAddresses.get("ContentRegistry");
  const submissionMediaValidatorAddress = addressFor(102);
  const restoreFetch = mockRpc((method, params) => {
    if (method === "eth_chainId") return "0x12c1";
    if (method === "eth_call") {
      if (
        params[0].to === contentRegistryAddress &&
        params[0].data === "0x738dbaa0"
      ) {
        return encodeStorageAddress(submissionMediaValidatorAddress);
      }
      if (
        params[0].to === submissionMediaValidatorAddress &&
        params[0].data === "0xb717bbbd"
      ) {
        return encodeStorageAddress(contentRegistryAddress);
      }
      const timingResult = handlePayoutTimingCall(params[0], deploymentAddresses, {
        challengeWindowSeconds: 60 * 60,
        feeWithdrawalDelaySeconds: 2 * 60 * 60,
        finalizationVetoWindowSeconds: 15 * 60,
        launchPayoutFinalityBudgetSeconds: 60 * 60,
      });
      if (timingResult) return timingResult;
      const wiringResult = handleWiringCall(params[0], deploymentAddresses);
      if (wiringResult) return wiringResult;
      throw new Error(`Unexpected eth_call ${JSON.stringify(params[0])}`);
    }
    if (method === "eth_getStorageAt") {
      assert.equal(params[1], EIP1967_IMPLEMENTATION_SLOT);
      return encodeStorageAddress(addressFor(0));
    }
    if (method === "eth_getCode") return selectorBytecode();
    throw new Error(`Unexpected RPC method ${method}`);
  });

  try {
    const result = await validateLiveReadiness({
      deploymentJson,
      rpcUrl: "https://rpc.example",
    });

    assert.equal(result.ok, false);
    assert(
      result.failures.some((message) =>
        message.includes("payout finality budget 8100s <= 3600s"),
      ),
      result.failures.join("\n"),
    );
  } finally {
    restoreFetch();
  }
});

test("validateLiveReadiness rejects fee withdrawal delays below the dispute window", async () => {
  const deploymentJson = makeDeploymentJson();
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  const contentRegistryAddress = deploymentAddresses.get("ContentRegistry");
  const submissionMediaValidatorAddress = addressFor(102);
  const restoreFetch = mockRpc((method, params) => {
    if (method === "eth_chainId") return "0x12c1";
    if (method === "eth_call") {
      if (
        params[0].to === contentRegistryAddress &&
        params[0].data === "0x738dbaa0"
      ) {
        return encodeStorageAddress(submissionMediaValidatorAddress);
      }
      if (
        params[0].to === submissionMediaValidatorAddress &&
        params[0].data === "0xb717bbbd"
      ) {
        return encodeStorageAddress(contentRegistryAddress);
      }
      const timingResult = handlePayoutTimingCall(params[0], deploymentAddresses, {
        feeWithdrawalDelaySeconds: 20 * 60,
      });
      if (timingResult) return timingResult;
      const wiringResult = handleWiringCall(params[0], deploymentAddresses);
      if (wiringResult) return wiringResult;
      throw new Error(`Unexpected eth_call ${JSON.stringify(params[0])}`);
    }
    if (method === "eth_getStorageAt") {
      assert.equal(params[1], EIP1967_IMPLEMENTATION_SLOT);
      return encodeStorageAddress(addressFor(0));
    }
    if (method === "eth_getCode") return selectorBytecode();
    throw new Error(`Unexpected RPC method ${method}`);
  });

  try {
    const result = await validateLiveReadiness({
      deploymentJson,
      rpcUrl: "https://rpc.example",
    });

    assert.equal(result.ok, false);
    assert(
      result.failures.some((message) =>
        message.includes(
          "fee withdrawal delay 1200s >= oracle dispute window 1800s",
        ),
      ),
      result.failures.join("\n"),
    );
  } finally {
    restoreFetch();
  }
});

test("validateLiveReadiness fails closed when required live targets are missing", async () => {
  const result = await validateLiveReadiness({
    deploymentJson: makeDeploymentJson(),
    requireTargets: true,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("WORLDCHAIN_SEPOLIA_RPC_URL"),
    ),
  );
  assert(
    result.failures.some((message) =>
      message.includes("WORLDCHAIN_SEPOLIA_PONDER_URL"),
    ),
  );
  assert(
    result.failures.some((message) =>
      message.includes("WORLDCHAIN_SEPOLIA_APP_URL"),
    ),
  );
  assert(
    result.failures.some((message) =>
      message.includes("WORLDCHAIN_SEPOLIA_KEEPER_URL"),
    ),
  );
});

test("validateLiveReadiness reports Base Sepolia env names when required live targets are missing", async () => {
  const result = await validateLiveReadiness({
    deploymentJson: makeDeploymentJson({ networkName: "baseSepolia" }),
    readinessConfig: BASE_SEPOLIA_READINESS_CONFIG,
    requireTargets: true,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) => message.includes("BASE_SEPOLIA_RPC_URL")),
  );
  assert(
    result.failures.some((message) =>
      message.includes("BASE_SEPOLIA_PONDER_URL"),
    ),
  );
  assert(
    result.failures.some((message) => message.includes("BASE_SEPOLIA_APP_URL")),
  );
  assert(
    result.failures.some((message) =>
      message.includes("BASE_SEPOLIA_KEEPER_URL"),
    ),
  );
});

test("addBasePreconfirmationEnvChecks reports Base Sepolia generic RPC requirements", () => {
  const checks = [];
  const failures = [];

  addBasePreconfirmationEnvChecks({
    chainId: BASE_SEPOLIA_READINESS_CONFIG.chainId,
    checks,
    env: {
      NEXT_PUBLIC_USE_BASE_PRECONF_RPC: "true",
    },
    failures,
    sourceLabel: "test environment",
  });

  assert(
    failures.some((message) => message.includes("NEXT_PUBLIC_RPC_URL_84532")),
  );
});

test("buildReadinessUrl preserves path-prefixed app readiness URLs", () => {
  assert.equal(
    buildReadinessUrl("https://app.example.test/rateloop", "/ask").toString(),
    "https://app.example.test/rateloop/ask",
  );
  assert.equal(
    buildReadinessUrl("https://app.example.test/rateloop/", "/").toString(),
    "https://app.example.test/rateloop/",
  );
});

test("readiness scripts print one JSON document when live mode is enabled", () => {
  const scripts = [
    "scripts/check-worldchain-sepolia-readiness.mjs",
    "scripts/check-base-sepolia-readiness.mjs",
    "scripts/check-base-mainnet-readiness.mjs",
  ];
  const env = {
    ...process.env,
    BASE_APP_URL: "",
    BASE_KEEPER_URL: "",
    BASE_PONDER_URL: "",
    BASE_RPC_URL: "",
    BASE_SEPOLIA_APP_URL: "",
    BASE_SEPOLIA_KEEPER_URL: "",
    BASE_SEPOLIA_PONDER_URL: "",
    BASE_SEPOLIA_RPC_URL: "",
    WORLDCHAIN_SEPOLIA_APP_URL: "",
    WORLDCHAIN_SEPOLIA_KEEPER_URL: "",
    WORLDCHAIN_SEPOLIA_PONDER_URL: "",
    WORLDCHAIN_SEPOLIA_RPC_URL: "",
  };

  for (const script of scripts) {
    const result = spawnSync(
      process.execPath,
      [script, "--json", "--live"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env,
      },
    );
    const parsed = JSON.parse(result.stdout);
    assert.equal(typeof parsed.offline?.title, "string", script);
    assert.equal(typeof parsed.live?.title, "string", script);
    assert.equal(result.stdout.trim().split(/\n(?=\{)/u).length, 1, script);
  }
});

test("validateLiveReadiness preserves path-prefixed app probe URLs", async () => {
  const previousFetch = globalThis.fetch;
  const requestedUrls = [];
  const deploymentJson = makeDeploymentJson();
  globalThis.fetch = async (url) => {
    const urlString = url.toString();
    requestedUrls.push(urlString);
    if (urlString.endsWith("/api/ponder/availability")) {
      return new Response(
        JSON.stringify({
          expectedDeploymentKey: expectedDeploymentKeyFor(deploymentJson),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("ok", { status: 200 });
  };

  try {
    const result = await validateLiveReadiness({
      appUrl: "https://app.example.test/base-sepolia",
      deploymentJson,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(requestedUrls, [
      "https://app.example.test/base-sepolia/",
      "https://app.example.test/base-sepolia/ask",
      "https://app.example.test/base-sepolia/docs/ai",
      "https://app.example.test/base-sepolia/api/agent/templates",
      "https://app.example.test/base-sepolia/api/ponder/availability",
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("validateLiveReadiness rejects stale Ponder deployment metadata", async () => {
  const previousFetch = globalThis.fetch;
  const deploymentJson = makeDeploymentJson();
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  globalThis.fetch = async (url) => {
    const urlString = url.toString();
    if (urlString.endsWith("/status")) {
      return new Response(
        JSON.stringify({
          worldchainSepolia: {
            block: { number: deploymentJson.deploymentBlockNumber },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlString.endsWith("/deployment")) {
      return new Response(
        JSON.stringify({
          chainId: 4801,
          contentRegistryAddress: deploymentAddresses.get("ContentRegistry"),
          feedbackRegistryAddress: addressFor(900),
          databaseSchema: expectedDatabaseSchemaFor(deploymentJson),
          databaseSchemaSource: "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY",
          deploymentKey: `${4801}:${deploymentAddresses.get("ContentRegistry").toLowerCase()}:${addressFor(900).toLowerCase()}`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlString.endsWith("/question-metadata")) {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlString.endsWith("/health/indexer")) {
      return indexerHealthResponse();
    }
    throw new Error(`Unexpected fetch ${urlString}`);
  };

  try {
    const result = await validateLiveReadiness({
      deploymentJson,
      ponderUrl: "https://ponder.example.test/indexer",
    });

    assert.equal(result.ok, false);
    assert(
      result.failures.some((message) =>
        message.includes(
          "Ponder deployment FeedbackRegistry matches deployment artifact",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes("Ponder deployment key matches deployment artifact"),
      ),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("validateLiveReadiness rejects stale Ponder database schema metadata", async () => {
  const previousFetch = globalThis.fetch;
  const deploymentJson = makeDeploymentJson();
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  globalThis.fetch = async (url) => {
    const urlString = url.toString();
    if (urlString.endsWith("/status")) {
      return new Response(
        JSON.stringify({
          worldchainSepolia: {
            block: { number: deploymentJson.deploymentBlockNumber },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlString.endsWith("/deployment")) {
      return new Response(
        JSON.stringify({
          chainId: 4801,
          contentRegistryAddress: deploymentAddresses.get("ContentRegistry"),
          feedbackRegistryAddress: deploymentAddresses.get("FeedbackRegistry"),
          databaseSchema: "rateloop_ponder_worldchain",
          databaseSchemaSource: "DATABASE_SCHEMA",
          deploymentKey: expectedDeploymentKeyFor(deploymentJson),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlString.endsWith("/question-metadata")) {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlString.endsWith("/health/indexer")) {
      return indexerHealthResponse();
    }
    throw new Error(`Unexpected fetch ${urlString}`);
  };

  try {
    const result = await validateLiveReadiness({
      deploymentJson,
      ponderUrl: "https://ponder.example.test/indexer",
    });

    assert.equal(result.ok, false);
    assert(
      result.failures.some((message) =>
        message.includes("Ponder database schema matches deployment artifact"),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes("Ponder database schema source is protocol deployment key"),
      ),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("validateLiveReadiness sends metadata sync bearer token to Ponder", async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.PONDER_METADATA_SYNC_TOKEN;
  const deploymentJson = makeDeploymentJson();
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  let metadataAuthorization = null;
  process.env.PONDER_METADATA_SYNC_TOKEN = "shared-secret";
  globalThis.fetch = async (url, init) => {
    const urlString = url.toString();
    if (urlString.endsWith("/status")) {
      return new Response(
        JSON.stringify({
          worldchainSepolia: {
            block: { number: deploymentJson.deploymentBlockNumber },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlString.endsWith("/deployment")) {
      return new Response(
        JSON.stringify({
          chainId: 4801,
          contentRegistryAddress: deploymentAddresses.get("ContentRegistry"),
          feedbackRegistryAddress: deploymentAddresses.get("FeedbackRegistry"),
          databaseSchema: expectedDatabaseSchemaFor(deploymentJson),
          databaseSchemaSource: "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY",
          deploymentKey: expectedDeploymentKeyFor(deploymentJson),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlString.endsWith("/question-metadata")) {
      metadataAuthorization = init?.headers?.authorization ?? null;
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlString.endsWith("/health/indexer")) {
      return indexerHealthResponse();
    }
    throw new Error(`Unexpected fetch ${urlString}`);
  };

  try {
    const result = await validateLiveReadiness({
      deploymentJson,
      ponderUrl: "https://ponder.example.test/indexer",
    });

    assert.equal(result.ok, true);
    assert.equal(metadataAuthorization, "Bearer shared-secret");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) {
      delete process.env.PONDER_METADATA_SYNC_TOKEN;
    } else {
      process.env.PONDER_METADATA_SYNC_TOKEN = previousToken;
    }
  }
});

test("validateLiveReadiness rejects metadata sync auth failures", async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.PONDER_METADATA_SYNC_TOKEN;
  const deploymentJson = makeDeploymentJson();
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  delete process.env.PONDER_METADATA_SYNC_TOKEN;
  globalThis.fetch = async (url) => {
    const urlString = url.toString();
    if (urlString.endsWith("/status")) {
      return new Response(
        JSON.stringify({
          worldchainSepolia: {
            block: { number: deploymentJson.deploymentBlockNumber },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlString.endsWith("/deployment")) {
      return new Response(
        JSON.stringify({
          chainId: 4801,
          contentRegistryAddress: deploymentAddresses.get("ContentRegistry"),
          feedbackRegistryAddress: deploymentAddresses.get("FeedbackRegistry"),
          databaseSchema: expectedDatabaseSchemaFor(deploymentJson),
          databaseSchemaSource: "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY",
          deploymentKey: expectedDeploymentKeyFor(deploymentJson),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlString.endsWith("/question-metadata")) {
      return new Response(
        JSON.stringify({ error: "PONDER_METADATA_SYNC_TOKEN is required." }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (urlString.endsWith("/health/indexer")) {
      return indexerHealthResponse();
    }
    throw new Error(`Unexpected fetch ${urlString}`);
  };

  try {
    const result = await validateLiveReadiness({
      deploymentJson,
      ponderUrl: "https://ponder.example.test/indexer",
    });

    assert.equal(result.ok, false);
    assert(
      result.failures.some((message) =>
        message.includes(
          "Ponder /question-metadata auth reaches JSON validation (HTTP 503)",
        ),
      ),
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) {
      delete process.env.PONDER_METADATA_SYNC_TOKEN;
    } else {
      process.env.PONDER_METADATA_SYNC_TOKEN = previousToken;
    }
  }
});

test("validateLiveReadiness rejects degraded Ponder indexer health", async () => {
  const previousFetch = globalThis.fetch;
  const deploymentJson = makeDeploymentJson();
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  globalThis.fetch = async (url) => {
    const urlString = url.toString();
    if (urlString.endsWith("/status")) {
      return new Response(
        JSON.stringify({
          worldchainSepolia: {
            block: { number: deploymentJson.deploymentBlockNumber },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlString.endsWith("/deployment")) {
      return new Response(
        JSON.stringify({
          chainId: 4801,
          contentRegistryAddress: deploymentAddresses.get("ContentRegistry"),
          feedbackRegistryAddress: deploymentAddresses.get("FeedbackRegistry"),
          databaseSchema: expectedDatabaseSchemaFor(deploymentJson),
          databaseSchemaSource: "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY",
          deploymentKey: expectedDeploymentKeyFor(deploymentJson),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlString.endsWith("/question-metadata")) {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlString.endsWith("/health/indexer")) {
      return indexerHealthResponse("degraded");
    }
    throw new Error(`Unexpected fetch ${urlString}`);
  };

  try {
    const result = await validateLiveReadiness({
      deploymentJson,
      ponderUrl: "https://ponder.example.test/indexer",
    });

    assert.equal(result.ok, false);
    assert(
      result.failures.some((message) =>
        message.includes("Ponder /health/indexer reports status degraded"),
      ),
      result.failures.join("\n"),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("validateLiveReadiness warns on attention Ponder indexer health", async () => {
  const previousFetch = globalThis.fetch;
  const deploymentJson = makeDeploymentJson();
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  globalThis.fetch = async (url) => {
    const urlString = url.toString();
    if (urlString.endsWith("/status")) {
      return new Response(
        JSON.stringify({
          worldchainSepolia: {
            block: { number: deploymentJson.deploymentBlockNumber },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlString.endsWith("/deployment")) {
      return new Response(
        JSON.stringify({
          chainId: 4801,
          contentRegistryAddress: deploymentAddresses.get("ContentRegistry"),
          feedbackRegistryAddress: deploymentAddresses.get("FeedbackRegistry"),
          databaseSchema: expectedDatabaseSchemaFor(deploymentJson),
          databaseSchemaSource: "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY",
          deploymentKey: expectedDeploymentKeyFor(deploymentJson),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlString.endsWith("/question-metadata")) {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlString.endsWith("/health/indexer")) {
      return indexerHealthResponse("attention");
    }
    throw new Error(`Unexpected fetch ${urlString}`);
  };

  try {
    const result = await validateLiveReadiness({
      deploymentJson,
      ponderUrl: "https://ponder.example.test/indexer",
    });

    assert.equal(result.ok, true, result.failures.join("\n"));
    assert(
      result.checks.some(
        (check) =>
          check.ok &&
          check.message.includes("Ponder /health/indexer reports status attention"),
      ),
    );
    assert.match(result.warnings?.[0] ?? "", /reports attention/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("validateLiveReadiness probes keeper work with the configured bearer token", async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = {
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    KEEPER_DATABASE_URL: process.env.KEEPER_DATABASE_URL,
    METRICS_AUTH_TOKEN: process.env.METRICS_AUTH_TOKEN,
    NODE_ENV: process.env.NODE_ENV,
    PONDER_KEEPER_WORK_TOKEN: process.env.PONDER_KEEPER_WORK_TOKEN,
    PONDER_METADATA_SYNC_TOKEN: process.env.PONDER_METADATA_SYNC_TOKEN,
    RATE_LIMIT_TRUSTED_IP_HEADERS: process.env.RATE_LIMIT_TRUSTED_IP_HEADERS,
  };
  const deploymentJson = makeDeploymentJson();
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  let keeperAuthorization = null;
  let keeperHealthAuthorization = null;

  Object.assign(process.env, {
    CORS_ORIGIN: "https://www.rateloop.ai",
    KEEPER_DATABASE_URL: "postgres://keeper.example/rateloop",
    METRICS_AUTH_TOKEN: "metrics-secret",
    NODE_ENV: "production",
    PONDER_KEEPER_WORK_TOKEN: "keeper-secret",
    PONDER_METADATA_SYNC_TOKEN: "metadata-secret",
    RATE_LIMIT_TRUSTED_IP_HEADERS: "x-forwarded-for",
  });

  globalThis.fetch = async (url, init) => {
    const urlString = url.toString();
    if (urlString.endsWith("/status")) {
      return new Response(
        JSON.stringify({
          worldchainSepolia: {
            block: { number: deploymentJson.deploymentBlockNumber },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlString.endsWith("/deployment")) {
      return new Response(
        JSON.stringify({
          chainId: 4801,
          contentRegistryAddress: deploymentAddresses.get("ContentRegistry"),
          feedbackRegistryAddress: deploymentAddresses.get("FeedbackRegistry"),
          databaseSchema: expectedDatabaseSchemaFor(deploymentJson),
          databaseSchemaSource: "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY",
          deploymentKey: expectedDeploymentKeyFor(deploymentJson),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlString.endsWith("/question-metadata")) {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlString.endsWith("/health/indexer")) {
      return indexerHealthResponse();
    }
    if (urlString.includes("/keeper/work?")) {
      keeperAuthorization = init?.headers?.authorization ?? null;
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlString.endsWith("/live")) {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlString.endsWith("/health")) {
      keeperHealthAuthorization = init?.headers?.authorization ?? null;
      return new Response(
        JSON.stringify({
          status: "ok",
          lastRun: new Date().toISOString(),
          consecutiveErrors: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`Unexpected fetch ${urlString}`);
  };

  try {
    const result = await validateLiveReadiness({
      deploymentJson,
      keeperUrl: "https://keeper.example.test",
      ponderUrl: "https://ponder.example.test/indexer",
      requireTargets: true,
    });

    assert.equal(keeperAuthorization, "Bearer keeper-secret");
    assert.equal(keeperHealthAuthorization, "Bearer metrics-secret");
    assert(
      result.checks.some(
        (check) =>
          check.ok &&
          check.message.includes(
            "Ponder /keeper/work accepts Keeper bearer token",
          ),
      ),
    );
    assert(
      result.checks.some(
        (check) =>
          check.ok && check.message.includes("Keeper /live reports status ok"),
      ),
    );
    assert(
      result.checks.some(
        (check) =>
          check.ok && check.message.includes("Keeper /health reports status ok"),
      ),
    );
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("validateLiveReadiness fails strict Keeper health when METRICS_AUTH_TOKEN is unset", async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.METRICS_AUTH_TOKEN;

  delete process.env.METRICS_AUTH_TOKEN;
  globalThis.fetch = async (url) => {
    const urlString = url.toString();
    if (urlString.endsWith("/live")) {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch ${urlString}`);
  };

  try {
    const result = await validateLiveReadiness({
      deploymentJson: makeDeploymentJson(),
      keeperUrl: "https://keeper.example.test",
      requireTargets: true,
    });

    assert.equal(result.ok, false);
    assert(
      result.failures.some((message) =>
        message.includes("Keeper /health live probe skipped because METRICS_AUTH_TOKEN is unset"),
      ),
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) {
      delete process.env.METRICS_AUTH_TOKEN;
    } else {
      process.env.METRICS_AUTH_TOKEN = previousToken;
    }
  }
});

test("validateLiveReadiness permits ad-hoc Keeper health skips when METRICS_AUTH_TOKEN is unset", async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.METRICS_AUTH_TOKEN;

  delete process.env.METRICS_AUTH_TOKEN;
  globalThis.fetch = async (url) => {
    const urlString = url.toString();
    if (urlString.endsWith("/live")) {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch ${urlString}`);
  };

  try {
    const result = await validateLiveReadiness({
      deploymentJson: makeDeploymentJson(),
      keeperUrl: "https://keeper.example.test",
    });

    assert.equal(result.ok, true);
    assert(
      result.checks.some(
        (check) =>
          check.ok &&
          check.message.includes("Keeper /health live probe skipped because METRICS_AUTH_TOKEN is unset"),
      ),
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) {
      delete process.env.METRICS_AUTH_TOKEN;
    } else {
      process.env.METRICS_AUTH_TOKEN = previousToken;
    }
  }
});

test("baseSepoliaNotDeployedMessage names the Base Sepolia deployment artifact", () => {
  assert.equal(
    baseSepoliaNotDeployedMessage(),
    "Base Sepolia is not deployed: missing packages/foundry/deployments/84532.json.",
  );
});

test("validateLiveReadiness rejects live bytecode missing confidentiality selectors", async () => {
  const deploymentJson = makeDeploymentJson();
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  const confidentialityEscrowAddress = deploymentAddresses.get(
    "ConfidentialityEscrow",
  );
  const contentRegistryAddress = deploymentAddresses.get("ContentRegistry");
  const protocolConfigAddress = deploymentAddresses.get("ProtocolConfig");
  const roundVotingEngineAddress = deploymentAddresses.get("RoundVotingEngine");
  const confidentialityEscrowImplementation = addressFor(98);
  const contentRegistryImplementation = addressFor(99);
  const protocolConfigImplementation = addressFor(100);
  const roundVotingEngineImplementation = addressFor(101);
  const submissionMediaValidatorAddress = addressFor(102);
  const restoreFetch = mockRpc((method, params) => {
    if (method === "eth_chainId") return "0x12c1";
    if (method === "eth_call") {
      if (
        params[0].to === contentRegistryAddress &&
        params[0].data === "0x738dbaa0"
      ) {
        return encodeStorageAddress(submissionMediaValidatorAddress);
      }
      if (
        params[0].to === submissionMediaValidatorAddress &&
        params[0].data === "0xb717bbbd"
      ) {
        return encodeStorageAddress(addressFor(777));
      }
      const timingResult = handlePayoutTimingCall(params[0], deploymentAddresses);
      if (timingResult) return timingResult;
      const wiringResult = handleWiringCall(params[0], deploymentAddresses);
      if (wiringResult) return wiringResult;
      throw new Error(`Unexpected eth_call ${JSON.stringify(params[0])}`);
    }
    if (method === "eth_getStorageAt") {
      assert.equal(params[1], EIP1967_IMPLEMENTATION_SLOT);
      if (params[0] === confidentialityEscrowAddress)
        return encodeStorageAddress(confidentialityEscrowImplementation);
      if (params[0] === contentRegistryAddress)
        return encodeStorageAddress(contentRegistryImplementation);
      if (params[0] === protocolConfigAddress)
        return encodeStorageAddress(protocolConfigImplementation);
      if (params[0] === roundVotingEngineAddress)
        return encodeStorageAddress(roundVotingEngineImplementation);
      return encodeStorageAddress(addressFor(0));
    }
    if (method === "eth_getCode") return "0x6000";
    throw new Error(`Unexpected RPC method ${method}`);
  });

  try {
    const result = await validateLiveReadiness({
      deploymentJson,
      rpcUrl: "https://rpc.example",
    });

    assert.equal(result.ok, false);
    assert(
      result.failures.some((message) =>
        message.includes(
          "X402QuestionSubmitter bytecode contains selector 0x9892be28",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "X402QuestionSubmitter bytecode contains selector 0xdc7c61c6",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "X402QuestionSubmitter bytecode contains selector 0x2dddea2d",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "X402QuestionSubmitter bytecode contains selector 0xec7b44ac",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "X402QuestionSubmitter bytecode contains selector 0x3a8bbd4e",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "X402QuestionSubmitter bytecode contains selector 0x2a78c73f",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "X402QuestionSubmitter bytecode contains selector 0x8de79fb5",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "ContentRegistry implementation bytecode contains selector 0xe2f3b89f",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "ConfidentialityEscrow implementation bytecode contains selector 0xba8520a2",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "ConfidentialityEscrow implementation bytecode contains selector 0x80fb3870",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "ProtocolConfig implementation bytecode contains selector 0xd5011d75",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "ProtocolConfig implementation bytecode contains selector 0xefdd8d2b",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "RoundVotingEngine implementation bytecode contains selector 0x6a951316",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "RoundVotingEngine implementation bytecode contains selector 0x706f3d41",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "ContentRegistry submissionMediaValidator bytecode contains selector 0x6773a34f",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "ContentRegistry submissionMediaValidator bytecode contains selector 0x6b974e07",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "ContentRegistry submissionMediaValidator authorizedEmitter is ContentRegistry",
        ),
      ),
    );
  } finally {
    restoreFetch();
  }
});

test("validateLiveReadiness rejects removed post-creation funding selectors", async () => {
  const deploymentJson = makeDeploymentJson();
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  const contentRegistryAddress = deploymentAddresses.get("ContentRegistry");
  const submissionMediaValidatorAddress = addressFor(102);
  const removedCreateRewardPoolSelector =
    REQUIRED_REMOVED_POST_CREATION_FUNDING_SELECTORS.find(
      (check) => check.label === "QuestionRewardPoolEscrow createRewardPool",
    ).selector;
  const restoreFetch = mockRpc((method, params) => {
    if (method === "eth_chainId") return "0x12c1";
    if (method === "eth_call") {
      if (
        params[0].to === contentRegistryAddress &&
        params[0].data === "0x738dbaa0"
      ) {
        return encodeStorageAddress(submissionMediaValidatorAddress);
      }
      if (
        params[0].to === submissionMediaValidatorAddress &&
        params[0].data === "0xb717bbbd"
      ) {
        return encodeStorageAddress(contentRegistryAddress);
      }
      const timingResult = handlePayoutTimingCall(params[0], deploymentAddresses);
      if (timingResult) return timingResult;
      const wiringResult = handleWiringCall(params[0], deploymentAddresses);
      if (wiringResult) return wiringResult;
      throw new Error(`Unexpected eth_call ${JSON.stringify(params[0])}`);
    }
    if (method === "eth_getStorageAt") {
      assert.equal(params[1], EIP1967_IMPLEMENTATION_SLOT);
      return encodeStorageAddress(addressFor(0));
    }
    if (method === "eth_getCode") {
      return `${selectorBytecode()}${removedCreateRewardPoolSelector.slice(2)}`;
    }
    throw new Error(`Unexpected RPC method ${method}`);
  });

  try {
    const result = await validateLiveReadiness({
      deploymentJson,
      rpcUrl: "https://rpc.example",
    });

    assert.equal(result.ok, false);
    assert(
      result.failures.some((message) =>
        message.includes(
          "QuestionRewardPoolEscrow bytecode omits removed selector 0x61a66a9d (QuestionRewardPoolEscrow createRewardPool)",
        ),
      ),
      result.failures.join("\n"),
    );
  } finally {
    restoreFetch();
  }
});

test("validateLiveReadiness rejects live deployment wiring mismatches", async () => {
  const deploymentJson = makeDeploymentJson();
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  const contentRegistryAddress = deploymentAddresses.get("ContentRegistry");
  const submissionMediaValidatorAddress = addressFor(102);
  const restoreFetch = mockRpc((method, params) => {
    if (method === "eth_chainId") return "0x12c1";
    if (method === "eth_call") {
      if (
        params[0].to === contentRegistryAddress &&
        params[0].data === "0x738dbaa0"
      ) {
        return encodeStorageAddress(submissionMediaValidatorAddress);
      }
      if (
        params[0].to === submissionMediaValidatorAddress &&
        params[0].data === "0xb717bbbd"
      ) {
        return encodeStorageAddress(contentRegistryAddress);
      }
      const timingResult = handlePayoutTimingCall(params[0], deploymentAddresses);
      if (timingResult) return timingResult;
      const wiringResult = handleWiringCall(params[0], deploymentAddresses, {
        "ProtocolConfig rewardDistributor": addressFor(777),
        "ClusterPayoutOracle public rating consumer": addressFor(779),
        "ClusterPayoutOracle RBTS settlement consumer": addressFor(780),
        "X402QuestionSubmitter feedbackBonusEscrow": addressFor(778),
      });
      if (wiringResult) return wiringResult;
      throw new Error(`Unexpected eth_call ${JSON.stringify(params[0])}`);
    }
    if (method === "eth_getStorageAt") {
      assert.equal(params[1], EIP1967_IMPLEMENTATION_SLOT);
      return encodeStorageAddress(addressFor(0));
    }
    if (method === "eth_getCode") return selectorBytecode();
    throw new Error(`Unexpected RPC method ${method}`);
  });

  try {
    const result = await validateLiveReadiness({
      deploymentJson,
      rpcUrl: "https://rpc.example",
    });

    assert.equal(result.ok, false);
    assert(
      result.failures.some((message) =>
        message.includes(
          "ProtocolConfig rewardDistributor points to RoundRewardDistributor deployment",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "X402QuestionSubmitter feedbackBonusEscrow points to FeedbackBonusEscrow deployment",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "ClusterPayoutOracle public rating consumer points to ContentRegistry deployment",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "ClusterPayoutOracle RBTS settlement consumer points to RoundVotingEngine deployment",
        ),
      ),
    );
  } finally {
    restoreFetch();
  }
});
