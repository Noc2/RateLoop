import assert from "node:assert/strict";
import test from "node:test";
import {
  PONDER_INDEXED_CONTRACTS,
  REQUIRED_ADDRESS_WIRING_CHECKS,
  REQUIRED_DEPLOYED_CONTRACTS,
  REQUIRED_SELECTOR_CHECKS,
  REQUIRED_SUBMISSION_MEDIA_VALIDATOR_SELECTORS,
  buildDeploymentAddressMap,
  buildPonderUrl,
  parseGeneratedContractsForChain,
  validateLiveReadiness,
  validateOfflineReadiness,
} from "./check-worldchain-sepolia-readiness.mjs";
import {
  BASE_SEPOLIA_READINESS_CONFIG,
  baseSepoliaNotDeployedMessage,
} from "./check-base-sepolia-readiness.mjs";

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
  return `0x${addresses.map(address => address.toLowerCase().replace(/^0x/, "").padStart(64, "0")).join("")}`;
}

function encodeAddressCallData(selector, addresses = []) {
  return `${selector}${addresses.map(address => address.toLowerCase().replace(/^0x/, "").padStart(64, "0")).join("")}`;
}

function selectorBytecode() {
  return `0x${[
    ...REQUIRED_SELECTOR_CHECKS.flatMap(check => check.selectors),
    ...REQUIRED_SUBMISSION_MEDIA_VALIDATOR_SELECTORS,
  ]
    .map(selector => selector.slice(2))
    .join("")}`;
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
      protocolSource: 'const USDC_BY_CHAIN_ID = { 84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };',
    },
    BASE_SEPOLIA_READINESS_CONFIG,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
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
});

test("validateLiveReadiness reports Base Sepolia env names when required live targets are missing", async () => {
  const result = await validateLiveReadiness({
    deploymentJson: makeDeploymentJson({ networkName: "baseSepolia" }),
    readinessConfig: BASE_SEPOLIA_READINESS_CONFIG,
    requireTargets: true,
  });

  assert.equal(result.ok, false);
  assert(result.failures.some((message) => message.includes("BASE_SEPOLIA_RPC_URL")));
  assert(result.failures.some((message) => message.includes("BASE_SEPOLIA_PONDER_URL")));
  assert(result.failures.some((message) => message.includes("BASE_SEPOLIA_APP_URL")));
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
          "X402QuestionSubmitter bytecode contains selector 0x1c2fa657",
        ),
      ),
    );
    assert(
      result.failures.some((message) =>
        message.includes(
          "X402QuestionSubmitter bytecode contains selector 0x61b030bc",
        ),
      ),
    );
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
          "ConfidentialityEscrow implementation bytecode contains selector 0xe3de2a7a",
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
      const wiringResult = handleWiringCall(params[0], deploymentAddresses, {
        "ProtocolConfig rewardDistributor": addressFor(777),
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
        message.includes("ProtocolConfig rewardDistributor points to RoundRewardDistributor deployment"),
      ),
    );
  } finally {
    restoreFetch();
  }
});
