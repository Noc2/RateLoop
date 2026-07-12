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
import { buildTokenlessGeneratedSources } from "./generateTokenlessArtifacts.js";
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
      1
    ),
    createTransaction(
      "CredentialIssuer",
      credentialIssuer,
      [address(10), address(11), "86400"],
      2
    ),
    createTransaction("TokenlessPanel", panel, [testUsdc, credentialIssuer], 3),
  ];
  if (includeAdapter) {
    entries.push(
      createTransaction("X402PanelSubmitter", address(4), [panel], 4)
    );
  }
  return {
    transactions: entries.map((entry) => entry.transaction),
    receipts: entries.map((entry) => entry.receipt),
  };
}

test("reconstructs an isolated versioned tokenless Base Sepolia artifact", () => {
  const artifact = reconstructTokenlessDeploymentFromBroadcast(
    completeBroadcast()
  );

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
    /^tokenless-v1:84532:0x[0-9a-f]{40}:0x[0-9a-f]{40}:0x0{40}$/
  );
});

test("includes X402PanelSubmitter when the optional adapter is deployed", () => {
  const artifact = reconstructTokenlessDeploymentFromBroadcast(
    completeBroadcast({ includeAdapter: true })
  );
  assert.equal(artifact.contracts.X402PanelSubmitter.address, address(4));
  assert.ok(!artifact.deploymentKey.endsWith(`:${address(0)}`));
});

test("rejects missing required contracts and mixed legacy broadcasts", () => {
  const missingIssuer = completeBroadcast();
  missingIssuer.transactions = missingIssuer.transactions.filter(
    (transaction) => transaction.contractName !== "CredentialIssuer"
  );
  assert.throws(
    () => reconstructTokenlessDeploymentFromBroadcast(missingIssuer),
    /exactly one CredentialIssuer/
  );

  const mixed = completeBroadcast();
  const legacy = createTransaction("ContentRegistry", address(20), [], 20);
  mixed.transactions.push(legacy.transaction);
  mixed.receipts.push(legacy.receipt);
  assert.throws(
    () => reconstructTokenlessDeploymentFromBroadcast(mixed),
    /mixed legacy\/tokenless deployment broadcast/
  );
});

test("rejects TokenlessPanel constructor wiring that disagrees with exports", () => {
  const broadcast = completeBroadcast();
  const panel = broadcast.transactions.find(
    (transaction) => transaction.contractName === "TokenlessPanel"
  );
  panel.arguments[0] = address(99);
  assert.throws(
    () => reconstructTokenlessDeploymentFromBroadcast(broadcast),
    /constructor wiring must match/
  );
});

test("validates deployment keys against contract addresses", () => {
  const artifact = reconstructTokenlessDeploymentFromBroadcast(
    completeBroadcast()
  );
  assert.throws(
    () =>
      validateTokenlessDeploymentArtifact({
        ...artifact,
        deploymentKey: "tokenless-v1:wrong",
      }),
    /deployment key does not match/
  );
});

test("export writes tokenless-v1 separately and leaves legacy 8453 untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "rateloop-tokenless-export-"));
  try {
    const legacyPath = join(root, "deployments", "8453.json");
    const broadcastPath = join(root, "run-latest.json");
    const tokenlessPath = join(
      root,
      "deployments",
      "tokenless-v1",
      "84532.json"
    );
    mkdirSync(join(root, "deployments"), { recursive: true });
    writeFileSync(legacyPath, '{"networkName":"base","legacy":true}\n');
    writeFileSync(broadcastPath, JSON.stringify(completeBroadcast()));

    exportTokenlessDeploymentFromBroadcast({
      broadcastPath,
      deploymentPath: tokenlessPath,
      targetNetwork: "baseSepolia",
    });

    assert.equal(
      readFileSync(legacyPath, "utf8"),
      '{"networkName":"base","legacy":true}\n'
    );
    const exported = JSON.parse(readFileSync(tokenlessPath, "utf8"));
    assert.equal(exported.schemaVersion, TOKENLESS_DEPLOYMENT_SCHEMA);
    assert.equal(exported.chainId, 84532);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generated sources expose required ABIs and omit the absent adapter", () => {
  const artifact = reconstructTokenlessDeploymentFromBroadcast(
    completeBroadcast()
  );
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
    /rateloop-tokenless-deployment-v1/
  );
  assert.doesNotMatch(sources.get("index.ts"), /X402PanelSubmitterAbi/);
});
