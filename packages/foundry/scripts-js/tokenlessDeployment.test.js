import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { encodeDeployData, keccak256 } from "viem";

import { exportTokenlessDeploymentFromBroadcast } from "./exportTokenlessDeploymentFromBroadcast.js";
import {
  buildTokenlessGeneratedSources,
  buildTokenlessSourceAbiFiles,
  buildTokenlessWorkerReleaseSource,
} from "./generateTokenlessArtifacts.js";
import {
  reconstructTokenlessDeploymentFromBroadcast as reconstructRawTokenlessDeploymentFromBroadcast,
  TOKENLESS_DEPLOYMENT_SCHEMA,
  tokenlessCodeEvidenceHash,
  validateTokenlessDeploymentArtifact,
} from "./tokenlessDeployment.js";
import { requireTokenlessDeploymentAddresses } from "./tokenlessDeployArgs.js";

function address(index) {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

const FEE_RECIPIENT = address(50);

const FIXTURE_COMPILED_ARTIFACTS = Object.freeze({
  TestUSDC: {
    artifact: "MockERC20",
    abi: [
      {
        type: "constructor",
        inputs: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "decimals", type: "uint8" },
        ],
      },
    ],
    bytecode: "0x6001",
  },
  CredentialIssuer: {
    artifact: "CredentialIssuer",
    abi: [
      {
        type: "constructor",
        inputs: [
          { name: "rotationAuthority", type: "address" },
          { name: "initialSigner", type: "address" },
          { name: "maximumVoucherLifetime", type: "uint64" },
        ],
      },
    ],
    bytecode: "0x6002",
  },
  QuicknetTBeaconVerifier: {
    artifact: "QuicknetTBeaconVerifier",
    abi: [],
    bytecode: "0x6003",
  },
  TokenlessPanel: {
    artifact: "TokenlessPanel",
    abi: [
      {
        type: "constructor",
        inputs: [
          { name: "usdc", type: "address" },
          { name: "credentialIssuer", type: "address" },
          { name: "beaconVerifier", type: "address" },
        ],
      },
    ],
    bytecode: "0x6004",
  },
  TokenlessFeedbackBonus: {
    artifact: "TokenlessFeedbackBonus",
    abi: [
      {
        type: "constructor",
        inputs: [
          { name: "usdc", type: "address" },
          { name: "credentialIssuer", type: "address" },
        ],
      },
    ],
    bytecode: "0x6005",
  },
  X402PanelSubmitter: {
    artifact: "X402PanelSubmitter",
    abi: [
      {
        type: "constructor",
        inputs: [
          { name: "usdc", type: "address" },
          { name: "panel", type: "address" },
        ],
      },
    ],
    bytecode: "0x6006",
  },
});

function reconstructTokenlessDeploymentFromBroadcast(broadcast, options = {}) {
  return reconstructRawTokenlessDeploymentFromBroadcast(broadcast, {
    feeRecipient: FEE_RECIPIENT,
    ...options,
  });
}

