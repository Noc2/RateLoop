import assert from "node:assert/strict";
import test from "node:test";
import {
  PONDER_INDEXED_CONTRACTS,
  REQUIRED_DEPLOYED_CONTRACTS,
  buildDeploymentAddressMap,
  parseGeneratedContractsForChain,
  validateLiveReadiness,
  validateOfflineReadiness,
} from "./check-worldchain-sepolia-readiness.mjs";

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

function makeGeneratedContractsSource(overrides = {}) {
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
  4801: {${contracts}
  },
  31337: {},
};`;
}

const protocolSource =
  'const WORLD_CHAIN_USDC_BY_CHAIN_ID = { 4801: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88" };';
const envProductionSource =
  "NEXT_PUBLIC_TARGET_NETWORKS=4801\nNEXT_PUBLIC_WORLD_ID_PROOF_MODE=legacy\n";
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

function encodeStorageAddress(address) {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
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
    envProductionSource,
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
    envProductionSource,
    protocolSource,
  });

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

test("validateOfflineReadiness rejects missing World Chain Sepolia USDC config", () => {
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

test("validateOfflineReadiness rejects missing confidentiality escrow deployment", () => {
  const deploymentJson = makeDeploymentJson();
  const escrowAddress = buildDeploymentAddressMap(deploymentJson).get(
    "ConfidentialityEscrow",
  );
  delete deploymentJson[escrowAddress];

  const result = validateOfflineReadiness({
    deploymentJson,
    deployedContractsSource: makeGeneratedContractsSource(),
    envProductionSource,
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("ConfidentialityEscrow has an address"),
    ),
  );
});

test("validateOfflineReadiness rejects non-Sepolia production target network", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    envProductionSource:
      "NEXT_PUBLIC_TARGET_NETWORKS=480\nNEXT_PUBLIC_WORLD_ID_PROOF_MODE=legacy\n",
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("production env targets World Chain Sepolia"),
    ),
  );
});

test("validateOfflineReadiness rejects v4 World ID proof mode for Sepolia v3 deploys", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    envProductionSource:
      "NEXT_PUBLIC_TARGET_NETWORKS=4801\nNEXT_PUBLIC_WORLD_ID_PROOF_MODE=v4\n",
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("production env requests legacy World ID proofs"),
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
