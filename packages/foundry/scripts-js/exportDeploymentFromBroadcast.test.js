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

function successfulReceipt(blockNumber = "0xc8", logs = []) {
  return { blockNumber, logs, status: "0x1" };
}

function pushCall(transactions, receipts, contractName, functionName, args, targetAddress) {
  transactions.push({
    transactionType: "CALL",
    contractName,
    contractAddress: targetAddress,
    function: functionName,
    arguments: args,
    input: "0x12345678",
  });
  receipts.push(successfulReceipt());
}

function pushProtocolConfigProxyCall(transactions, receipts, protocolConfigProxy, selector) {
  transactions.push({
    transactionType: "CALL",
    contractName: "TransparentUpgradeableProxy",
    contractAddress: protocolConfigProxy,
    function: null,
    arguments: null,
    input: `${selector}${"0".repeat(64)}`,
  });
  receipts.push(successfulReceipt());
}

function completeBroadcast() {
  const transactions = [];
  const receipts = [];
  let nextAddress = 1;
  const directAddressByName = new Map();
  const proxyAddressByName = new Map();

  for (const contractName of directNames) {
    const contractAddress = address(nextAddress++);
    directAddressByName.set(contractName, contractAddress);
    transactions.push({
      transactionType: "CREATE",
      contractName,
      contractAddress,
    });
    receipts.push({ blockNumber: "0x64", logs: [] });
  }

  for (const contractName of proxyNames) {
    const proxyAddress = address(nextAddress++);
    const adminAddress = address(nextAddress++);
    proxyAddressByName.set(contractName, proxyAddress);
    transactions.push({
      transactionType: "CREATE",
      contractName: "TransparentUpgradeableProxy",
      contractAddress: proxyAddress,
    });
    receipts.push(successfulReceipt("0xc8", [{ address: proxyAddress }, { address: adminAddress }]));
  }

  const defaultAdminRole =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const configRole =
    "0x82db594318110a04b6349ce48645aa69f0892751bc893d15e61d9e2b9c4630f5";
  const arbiterRole =
    "0xbb08418a67729a078f87bbc8d02a770929bb68f5bfdf134ae2ead6ed38e2f4ae";
  const minterRole =
    "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";
  const proposerRole =
    "0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1";
  const cancellerRole =
    "0xfd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783";
  const deployer = address(101);
  const governance = address(102);
  const governor = directAddressByName.get("RateLoopGovernor");
  const clusterOracle = directAddressByName.get("ClusterPayoutOracle");
  const launchPool = directAddressByName.get("LaunchDistributionPool");
  const votingEngine = proxyAddressByName.get("RoundVotingEngine");
  const questionEscrow = proxyAddressByName.get("QuestionRewardPoolEscrow");
  const rewardDistributor = proxyAddressByName.get("RoundRewardDistributor");
  const advisoryRecorder = directAddressByName.get("AdvisoryVoteRecorder");
  const protocolConfig = proxyAddressByName.get("ProtocolConfig");

  pushCall(transactions, receipts, "ClusterPayoutOracle", "setRoundPayoutSnapshotConsumer(uint8,address)", ["1", questionEscrow], clusterOracle);
  pushCall(transactions, receipts, "ClusterPayoutOracle", "setRoundPayoutSnapshotConsumer(uint8,address)", ["2", launchPool], clusterOracle);
  pushCall(transactions, receipts, "ClusterPayoutOracle", "grantRole(bytes32,address)", [defaultAdminRole, governance], clusterOracle);
  pushCall(transactions, receipts, "ClusterPayoutOracle", "grantRole(bytes32,address)", [configRole, governance], clusterOracle);
  pushCall(transactions, receipts, "ClusterPayoutOracle", "grantRole(bytes32,address)", [arbiterRole, governance], clusterOracle);
  pushCall(transactions, receipts, "ClusterPayoutOracle", "setOracleConfig(uint64,uint256,address)", ["43200", "5000000", governance], clusterOracle);
  pushCall(transactions, receipts, "ClusterPayoutOracle", "renounceRole(bytes32,address)", [arbiterRole, deployer], clusterOracle);
  pushCall(transactions, receipts, "ClusterPayoutOracle", "renounceRole(bytes32,address)", [configRole, deployer], clusterOracle);
  pushCall(transactions, receipts, "ClusterPayoutOracle", "renounceRole(bytes32,address)", [defaultAdminRole, deployer], clusterOracle);
  pushProtocolConfigProxyCall(transactions, receipts, protocolConfig, "0x440616e4");
  pushCall(transactions, receipts, "LaunchDistributionPool", "setClusterPayoutOracle(address)", [clusterOracle], launchPool);
  pushCall(transactions, receipts, "LaunchDistributionPool", "setRoundClusterReadyAtSource(address)", [votingEngine], launchPool);
  pushCall(transactions, receipts, "LaunchDistributionPool", "setAuthorizedCaller(address,bool)", [rewardDistributor, "true"], launchPool);
  pushProtocolConfigProxyCall(transactions, receipts, protocolConfig, "0x8b099e2f");
  pushCall(transactions, receipts, "LaunchDistributionPool", "setAuthorizedCaller(address,bool)", [advisoryRecorder, "true"], launchPool);
  pushCall(transactions, receipts, "TimelockController", "grantRole(bytes32,address)", [proposerRole, governor], directAddressByName.get("TimelockController"));
  pushCall(transactions, receipts, "TimelockController", "grantRole(bytes32,address)", [cancellerRole, governor], directAddressByName.get("TimelockController"));
  pushCall(transactions, receipts, "TimelockController", "renounceRole(bytes32,address)", [defaultAdminRole, deployer], directAddressByName.get("TimelockController"));
  pushCall(transactions, receipts, "LoopReputation", "setGovernor(address)", [governor], directAddressByName.get("LoopReputation"));
  pushCall(transactions, receipts, "LoopReputation", "renounceRole(bytes32,address)", [configRole, deployer], directAddressByName.get("LoopReputation"));
  pushCall(transactions, receipts, "LaunchDistributionPool", "accountPrefundedPoolDeposit(uint256)", ["75000000000000"], launchPool);
  pushCall(transactions, receipts, "LaunchDistributionPool", "setLegacyContributorRoot(bytes32,uint256)", [`0x${"a".repeat(64)}`, "9000000000000"], launchPool);
  pushCall(transactions, receipts, "LaunchDistributionPool", "transferOwnership(address)", [governance], launchPool);
  pushCall(transactions, receipts, "LoopReputation", "renounceRole(bytes32,address)", [minterRole, deployer], directAddressByName.get("LoopReputation"));
  pushProtocolConfigProxyCall(transactions, receipts, protocolConfig, "0xa0ad8aa9");
  pushProtocolConfigProxyCall(transactions, receipts, protocolConfig, "0x36568abe");

  return { transactions, receipts };
}

test("reconstructDeploymentExportFromBroadcast maps proxies and proxy admins", () => {
  const { transactions, receipts } = completeBroadcast();

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

test("reconstructDeploymentExportFromBroadcast rejects missing completion calls", () => {
  const { transactions, receipts } = completeBroadcast();
  const minterRenounceIndex = transactions.findIndex(
    (tx) =>
      tx.contractName === "LoopReputation" &&
      tx.function === "renounceRole(bytes32,address)" &&
      tx.arguments?.[0] === "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6"
  );
  transactions.splice(minterRenounceIndex, 1);
  receipts.splice(minterRenounceIndex, 1);

  assert.throws(
    () =>
      reconstructDeploymentExportFromBroadcast(
        { transactions, receipts },
        "worldchainSepolia"
      ),
    /Broadcast is missing required completion calls: LoopReputation\.renounceRole\(MINTER_ROLE\)/
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
