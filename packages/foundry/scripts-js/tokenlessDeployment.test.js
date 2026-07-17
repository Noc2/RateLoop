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

import { exportTokenlessDeploymentFromBroadcast } from "./exportTokenlessDeploymentFromBroadcast.js";
import {
  buildTokenlessGeneratedSources,
  buildTokenlessSourceAbiFiles,
} from "./generateTokenlessArtifacts.js";
import {
  reconstructTokenlessDeploymentFromBroadcast,
  TOKENLESS_DEPLOYMENT_SCHEMA,
  validateTokenlessDeploymentArtifact,
} from "./tokenlessDeployment.js";

function address(index) {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

function hash(index) {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function createTransaction(contractName, contractAddress, args, index) {
  const transactionHash = hash(index);
  return {
    transaction: {
      transactionType: "CREATE",
      contractName,
      contractAddress,
      arguments: args,
      hash: transactionHash,
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
    createTransaction("TokenlessPanel", panel, [testUsdc, credentialIssuer], 3),
    createTransaction(
      "TokenlessFeedbackBonus",
      feedbackBonus,
      [testUsdc, credentialIssuer],
      4,
    ),
  ];
  if (includeAdapter) {
    entries.push(
      createTransaction("X402PanelSubmitter", address(5), [testUsdc, panel], 5),
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
  assert.equal(artifact.contracts.TestUSDC.artifact, "MockERC20");
  assert.equal(artifact.contracts.CredentialIssuer.address, address(2));
  assert.equal(artifact.contracts.TokenlessPanel.address, address(3));
  assert.equal(artifact.contracts.TokenlessFeedbackBonus.address, address(4));
  assert.equal(artifact.contracts.X402PanelSubmitter, undefined);
  // The common start block is the earliest deployed block (TestUSDC at 101),
  // not the latest, so Ponder never skips earlier constructor events.
  assert.equal(artifact.deploymentBlockNumber, 101);
  assert.match(
    artifact.deploymentKey,
    /^tokenless-v4:84532:0x[0-9a-f]{40}:0x[0-9a-f]{40}:0x0{40}:0x[0-9a-f]{40}$/,
  );
});

test("exports the earliest deployed block even when the adapter is deployed last", () => {
  const artifact = reconstructTokenlessDeploymentFromBroadcast(
    completeBroadcast({ includeAdapter: true }),
  );
  assert.equal(artifact.contracts.X402PanelSubmitter.deployedOnBlock, 105);
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
        deploymentBlockNumber: 105,
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
  assert.equal(artifact.contracts.TokenlessPanel.deployedOnBlock, 103);
  assert.equal(artifact.contracts.TokenlessFeedbackBonus.deployedOnBlock, 104);
  assert.equal(artifact.contracts.X402PanelSubmitter.deployedOnBlock, 105);
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

test("export writes tokenless-v4 separately and leaves historical artifacts untouched", () => {
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

    exportTokenlessDeploymentFromBroadcast({
      broadcastPath,
      deploymentPath: tokenlessPath,
      targetNetwork: "baseSepolia",
    });

    assert.equal(readFileSync(unrelatedPath, "utf8"), '{"unrelated":true}\n');
    assert.equal(
      readFileSync(historicalV3Path, "utf8"),
      '{"historicalV3":true}\n',
    );
    const exported = JSON.parse(readFileSync(tokenlessPath, "utf8"));
    assert.equal(exported.schemaVersion, TOKENLESS_DEPLOYMENT_SCHEMA);
    assert.equal(exported.chainId, 84532);
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
