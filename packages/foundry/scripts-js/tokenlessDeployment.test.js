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
  ];
  if (includeAdapter) {
    entries.push(
      createTransaction("X402PanelSubmitter", address(4), [testUsdc, panel], 4),
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
  assert.equal(artifact.contracts.X402PanelSubmitter, undefined);
  assert.match(
    artifact.deploymentKey,
    /^tokenless-v3:84532:0x[0-9a-f]{40}:0x[0-9a-f]{40}:0x0{40}$/,
  );
});

test("includes X402PanelSubmitter when the optional adapter is deployed", () => {
  const artifact = reconstructTokenlessDeploymentFromBroadcast(
    completeBroadcast({ includeAdapter: true }),
  );
  assert.equal(artifact.contracts.X402PanelSubmitter.address, address(4));
  assert.ok(!artifact.deploymentKey.endsWith(`:${address(0)}`));
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

test("rejects a CREATE whose transaction address disagrees with its matched receipt", () => {
  const broadcast = completeBroadcast();
  broadcast.receipts[0].contractAddress = address(99);

  assert.throws(
    () => reconstructTokenlessDeploymentFromBroadcast(broadcast),
    /transaction address does not match its receipt/,
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

test("export writes tokenless-v3 separately and leaves unrelated artifacts untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "rateloop-tokenless-export-"));
  try {
    const unrelatedPath = join(root, "deployments", "unrelated.json");
    const broadcastPath = join(root, "run-latest.json");
    const tokenlessPath = join(
      root,
      "deployments",
      "tokenless-v3",
      "84532.json",
    );
    mkdirSync(join(root, "deployments"), { recursive: true });
    writeFileSync(unrelatedPath, '{"unrelated":true}\n');
    writeFileSync(broadcastPath, JSON.stringify(completeBroadcast()));

    exportTokenlessDeploymentFromBroadcast({
      broadcastPath,
      deploymentPath: tokenlessPath,
      targetNetwork: "baseSepolia",
    });

    assert.equal(readFileSync(unrelatedPath, "utf8"), '{"unrelated":true}\n');
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
  assert.ok(sources.has("abis/TokenlessTestUSDCAbi.ts"));
  assert.equal(sources.has("abis/X402PanelSubmitterAbi.ts"), false);
  assert.match(
    sources.get("deployedContracts.ts"),
    /rateloop-tokenless-deployment-v3/,
  );
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
    "abis/TokenlessPanelAbi.ts",
    "abis/X402PanelSubmitterAbi.ts",
  ]);
  assert.equal(sources.has("deployedContracts.ts"), false);
  assert.equal(sources.has("index.ts"), false);
  for (const source of sources.values()) {
    assert.match(source, /rateloop-tokenless-deployment-v3/);
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
    "tokenless-v3:",
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
