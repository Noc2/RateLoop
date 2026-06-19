import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_ADDRESS_WIRING_CHECKS,
  REQUIRED_DEPLOYED_CONTRACTS,
  buildReadinessUrl,
  buildDeploymentAddressMap,
  buildPonderUrl,
  parseGeneratedContractsForChain,
} from "./check-worldchain-sepolia-readiness.mjs";
import {
  loadOfflineInputs,
  mainnetNotDeployedMessage,
  validateLiveReadiness,
  validateOfflineReadiness,
} from "./check-worldchain-mainnet-readiness.mjs";
import {
  baseMainnetNotDeployedMessage,
  validateBaseMainnetOfflineReadiness,
} from "./check-base-mainnet-readiness.mjs";

function addressFor(index) {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));

function makeDeploymentJson(overrides = {}) {
  const deploymentJson = {
    deploymentBlockNumber: 100,
    deploymentComplete: "true",
    deploymentProfile: "production",
    networkName: "worldchain",
  };
  REQUIRED_DEPLOYED_CONTRACTS.forEach((contractName, index) => {
    deploymentJson[addressFor(index + 1)] = contractName;
  });
  return { ...deploymentJson, ...overrides };
}

function makeGeneratedContractsSource(overrides = {}, chainId = 480) {
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
  4801: {},
};`;
}

const protocolSource =
  'const WORLD_CHAIN_USDC_BY_CHAIN_ID = { 480: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" };';
const envProductionSource =
  "NEXT_PUBLIC_TARGET_NETWORKS=480\nNEXT_PUBLIC_WORLD_ID_ENVIRONMENT=production\nNEXT_PUBLIC_WORLD_ID_PROOF_MODE=legacy\n";
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const WORLD_ID_PRODUCTION_VERIFIER =
  "0x00000000009E00F9FE82CfeeBB4556686da094d7";

function encodeStorageAddress(address) {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function encodeAddressWords(...addresses) {
  return `0x${addresses.map(address => address.toLowerCase().replace(/^0x/, "").padStart(64, "0")).join("")}`;
}

function encodeAddressCallData(selector, addresses = []) {
  return `${selector}${addresses.map(address => address.toLowerCase().replace(/^0x/, "").padStart(64, "0")).join("")}`;
}

function handleWiringCall(call, deploymentAddresses, overrides = {}) {
  for (const check of REQUIRED_ADDRESS_WIRING_CHECKS) {
    const to = deploymentAddresses.get(check.contractName);
    const argumentAddresses = (check.arguments ?? []).map(contractName => deploymentAddresses.get(contractName));
    if (!to || argumentAddresses.some(address => !address)) continue;
    const expectedData = encodeAddressCallData(check.selector, argumentAddresses);
    if (call.to !== to || call.data.toLowerCase() !== expectedData.toLowerCase()) continue;

    if (check.selector === "0xe1b361ac") {
      return encodeAddressWords(
        overrides["QuestionRewardPoolEscrow registry"] ?? deploymentAddresses.get("ContentRegistry"),
        overrides["QuestionRewardPoolEscrow votingEngine"] ?? deploymentAddresses.get("RoundVotingEngine"),
      );
    }

    return encodeAddressWords(overrides[check.label] ?? deploymentAddresses.get(check.expectedContractName));
  }
  return undefined;
}

function mockRpc(handler) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    const result = handler(body.method, body.params ?? []);
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
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

test("parseGeneratedContractsForChain extracts addresses and deployed blocks for mainnet", () => {
  const contracts = parseGeneratedContractsForChain(
    makeGeneratedContractsSource(),
    480,
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

test("validateOfflineReadiness accepts synchronized production mainnet artifacts", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    envProductionSource,
    protocolSource,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("validateBaseMainnetOfflineReadiness accepts synchronized production Base artifacts", () => {
  const result = validateBaseMainnetOfflineReadiness({
    deploymentJson: makeDeploymentJson({ networkName: "base" }),
    deployedContractsSource: makeGeneratedContractsSource({}, 8453),
    envProductionSource:
      "NEXT_PUBLIC_TARGET_NETWORKS=8453\nNEXT_PUBLIC_WORLD_ID_ENVIRONMENT=production\nNEXT_PUBLIC_WORLD_ID_PROOF_MODE=legacy\n",
    protocolSource: 'const USDC_BY_CHAIN_ID = { 8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" };',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("retired World Chain mainnet script directs operators to Base readiness", () => {
  const result = spawnSync(process.execPath, [
    join(scriptDir, "check-worldchain-mainnet-readiness.mjs"),
  ], {
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /World Chain mainnet readiness is retired/i);
  assert.match(result.stderr, /yarn base:check/);
  assert.match(result.stderr, /yarn base-sepolia:check/);
});

test("validateOfflineReadiness rejects non-production mainnet artifacts", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson({ deploymentProfile: "staging" }),
    deployedContractsSource: makeGeneratedContractsSource(),
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("deployment artifact profile is production"),
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
    envProductionSource,
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("ContentRegistry address matches"),
    ),
  );
});

test("validateOfflineReadiness rejects missing mainnet USDC config", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    envProductionSource,
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
    envProductionSource,
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("X402QuestionSubmitter has an address"),
    ),
  );
});

test("validateOfflineReadiness rejects non-mainnet production target network", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    envProductionSource:
      "NEXT_PUBLIC_TARGET_NETWORKS=4801\nNEXT_PUBLIC_WORLD_ID_ENVIRONMENT=production\nNEXT_PUBLIC_WORLD_ID_PROOF_MODE=legacy\n",
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("production env targets World Chain mainnet"),
    ),
  );
});

test("validateOfflineReadiness rejects staging World ID for production mainnet", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    envProductionSource:
      "NEXT_PUBLIC_TARGET_NETWORKS=480\nNEXT_PUBLIC_WORLD_ID_ENVIRONMENT=staging\nNEXT_PUBLIC_WORLD_ID_PROOF_MODE=legacy\n",
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("production env uses production World ID"),
    ),
  );
});

test("loadOfflineInputs reports missing mainnet deployment artifact cleanly", () => {
  assert.equal(
    mainnetNotDeployedMessage(),
    "World Chain mainnet is not deployed: missing packages/foundry/deployments/480.json.",
  );
  assert.throws(
    () => loadOfflineInputs("/tmp/rateloop-mainnet-not-deployed"),
    (error) =>
      error?.code === "ENOENT" &&
      String(error.path).endsWith("packages/foundry/deployments/480.json"),
  );
});

test("baseMainnetNotDeployedMessage names the Base mainnet deployment artifact", () => {
  assert.equal(
    baseMainnetNotDeployedMessage(),
    "Base mainnet is not deployed: missing packages/foundry/deployments/8453.json.",
  );
});

test("shared Ponder URL builder preserves path-prefixed mainnet readiness URLs", () => {
  assert.equal(
    buildPonderUrl("https://ponder.example.test/indexer", "/status").toString(),
    "https://ponder.example.test/indexer/status",
  );
});

test("shared readiness URL builder preserves path-prefixed mainnet app URLs", () => {
  assert.equal(
    buildReadinessUrl("https://app.example.test/rateloop", "/docs/ai").toString(),
    "https://app.example.test/rateloop/docs/ai",
  );
});

test("validateLiveReadiness can skip missing targets for ad-hoc local use", async () => {
  const result = await validateLiveReadiness({
    deploymentJson: makeDeploymentJson(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("validateLiveReadiness fails closed when required live targets are missing", async () => {
  const result = await validateLiveReadiness({
    deploymentJson: makeDeploymentJson(),
    requireTargets: true,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) => message.includes("WORLDCHAIN_RPC_URL")),
  );
  assert(
    result.failures.some((message) =>
      message.includes("WORLDCHAIN_PONDER_URL"),
    ),
  );
  assert(
    result.failures.some((message) => message.includes("WORLDCHAIN_APP_URL")),
  );
});

test("validateLiveReadiness preserves path-prefixed mainnet app probe URLs", async () => {
  const previousFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(url.toString());
    return new Response("ok", { status: 200 });
  };

  try {
    const result = await validateLiveReadiness({
      appUrl: "https://app.example.test/mainnet",
      deploymentJson: makeDeploymentJson(),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(requestedUrls, [
      "https://app.example.test/mainnet/",
      "https://app.example.test/mainnet/ask",
      "https://app.example.test/mainnet/docs/ai",
      "https://app.example.test/mainnet/api/agent/templates",
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("validateLiveReadiness rejects mainnet bytecode missing required selectors and validator emitter", async () => {
  const deploymentJson = makeDeploymentJson();
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  const confidentialityEscrowAddress = deploymentAddresses.get(
    "ConfidentialityEscrow",
  );
  const contentRegistryAddress = deploymentAddresses.get("ContentRegistry");
  const protocolConfigAddress = deploymentAddresses.get("ProtocolConfig");
  const raterRegistryAddress = deploymentAddresses.get("RaterRegistry");
  const roundVotingEngineAddress = deploymentAddresses.get("RoundVotingEngine");
  const confidentialityEscrowImplementation = addressFor(98);
  const contentRegistryImplementation = addressFor(99);
  const protocolConfigImplementation = addressFor(100);
  const roundVotingEngineImplementation = addressFor(101);
  const submissionMediaValidatorAddress = addressFor(102);
  const restoreFetch = mockRpc((method, params) => {
    if (method === "eth_chainId") return "0x1e0";
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
      if (
        params[0].to === raterRegistryAddress &&
        params[0].data === "0x40340c44"
      ) {
        return encodeStorageAddress(WORLD_ID_PRODUCTION_VERIFIER);
      }
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
      throw new Error(`Unexpected proxy storage target ${params[0]}`);
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
          "ContentRegistry implementation bytecode contains selector 0x774922ea",
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
          "ContentRegistry submissionMediaValidator authorizedEmitter is ContentRegistry",
        ),
      ),
    );
  } finally {
    restoreFetch();
  }
});