function hash(index) {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function fixtureCreationCodeHashes() {
  return Object.fromEntries(
    Object.entries(FIXTURE_COMPILED_ARTIFACTS).map(([name, artifact]) => [
      name,
      keccak256(artifact.bytecode).toLowerCase(),
    ]),
  );
}

function addRuntimeCodeEvidence(artifact) {
  const evidenced = structuredClone(artifact);
  let index = 100;
  for (const contract of Object.values(evidenced.contracts)) {
    contract.runtimeCodeHash = hash(index++);
    contract.creationCodeHash ??= hash(index++);
    contract.deploymentInputHash ??= hash(index++);
  }
  evidenced.beaconVerifierRuntimeCodeHash = hash(index);
  evidenced.beaconVerifierCreationCodeHash ??= hash(index + 1);
  evidenced.beaconVerifierDeploymentInputHash ??= hash(index + 2);
  evidenced.runtimeCodeEvidenceComplete = true;
  evidenced.codeEvidenceHash = tokenlessCodeEvidenceHash(evidenced);
  return evidenced;
}

function createTransaction(contractName, contractAddress, args, index) {
  const transactionHash = hash(index);
  const label = contractName === "MockERC20" ? "TestUSDC" : contractName;
  const compiled = FIXTURE_COMPILED_ARTIFACTS[label];
  const input = compiled
    ? encodeDeployData({
        abi: compiled.abi,
        bytecode: compiled.bytecode,
        args,
      })
    : "0x6000";
  return {
    transaction: {
      transactionType: "CREATE",
      contractName,
      contractAddress,
      arguments: args,
      hash: transactionHash,
      transaction: {
        from: FEE_RECIPIENT,
        to: null,
        input,
      },
    },
    receipt: {
      transactionHash,
      contractAddress,
      blockNumber: `0x${(100 + index).toString(16)}`,
      status: "0x1",
    },
  };
}

function completeBroadcast({ includeAdapter = false } = {}) {
  const testUsdc = address(1);
  const credentialIssuer = address(2);
  const panel = address(3);
  const feedbackBonus = address(4);
  const entries = [
    createTransaction(
      "MockERC20",
      testUsdc,
      ["RateLoop Tokenless Test USDC", "tUSDC", "6"],
      1,
    ),
    createTransaction(
      "CredentialIssuer",
      credentialIssuer,
      [address(10), address(11), "86400"],
      2,
    ),
    createTransaction("QuicknetTBeaconVerifier", address(6), [], 3),
    createTransaction(
      "TokenlessPanel",
      panel,
      [testUsdc, credentialIssuer, address(6)],
      4,
    ),
    createTransaction(
      "TokenlessFeedbackBonus",
      feedbackBonus,
      [testUsdc, credentialIssuer],
      5,
    ),
  ];
  if (includeAdapter) {
    entries.push(
      createTransaction("X402PanelSubmitter", address(5), [testUsdc, panel], 6),
    );
  }
  return {
    transactions: entries.map((entry) => entry.transaction),
    receipts: entries.map((entry) => entry.receipt),
  };
}

test("reconstructs an isolated versioned tokenless Base Sepolia artifact", () => {
  const artifact =
    reconstructTokenlessDeploymentFromBroadcast(completeBroadcast());

  assert.equal(artifact.schemaVersion, TOKENLESS_DEPLOYMENT_SCHEMA);
  assert.equal(artifact.chainId, 84532);
  assert.equal(artifact.networkName, "baseSepolia");
  assert.equal(artifact.deploymentProfile, "test");
  assert.equal(artifact.deploymentComplete, true);
  assert.equal(artifact.feeRecipient, FEE_RECIPIENT);
  assert.equal(artifact.contracts.TestUSDC.artifact, "MockERC20");
  assert.equal(artifact.contracts.CredentialIssuer.address, address(2));
  assert.equal(artifact.contracts.TokenlessPanel.address, address(3));
  assert.equal(artifact.contracts.TokenlessFeedbackBonus.address, address(4));
  assert.equal(artifact.beaconVerifier, address(6));
  assert.equal(artifact.beaconVerifierArtifact, "QuicknetTBeaconVerifier");
  assert.equal(artifact.beaconVerifierDeployedOnBlock, 103);
  assert.equal(artifact.contracts.X402PanelSubmitter, undefined);
  // The common start block is the earliest deployed block (TestUSDC at 101),
  // not the latest, so Ponder never skips earlier constructor events.
  assert.equal(artifact.deploymentBlockNumber, 101);
  assert.match(
    artifact.deploymentKey,
    /^tokenless-v4:84532:0x[0-9a-f]{40}:0x[0-9a-f]{40}:0x0{40}:0x[0-9a-f]{40}$/,
  );
});

test("deploy preflight and artifact reconstruction share deployment-address boundaries", () => {
  const deploymentAddresses = {
    TOKENLESS_FEE_RECIPIENT: FEE_RECIPIENT,
    TOKENLESS_ROTATION_AUTHORITY: address(51),
    TOKENLESS_INITIAL_SIGNER: address(52),
  };
  for (const { constructorArgumentIndex, envName, reconstructionError } of [
    {
      constructorArgumentIndex: null,
      envName: "TOKENLESS_FEE_RECIPIENT",
      reconstructionError: /feeRecipient must be a non-zero address/u,
    },
    {
      constructorArgumentIndex: 0,
      envName: "TOKENLESS_ROTATION_AUTHORITY",
      reconstructionError:
        /CredentialIssuer rotation authority must be a non-zero address/u,
    },
    {
      constructorArgumentIndex: 1,
      envName: "TOKENLESS_INITIAL_SIGNER",
      reconstructionError:
        /CredentialIssuer initial signer must be a non-zero address/u,
    },
  ]) {
    for (const invalidAddress of [
      undefined,
      "not-an-address",
      "0x0000000000000000000000000000000000000000",
    ]) {
      assert.throws(
        () =>
          requireTokenlessDeploymentAddresses({
            ...deploymentAddresses,
            [envName]: invalidAddress,
          }),
        new RegExp(`${envName} must be a non-zero address`, "u"),
      );

      const broadcast = completeBroadcast();
      let feeRecipient = FEE_RECIPIENT;
      if (constructorArgumentIndex === null) {
        feeRecipient = invalidAddress;
      } else {
        const credentialIssuer = broadcast.transactions.find(
          (transaction) => transaction.contractName === "CredentialIssuer",
        );
        credentialIssuer.arguments[constructorArgumentIndex] = invalidAddress;
      }
      assert.throws(
        () =>
          reconstructRawTokenlessDeploymentFromBroadcast(broadcast, {
            feeRecipient,
          }),
        reconstructionError,
      );
    }
  }

  assert.deepEqual(requireTokenlessDeploymentAddresses(deploymentAddresses), {
    feeRecipient: FEE_RECIPIENT,
    rotationAuthority: deploymentAddresses.TOKENLESS_ROTATION_AUTHORITY,
    initialSigner: deploymentAddresses.TOKENLESS_INITIAL_SIGNER,
  });
  const artifact =
    reconstructTokenlessDeploymentFromBroadcast(completeBroadcast());
  assert.equal(artifact.feeRecipient, FEE_RECIPIENT);
  assert.throws(
    () =>
      validateTokenlessDeploymentArtifact({
        ...artifact,
        feeRecipient: undefined,
      }),
    /feeRecipient must be a non-zero address/u,
  );
});

test("exports the earliest deployed block even when the adapter is deployed last", () => {
  const artifact = reconstructTokenlessDeploymentFromBroadcast(
    completeBroadcast({ includeAdapter: true }),
  );
  assert.equal(artifact.contracts.X402PanelSubmitter.deployedOnBlock, 106);
  assert.equal(artifact.deploymentBlockNumber, 101);
});

test("rejects a deployment block that is not the earliest contract block", () => {
  const artifact = reconstructTokenlessDeploymentFromBroadcast(
    completeBroadcast({ includeAdapter: true }),
  );
  assert.equal(artifact.deploymentBlockNumber, 101);
  assert.throws(
    () =>
      validateTokenlessDeploymentArtifact({
        ...artifact,
        deploymentBlockNumber: 106,
      }),
    /must equal the earliest contract deployment block/,
  );
  // The genuine minimum still validates.
  assert.equal(
    validateTokenlessDeploymentArtifact(artifact).deploymentBlockNumber,
    101,
  );
});

test("includes X402PanelSubmitter when the optional adapter is deployed", () => {
  const artifact = reconstructTokenlessDeploymentFromBroadcast(
    completeBroadcast({ includeAdapter: true }),
  );
  assert.equal(artifact.contracts.X402PanelSubmitter.address, address(5));
  assert.ok(artifact.deploymentKey.includes(`:${address(5)}:`));
});

test("resolves Foundry CREATE hash permutations by unique successful receipt address", () => {
  const broadcast = completeBroadcast({ includeAdapter: true });
  const originalHashes = broadcast.transactions.map(
    (transaction) => transaction.hash,
  );
  broadcast.transactions[0].hash = originalHashes[2];
  broadcast.transactions[1].hash = originalHashes[0];
  broadcast.transactions[2].hash = originalHashes[1];

  const artifact = reconstructTokenlessDeploymentFromBroadcast(broadcast);
  assert.equal(artifact.contracts.TestUSDC.deployedOnBlock, 101);
  assert.equal(artifact.contracts.CredentialIssuer.deployedOnBlock, 102);
  assert.equal(artifact.contracts.TokenlessPanel.deployedOnBlock, 104);
  assert.equal(artifact.contracts.TokenlessFeedbackBonus.deployedOnBlock, 105);
  assert.equal(artifact.contracts.X402PanelSubmitter.deployedOnBlock, 106);
});

test("binds every CREATE input to the matching compiled deploy-profile artifact", () => {
  const complete = completeBroadcast({ includeAdapter: true });
  assert.doesNotThrow(() =>
    reconstructTokenlessDeploymentFromBroadcast(complete, {
      compiledArtifacts: FIXTURE_COMPILED_ARTIFACTS,
    }),
  );

  for (const contractName of [
    "MockERC20",
    "CredentialIssuer",
    "QuicknetTBeaconVerifier",
    "TokenlessPanel",
    "TokenlessFeedbackBonus",
    "X402PanelSubmitter",
  ]) {
    const mutated = structuredClone(complete);
    const transaction = mutated.transactions.find(
      (candidate) => candidate.contractName === contractName,
    );
    transaction.transaction.input = `${transaction.transaction.input.slice(0, -2)}ff`;
    assert.throws(
      () =>
        reconstructTokenlessDeploymentFromBroadcast(mutated, {
          compiledArtifacts: FIXTURE_COMPILED_ARTIFACTS,
        }),
      new RegExp(
        `${contractName === "MockERC20" ? "TestUSDC" : contractName} CREATE transaction.input does not match`,
        "u",
      ),
    );
  }
});

test("compiled CREATE evidence fails closed when missing or malformed", () => {
  const missingInput = completeBroadcast();
  delete missingInput.transactions[0].transaction.input;
  assert.throws(
    () =>
      reconstructTokenlessDeploymentFromBroadcast(missingInput, {
        compiledArtifacts: FIXTURE_COMPILED_ARTIFACTS,
      }),
    /TestUSDC CREATE transaction\.input must be non-empty exact bytecode/u,
  );

  const nonCreateDestination = completeBroadcast();
  nonCreateDestination.transactions[0].transaction.to = address(99);
  assert.throws(
    () =>
      reconstructTokenlessDeploymentFromBroadcast(nonCreateDestination, {
        compiledArtifacts: FIXTURE_COMPILED_ARTIFACTS,
      }),
    /TestUSDC CREATE transaction must have a null destination/u,
  );

  const missingArtifact = structuredClone(FIXTURE_COMPILED_ARTIFACTS);
  delete missingArtifact.TokenlessPanel;
  assert.throws(
    () =>
      reconstructTokenlessDeploymentFromBroadcast(completeBroadcast(), {
        compiledArtifacts: missingArtifact,
      }),
    /Missing compiled deployment artifact for TokenlessPanel/u,
  );

  const malformedArtifact = structuredClone(FIXTURE_COMPILED_ARTIFACTS);
  malformedArtifact.CredentialIssuer.bytecode = "0x__unlinked__";
  assert.throws(
    () =>
      reconstructTokenlessDeploymentFromBroadcast(completeBroadcast(), {
        compiledArtifacts: malformedArtifact,
      }),
    /CredentialIssuer creation bytecode must be non-empty exact bytecode/u,
  );
});

test("rejects missing required contracts and mixed broadcasts", () => {
  const missingIssuer = completeBroadcast();
  missingIssuer.transactions = missingIssuer.transactions.filter(
    (transaction) => transaction.contractName !== "CredentialIssuer",
  );
  assert.throws(
    () => reconstructTokenlessDeploymentFromBroadcast(missingIssuer),
    /exactly one CredentialIssuer/,
  );

  const missingFeedbackBonus = completeBroadcast();
  missingFeedbackBonus.transactions = missingFeedbackBonus.transactions.filter(
    (transaction) => transaction.contractName !== "TokenlessFeedbackBonus",
  );
  assert.throws(
    () => reconstructTokenlessDeploymentFromBroadcast(missingFeedbackBonus),
    /exactly one TokenlessFeedbackBonus/,
  );

  const missingBeaconVerifier = completeBroadcast();
  missingBeaconVerifier.transactions =
    missingBeaconVerifier.transactions.filter(
      (transaction) => transaction.contractName !== "QuicknetTBeaconVerifier",
    );
  assert.throws(
    () => reconstructTokenlessDeploymentFromBroadcast(missingBeaconVerifier),
    /exactly one QuicknetTBeaconVerifier/,
  );

  const mixed = completeBroadcast();
  const unexpected = createTransaction(
    "UnexpectedContract",
    address(20),
    [],
    20,
  );
  mixed.transactions.push(unexpected.transaction);
  mixed.receipts.push(unexpected.receipt);
  assert.throws(
    () => reconstructTokenlessDeploymentFromBroadcast(mixed),
    /mixed or unknown tokenless deployment broadcast/,
  );
});

test("fails closed when a CREATE address has no unique successful receipt", () => {
  const missing = completeBroadcast();
  missing.receipts[0].contractAddress = address(99);
  assert.throws(
    () => reconstructTokenlessDeploymentFromBroadcast(missing),
    /exactly one successful receipt for MockERC20.*found 0/,
  );

  const duplicate = completeBroadcast();
  duplicate.receipts.push({
    ...duplicate.receipts[0],
    transactionHash: hash(99),
  });
  assert.throws(
    () => reconstructTokenlessDeploymentFromBroadcast(duplicate),
    /exactly one successful receipt for MockERC20.*found 2/,
  );
});

test("rejects TokenlessPanel constructor wiring that disagrees with exports", () => {
  const broadcast = completeBroadcast();
  const panel = broadcast.transactions.find(
    (transaction) => transaction.contractName === "TokenlessPanel",
  );
  panel.arguments[0] = address(99);
  assert.throws(
    () => reconstructTokenlessDeploymentFromBroadcast(broadcast),
    /constructor wiring must match/,
  );
});

test("rejects an arbitrary verifier address not deployed in the same broadcast", () => {
  const broadcast = completeBroadcast();
  const panel = broadcast.transactions.find(
    (transaction) => transaction.contractName === "TokenlessPanel",
  );
  panel.arguments[2] = address(99);
  assert.throws(
    () => reconstructTokenlessDeploymentFromBroadcast(broadcast),
    /must be the QuicknetTBeaconVerifier deployed in the same broadcast/,
  );
});

test("rejects TokenlessFeedbackBonus constructor wiring that disagrees with exports", () => {
  const broadcast = completeBroadcast();
  const bonus = broadcast.transactions.find(
    (transaction) => transaction.contractName === "TokenlessFeedbackBonus",
  );
  bonus.arguments[1] = address(99);
  assert.throws(
    () => reconstructTokenlessDeploymentFromBroadcast(broadcast),
    /TokenlessFeedbackBonus constructor wiring must match/,
  );
});

test("rejects X402PanelSubmitter constructor wiring that disagrees with exports", () => {
  const broadcast = completeBroadcast({ includeAdapter: true });
  const adapter = broadcast.transactions.find(
    (transaction) => transaction.contractName === "X402PanelSubmitter",
  );
  adapter.arguments[1] = address(99);
  assert.throws(
    () => reconstructTokenlessDeploymentFromBroadcast(broadcast),
    /X402PanelSubmitter constructor wiring must match/,
  );
});

test("validates deployment keys against contract addresses", () => {
  const artifact =
    reconstructTokenlessDeploymentFromBroadcast(completeBroadcast());
  assert.throws(
    () =>
      validateTokenlessDeploymentArtifact({
        ...artifact,
        deploymentKey: "tokenless-v1:wrong",
      }),
    /deployment key does not match/,
  );
});

test("complete artifacts require exact test profile, currency, artifacts, and runtime evidence", () => {
  const complete = addRuntimeCodeEvidence(
    reconstructTokenlessDeploymentFromBroadcast(
      completeBroadcast({ includeAdapter: true }),
      { compiledArtifacts: FIXTURE_COMPILED_ARTIFACTS },
    ),
  );
  assert.doesNotThrow(() =>
    validateTokenlessDeploymentArtifact(complete, {
      requireRuntimeCodeEvidence: true,
      expectedCreationCodeHashes: fixtureCreationCodeHashes(),
    }),
  );

  const mutations = [
    {
      mutate: (artifact) => {
        artifact.sourceCompatibility = "released";
      },
      error: /Unsupported tokenless deployment source compatibility released/u,
    },
    {
      mutate: (artifact) => {
        artifact.deploymentProfile = "production";
      },
      error: /profile must be test/u,
    },
    ...["contract", "decimals", "symbol", "unrestrictedMint"].map((field) => ({
      mutate: (artifact) => {
        artifact.testCurrency[field] =
          field === "unrestrictedMint" ? false : "wrong";
      },
      error: /test currency metadata must exactly describe unrestricted tUSDC/u,
    })),
    {
      mutate: (artifact) => {
        artifact.testCurrency.extra = true;
      },
      error: /test currency metadata must exactly describe unrestricted tUSDC/u,
    },
    ...Object.keys(complete.contracts).map((name) => ({
      mutate: (artifact) => {
        artifact.contracts[name].artifact = "WrongArtifact";
      },
      error: new RegExp(`${name} artifact must be`, "u"),
    })),
    {
      mutate: (artifact) => {
        delete artifact.contracts.X402PanelSubmitter.runtimeCodeHash;
      },
      error: /X402PanelSubmitter runtimeCodeHash is missing/u,
    },
    {
      mutate: (artifact) => {
        artifact.contracts.TokenlessPanel.runtimeCodeHash = hash(999);
      },
      error: /code evidence hash does not match/u,
    },
    {
      mutate: (artifact) => {
        artifact.contracts.TokenlessFeedbackBonus.creationCodeHash = hash(998);
      },
      error: /creation bytecode does not match/u,
    },
  ];

  for (const { mutate, error } of mutations) {
    const candidate = structuredClone(complete);
    mutate(candidate);
    assert.throws(
      () =>
        validateTokenlessDeploymentArtifact(candidate, {
          requireRuntimeCodeEvidence: true,
          expectedCreationCodeHashes: fixtureCreationCodeHashes(),
        }),
      error,
    );
  }
});

test("export writes tokenless-v4 with exact runtime hashes and leaves historical artifacts untouched", async () => {
  const root = mkdtempSync(join(tmpdir(), "rateloop-tokenless-export-"));
  try {
    const unrelatedPath = join(root, "deployments", "unrelated.json");
    const historicalV3Path = join(
      root,
      "deployments",
      "tokenless-v3",
      "84532.json",
    );
    const broadcastPath = join(root, "run-latest.json");
    const tokenlessPath = join(
      root,
      "deployments",
      "tokenless-v4",
      "84532.json",
    );
    mkdirSync(join(root, "deployments"), { recursive: true });
    mkdirSync(join(root, "deployments", "tokenless-v3"), {
      recursive: true,
    });
    writeFileSync(unrelatedPath, '{"unrelated":true}\n');
    writeFileSync(historicalV3Path, '{"historicalV3":true}\n');
    writeFileSync(broadcastPath, JSON.stringify(completeBroadcast()));

    await exportTokenlessDeploymentFromBroadcast({
      broadcastPath,
      deploymentPath: tokenlessPath,
      targetNetwork: "baseSepolia",
      feeRecipient: FEE_RECIPIENT,
      compiledArtifacts: FIXTURE_COMPILED_ARTIFACTS,
      getBytecode: async (contractAddress) =>
        `0x60${contractAddress.slice(-2)}`,
      expectedBeaconVerifierRuntimeCodeHash: keccak256("0x6006"),
    });

    assert.equal(readFileSync(unrelatedPath, "utf8"), '{"unrelated":true}\n');
    assert.equal(
      readFileSync(historicalV3Path, "utf8"),
      '{"historicalV3":true}\n',
    );
    const exported = JSON.parse(readFileSync(tokenlessPath, "utf8"));
    assert.equal(exported.schemaVersion, TOKENLESS_DEPLOYMENT_SCHEMA);
    assert.equal(exported.chainId, 84532);
    assert.equal(exported.feeRecipient, FEE_RECIPIENT);
    assert.equal(exported.runtimeCodeEvidenceComplete, true);
    assert.match(
      exported.contracts.TokenlessPanel.runtimeCodeHash,
      /^0x[0-9a-f]{64}$/u,
    );
    for (const contract of Object.values(exported.contracts)) {
      assert.match(contract.creationCodeHash, /^0x[0-9a-f]{64}$/u);
      assert.match(contract.deploymentInputHash, /^0x[0-9a-f]{64}$/u);
    }
    assert.match(exported.beaconVerifierRuntimeCodeHash, /^0x[0-9a-f]{64}$/u);
    assert.match(exported.beaconVerifierCreationCodeHash, /^0x[0-9a-f]{64}$/u);
    assert.match(
      exported.beaconVerifierDeploymentInputHash,
      /^0x[0-9a-f]{64}$/u,
    );
    assert.equal(
      exported.codeEvidenceHash,
      tokenlessCodeEvidenceHash(exported),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("export waits for a freshly deployed contract to propagate across the RPC", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "rateloop-tokenless-rpc-propagation-"),
  );
  try {
    const broadcastPath = join(root, "run-latest.json");
    const deploymentPath = join(
      root,
      "deployments",
      "tokenless-v4",
      "84532.json",
    );
    const broadcast = completeBroadcast();
    const testUsdc = broadcast.transactions[0].contractAddress;
    let testUsdcLoads = 0;
    let waits = 0;
    writeFileSync(broadcastPath, JSON.stringify(broadcast));

    const { artifact } = await exportTokenlessDeploymentFromBroadcast({
      broadcastPath,
      deploymentPath,
      targetNetwork: "baseSepolia",
      feeRecipient: FEE_RECIPIENT,
      compiledArtifacts: FIXTURE_COMPILED_ARTIFACTS,
      getBytecode: async (contractAddress) => {
        if (contractAddress === testUsdc && testUsdcLoads++ < 2) return "0x";
        return `0x60${contractAddress.slice(-2)}`;
      },
      expectedBeaconVerifierRuntimeCodeHash: keccak256("0x6006"),
      bytecodeRetryAttempts: 3,
      bytecodeRetryDelayMs: 1,
      waitForBytecodeRetry: async () => {
        waits += 1;
      },
    });

    assert.equal(testUsdcLoads, 3);
    assert.equal(waits, 2);
    assert.equal(artifact.runtimeCodeEvidenceComplete, true);
    assert.equal(
      JSON.parse(readFileSync(deploymentPath, "utf8"))
        .runtimeCodeEvidenceComplete,
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("export rejects deployed verifier bytecode that differs from the compiled runtime", async () => {
  const root = mkdtempSync(join(tmpdir(), "rateloop-tokenless-verifier-hash-"));
  try {
    const broadcastPath = join(root, "run-latest.json");
    const deploymentPath = join(
      root,
      "deployments",
      "tokenless-v4",
      "84532.json",
    );
    writeFileSync(broadcastPath, JSON.stringify(completeBroadcast()));

    await assert.rejects(
      () =>
        exportTokenlessDeploymentFromBroadcast({
          broadcastPath,
          deploymentPath,
          targetNetwork: "baseSepolia",
          feeRecipient: FEE_RECIPIENT,
          compiledArtifacts: FIXTURE_COMPILED_ARTIFACTS,
          getBytecode: async (contractAddress) =>
            `0x60${contractAddress.slice(-2)}`,
          expectedBeaconVerifierRuntimeCodeHash: keccak256("0x6007"),
        }),
      /runtime bytecode hash mismatch/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generated sources expose required ABIs and omit the absent adapter", () => {
  const artifact =
    reconstructTokenlessDeploymentFromBroadcast(completeBroadcast());
  const sources = buildTokenlessGeneratedSources(artifact, {
    abiLoader: (contractName) => [
      { type: "function", name: `fixture${contractName}` },
    ],
  });

  assert.ok(sources.has("abis/CredentialIssuerAbi.ts"));
  assert.ok(sources.has("abis/TokenlessPanelAbi.ts"));
  assert.ok(sources.has("abis/TokenlessFeedbackBonusAbi.ts"));
  assert.ok(sources.has("abis/TokenlessTestUSDCAbi.ts"));
  assert.equal(sources.has("abis/X402PanelSubmitterAbi.ts"), false);
  assert.match(
    sources.get("deployedContracts.ts"),
    /rateloop-tokenless-deployment-v4/,
  );
  assert.match(sources.get("deployedContracts.ts"), /"status": "released"/);
  assert.doesNotMatch(sources.get("index.ts"), /X402PanelSubmitterAbi/);
  assert.match(sources.get("index.ts"), /from "\.\/historicalDeployments"/);
  assert.equal(sources.has("historicalDeployments.ts"), false);
});

test("source-only ABI generation cannot emit or replace deployment metadata", () => {
  const sources = buildTokenlessSourceAbiFiles({
    abiLoader: (contractName) => [
      { type: "function", name: `fixture${contractName}` },
    ],
  });

  assert.deepEqual([...sources.keys()].sort(), [
    "abis/CredentialIssuerAbi.ts",
    "abis/TokenlessFeedbackBonusAbi.ts",
    "abis/TokenlessPanelAbi.ts",
    "abis/TokenlessTestUSDCAbi.ts",
    "abis/X402PanelSubmitterAbi.ts",
  ]);
  assert.equal(sources.has("deployedContracts.ts"), false);
  assert.equal(sources.has("index.ts"), false);
  for (const source of sources.values()) {
    assert.match(source, /rateloop-tokenless-deployment-v4/);
    assert.doesNotMatch(source, /0x[0-9a-f]{40}/i);
  }
});

test("the checked-in released v4 artifact generates the active source registry", () => {
  const artifact = JSON.parse(
    readFileSync(
      new URL("../deployments/tokenless-v4/84532.json", import.meta.url),
      "utf8",
    ),
  );

  const sources = buildTokenlessGeneratedSources(artifact, {
    abiLoader: () => [],
  });
  assert.match(sources.get("deployedContracts.ts"), /"status": "released"/u);
  assert.match(
    sources.get("deployedContracts.ts"),
    new RegExp(String(artifact.deploymentBlockNumber), "u"),
  );

  const workerSource = buildTokenlessWorkerReleaseSource(artifact);
  assert.match(workerSource, /releasedTokenlessBaseSepoliaDeployment/u);
  assert.match(workerSource, new RegExp(artifact.deploymentKey, "u"));
  assert.match(
    workerSource,
    new RegExp(String(artifact.deploymentBlockNumber), "u"),
  );
  assert.match(workerSource, new RegExp(artifact.beaconVerifier, "iu"));
  assert.match(workerSource, new RegExp(artifact.codeEvidenceHash, "u"));
  for (const workerPath of [
    new URL(
      "../../ponder/src/released-tokenless-deployment.ts",
      import.meta.url,
    ),
    new URL(
      "../../keeper/src/released-tokenless-deployment.ts",
      import.meta.url,
    ),
  ]) {
    assert.equal(readFileSync(workerPath, "utf8"), workerSource);
  }
});

test("full artifact generation rejects historical v1 deployment metadata", () => {
  const historical = reconstructTokenlessDeploymentFromBroadcast(
    completeBroadcast({ includeAdapter: true }),
  );
  historical.schemaVersion = "rateloop-tokenless-deployment-v1";
  historical.version = 1;
  historical.deploymentKey = historical.deploymentKey.replace(
    "tokenless-v4:",
    "tokenless-v1:",
  );

  assert.throws(
    () =>
      buildTokenlessGeneratedSources(historical, {
        abiLoader: () => [],
      }),
    /Unsupported tokenless deployment schema rateloop-tokenless-deployment-v1/,
  );
});
