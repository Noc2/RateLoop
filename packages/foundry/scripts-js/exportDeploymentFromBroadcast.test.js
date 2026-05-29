import assert from "node:assert/strict";
import { test } from "node:test";

import { reconstructDeploymentExportFromBroadcast } from "./exportDeploymentFromBroadcast.js";

const directNames = [
  "TimelockController",
  "LoopReputation",
  "RateLoopGovernor",
  "X402QuestionSubmitter",
  "CategoryRegistry",
  "ClusterPayoutOracle",
  "LaunchDistributionPool",
  "AdvisoryVoteRecorder",
];

const proxyNames = [
  "FrontendRegistry",
  "ProfileRegistry",
  "ContentRegistry",
  "ProtocolConfig",
  "RoundVotingEngine",
  "RoundRewardDistributor",
  "RaterRegistry",
  "QuestionRewardPoolEscrow",
  "FeedbackRegistry",
  "FeedbackBonusEscrow",
];

function address(index) {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

function deploymentAt(deploymentExport, targetAddress) {
  const match = Object.entries(deploymentExport).find(
    ([candidate]) => candidate.toLowerCase() === targetAddress.toLowerCase()
  );
  return match?.[1];
}

test("reconstructDeploymentExportFromBroadcast maps proxies and proxy admins", () => {
  const transactions = [];
  const receipts = [];
  let nextAddress = 1;

  for (const contractName of directNames) {
    transactions.push({
      transactionType: "CREATE",
      contractName,
      contractAddress: address(nextAddress++),
    });
    receipts.push({ blockNumber: "0x64", logs: [] });
  }

  for (const contractName of proxyNames) {
    const proxyAddress = address(nextAddress++);
    const adminAddress = address(nextAddress++);
    transactions.push({
      transactionType: "CREATE",
      contractName: "TransparentUpgradeableProxy",
      contractAddress: proxyAddress,
    });
    receipts.push({
      blockNumber: "0xc8",
      logs: [{ address: proxyAddress }, { address: adminAddress }],
    });
  }

  const deploymentExport = reconstructDeploymentExportFromBroadcast(
    { transactions, receipts },
    "worldchainSepolia"
  );

  assert.equal(deploymentExport.deploymentBlockNumber, 200);
  assert.equal(deploymentExport.deploymentComplete, "true");
  assert.equal(deploymentExport.networkName, "worldchainSepolia");
  assert.equal(deploymentAt(deploymentExport, address(9)), "FrontendRegistry");
  assert.equal(
    deploymentAt(deploymentExport, address(10)),
    "FrontendRegistryProxyAdmin"
  );
  assert.equal(
    deploymentAt(deploymentExport, address(27)),
    "FeedbackBonusEscrow"
  );
  assert.equal(
    deploymentAt(deploymentExport, address(28)),
    "FeedbackBonusEscrowProxyAdmin"
  );
});

test("reconstructDeploymentExportFromBroadcast rejects partial proxy runs", () => {
  assert.throws(
    () =>
      reconstructDeploymentExportFromBroadcast(
        {
          transactions: [
            {
              transactionType: "CREATE",
              contractName: "TransparentUpgradeableProxy",
              contractAddress: address(1),
            },
          ],
          receipts: [
            {
              blockNumber: "0x1",
              logs: [{ address: address(1) }, { address: address(2) }],
            },
          ],
        },
        "worldchainSepolia"
      ),
    /Expected 10 proxy deployments, found 1/
  );
});
