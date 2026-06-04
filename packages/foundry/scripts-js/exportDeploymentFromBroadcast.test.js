import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, parseAbi } from "viem";

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

const protocolConfigAbi = parseAbi([
  "function setClusterPayoutOracle(address value)",
  "function setAdvisoryVoteRecorder(address value)",
  "function setLaunchDistributionPool(address value)",
  "function renounceRole(bytes32 role,address account)",
]);

function address(index) {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

const fixtureDeployer = address(101);

function txHash(index) {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function deploymentAt(deploymentExport, targetAddress) {
  const match = Object.entries(deploymentExport).find(
    ([candidate]) => candidate.toLowerCase() === targetAddress.toLowerCase()
  );
  return match?.[1];
}

function nextTxHash(transactions) {
  return txHash(transactions.length + 1);
}

function successfulReceipt(transactionHash, blockNumber = "0xc8", logs = []) {
  return { transactionHash, blockNumber, logs, status: "0x1" };
}

function pushCall(
  transactions,
  receipts,
  contractName,
  functionName,
  args,
  targetAddress
) {
  const hash = nextTxHash(transactions);
  transactions.push({
    transactionType: "CALL",
    contractName,
    contractAddress: targetAddress,
    function: functionName,
    arguments: args,
    input: "0x12345678",
    transaction: { from: fixtureDeployer, to: targetAddress },
    hash,
  });
  receipts.push(successfulReceipt(hash));
}

function pushProtocolConfigProxyCall(
  transactions,
  receipts,
  protocolConfigProxy,
  functionName,
  args
) {
  const hash = nextTxHash(transactions);
  transactions.push({
    transactionType: "CALL",
    contractName: "TransparentUpgradeableProxy",
    contractAddress: protocolConfigProxy,
    function: null,
    arguments: null,
    input: encodeFunctionData({ abi: protocolConfigAbi, functionName, args }),
    transaction: { from: fixtureDeployer, to: protocolConfigProxy },
    hash,
  });
  receipts.push(successfulReceipt(hash));
}

function removeRequiredCall(transactions, receipts, predicate) {
  const index = transactions.findIndex(predicate);
  assert.notEqual(index, -1, "test fixture should contain required call");
  transactions.splice(index, 1);
  receipts.splice(index, 1);
}

function findRequiredCall(transactions, predicate) {
  const tx = transactions.find(predicate);
  assert.ok(tx, "test fixture should contain required call");
  return tx;
}

function assertRejectsTamperedCompletion(mutator, expectedLabel) {
  const { transactions, receipts } = completeBroadcast();
  mutator(transactions);

  assert.throws(
    () =>
      reconstructDeploymentExportFromBroadcast(
        { transactions, receipts },
        "worldchainSepolia"
      ),
    expectedLabel
  );
}

function completeBroadcast() {
  const transactions = [];
  const receipts = [];
  let nextAddress = 1;
  const directAddressByName = new Map();
  const proxyAddressByName = new Map();
  const deployer = fixtureDeployer;

  for (const contractName of directNames) {
    const contractAddress = address(nextAddress++);
    const hash = nextTxHash(transactions);
    directAddressByName.set(contractName, contractAddress);
    transactions.push({
      transactionType: "CREATE",
      contractName,
      contractAddress,
      transaction: { from: deployer },
      hash,
    });
    receipts.push(successfulReceipt(hash, "0x64"));
  }

  for (const contractName of proxyNames) {
    const proxyAddress = address(nextAddress++);
    const adminAddress = address(nextAddress++);
    const hash = nextTxHash(transactions);
    proxyAddressByName.set(contractName, proxyAddress);
    transactions.push({
      transactionType: "CREATE",
      contractName: "TransparentUpgradeableProxy",
      contractAddress: proxyAddress,
      transaction: { from: deployer },
      hash,
    });
    receipts.push(
      successfulReceipt(hash, "0xc8", [
        { address: proxyAddress },
        { address: adminAddress },
      ])
    );
  }

  const defaultAdminRole =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const adminRole =
    "0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775";
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
  const pauserRole =
    "0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a";
  const seederRole =
    "0x240afcd1926e36e0297a1eb63ba484f52ddbef788e7f4e9b38b0dcc66de129e1";
  const governance = directAddressByName.get("TimelockController");
  const governor = directAddressByName.get("RateLoopGovernor");
  const clusterOracle = directAddressByName.get("ClusterPayoutOracle");
  const launchPool = directAddressByName.get("LaunchDistributionPool");
  const categoryRegistry = directAddressByName.get("CategoryRegistry");
  const frontendRegistry = proxyAddressByName.get("FrontendRegistry");
  const profileRegistry = proxyAddressByName.get("ProfileRegistry");
  const contentRegistry = proxyAddressByName.get("ContentRegistry");
  const votingEngine = proxyAddressByName.get("RoundVotingEngine");
  const questionEscrow = proxyAddressByName.get("QuestionRewardPoolEscrow");
  const rewardDistributor = proxyAddressByName.get("RoundRewardDistributor");
  const raterRegistry = proxyAddressByName.get("RaterRegistry");
  const feedbackRegistry = proxyAddressByName.get("FeedbackRegistry");
  const advisoryRecorder = directAddressByName.get("AdvisoryVoteRecorder");
  const protocolConfig = proxyAddressByName.get("ProtocolConfig");

  pushCall(
    transactions,
    receipts,
    "RaterRegistry",
    "renounceRole(bytes32,address)",
    [adminRole, deployer],
    raterRegistry
  );
  pushCall(
    transactions,
    receipts,
    "RaterRegistry",
    "renounceRole(bytes32,address)",
    [seederRole, deployer],
    raterRegistry
  );
  pushCall(
    transactions,
    receipts,
    "FeedbackRegistry",
    "renounceRole(bytes32,address)",
    [configRole, deployer],
    feedbackRegistry
  );
  pushCall(
    transactions,
    receipts,
    "ContentRegistry",
    "renounceRole(bytes32,address)",
    [configRole, deployer],
    contentRegistry
  );
  pushCall(
    transactions,
    receipts,
    "ContentRegistry",
    "renounceRole(bytes32,address)",
    [pauserRole, deployer],
    contentRegistry
  );
  pushCall(
    transactions,
    receipts,
    "ProfileRegistry",
    "renounceRole(bytes32,address)",
    [adminRole, deployer],
    profileRegistry
  );
  pushCall(
    transactions,
    receipts,
    "FrontendRegistry",
    "renounceRole(bytes32,address)",
    [adminRole, deployer],
    frontendRegistry
  );
  pushCall(
    transactions,
    receipts,
    "CategoryRegistry",
    "renounceRole(bytes32,address)",
    [adminRole, deployer],
    categoryRegistry
  );
  pushCall(
    transactions,
    receipts,
    "ClusterPayoutOracle",
    "setRoundPayoutSnapshotConsumer(uint8,address)",
    ["1", questionEscrow],
    clusterOracle
  );
  pushCall(
    transactions,
    receipts,
    "ClusterPayoutOracle",
    "setRoundPayoutSnapshotConsumer(uint8,address)",
    ["2", launchPool],
    clusterOracle
  );
  pushCall(
    transactions,
    receipts,
    "ClusterPayoutOracle",
    "grantRole(bytes32,address)",
    [defaultAdminRole, governance],
    clusterOracle
  );
  pushCall(
    transactions,
    receipts,
    "ClusterPayoutOracle",
    "grantRole(bytes32,address)",
    [configRole, governance],
    clusterOracle
  );
  pushCall(
    transactions,
    receipts,
    "ClusterPayoutOracle",
    "grantRole(bytes32,address)",
    [arbiterRole, governance],
    clusterOracle
  );
  pushCall(
    transactions,
    receipts,
    "ClusterPayoutOracle",
    "setOracleConfig(uint64,uint256,address)",
    ["43200", "5000000", governance],
    clusterOracle
  );
  pushCall(
    transactions,
    receipts,
    "ClusterPayoutOracle",
    "renounceRole(bytes32,address)",
    [arbiterRole, deployer],
    clusterOracle
  );
  pushCall(
    transactions,
    receipts,
    "ClusterPayoutOracle",
    "renounceRole(bytes32,address)",
    [configRole, deployer],
    clusterOracle
  );
  pushCall(
    transactions,
    receipts,
    "ClusterPayoutOracle",
    "renounceRole(bytes32,address)",
    [defaultAdminRole, deployer],
    clusterOracle
  );
  pushProtocolConfigProxyCall(
    transactions,
    receipts,
    protocolConfig,
    "setClusterPayoutOracle",
    [clusterOracle]
  );
  pushCall(
    transactions,
    receipts,
    "LaunchDistributionPool",
    "setRoundClusterReadyAtSource(address)",
    [votingEngine],
    launchPool
  );
  pushCall(
    transactions,
    receipts,
    "LaunchDistributionPool",
    "setClusterPayoutOracle(address)",
    [clusterOracle],
    launchPool
  );
  pushCall(
    transactions,
    receipts,
    "LaunchDistributionPool",
    "setAuthorizedCaller(address,bool)",
    [rewardDistributor, "true"],
    launchPool
  );
  pushProtocolConfigProxyCall(
    transactions,
    receipts,
    protocolConfig,
    "setAdvisoryVoteRecorder",
    [advisoryRecorder]
  );
  pushCall(
    transactions,
    receipts,
    "LaunchDistributionPool",
    "setAuthorizedCaller(address,bool)",
    [advisoryRecorder, "true"],
    launchPool
  );
  pushCall(
    transactions,
    receipts,
    "TimelockController",
    "grantRole(bytes32,address)",
    [proposerRole, governor],
    directAddressByName.get("TimelockController")
  );
  pushCall(
    transactions,
    receipts,
    "TimelockController",
    "grantRole(bytes32,address)",
    [cancellerRole, governor],
    directAddressByName.get("TimelockController")
  );
  pushCall(
    transactions,
    receipts,
    "TimelockController",
    "renounceRole(bytes32,address)",
    [defaultAdminRole, deployer],
    directAddressByName.get("TimelockController")
  );
  pushCall(
    transactions,
    receipts,
    "LoopReputation",
    "setGovernor(address)",
    [governor],
    directAddressByName.get("LoopReputation")
  );
  pushCall(
    transactions,
    receipts,
    "LoopReputation",
    "renounceRole(bytes32,address)",
    [configRole, deployer],
    directAddressByName.get("LoopReputation")
  );
  pushCall(
    transactions,
    receipts,
    "LaunchDistributionPool",
    "accountPrefundedPoolDeposit(uint256)",
    ["75000000000000"],
    launchPool
  );
  pushCall(
    transactions,
    receipts,
    "LaunchDistributionPool",
    "setLegacyContributorRoot(bytes32,uint256)",
    [`0x${"a".repeat(64)}`, "9000000000000"],
    launchPool
  );
  pushCall(
    transactions,
    receipts,
    "LaunchDistributionPool",
    "transferOwnership(address)",
    [governance],
    launchPool
  );
  pushCall(
    transactions,
    receipts,
    "LoopReputation",
    "renounceRole(bytes32,address)",
    [minterRole, deployer],
    directAddressByName.get("LoopReputation")
  );
  pushProtocolConfigProxyCall(
    transactions,
    receipts,
    protocolConfig,
    "setLaunchDistributionPool",
    [launchPool]
  );
  pushProtocolConfigProxyCall(
    transactions,
    receipts,
    protocolConfig,
    "renounceRole",
    [configRole, deployer]
  );

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
  removeRequiredCall(
    transactions,
    receipts,
    (tx) =>
      tx.contractName === "LoopReputation" &&
      tx.function === "renounceRole(bytes32,address)" &&
      tx.arguments?.[0] ===
        "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6"
  );

  assert.throws(
    () =>
      reconstructDeploymentExportFromBroadcast(
        { transactions, receipts },
        "worldchainSepolia"
      ),
    /Broadcast is missing required completion calls: LoopReputation\.renounceRole\(MINTER_ROLE\)/
  );
});

test("reconstructDeploymentExportFromBroadcast rejects missing deployer handoffs", () => {
  const cases = [
    {
      label: /RaterRegistry\.renounceRole\(ADMIN_ROLE\)/,
      predicate: (tx) =>
        tx.contractName === "RaterRegistry" &&
        tx.function === "renounceRole(bytes32,address)" &&
        tx.arguments?.[0] ===
          "0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775",
    },
    {
      label: /RaterRegistry\.renounceRole\(SEEDER_ROLE\)/,
      predicate: (tx) =>
        tx.contractName === "RaterRegistry" &&
        tx.function === "renounceRole(bytes32,address)" &&
        tx.arguments?.[0] ===
          "0x240afcd1926e36e0297a1eb63ba484f52ddbef788e7f4e9b38b0dcc66de129e1",
    },
    {
      label: /ContentRegistry\.renounceRole\(PAUSER_ROLE\)/,
      predicate: (tx) =>
        tx.contractName === "ContentRegistry" &&
        tx.function === "renounceRole(bytes32,address)" &&
        tx.arguments?.[0] ===
          "0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a",
    },
    {
      label: /CategoryRegistry\.renounceRole\(ADMIN_ROLE\)/,
      predicate: (tx) =>
        tx.contractName === "CategoryRegistry" &&
        tx.function === "renounceRole(bytes32,address)",
    },
  ];

  for (const { label, predicate } of cases) {
    const { transactions, receipts } = completeBroadcast();
    removeRequiredCall(transactions, receipts, predicate);

    assert.throws(
      () =>
        reconstructDeploymentExportFromBroadcast(
          { transactions, receipts },
          "worldchainSepolia"
        ),
      label
    );
  }
});

test("reconstructDeploymentExportFromBroadcast rejects missing protocol oracle config", () => {
  const { transactions, receipts } = completeBroadcast();
  removeRequiredCall(transactions, receipts, (tx) =>
    tx.input?.startsWith("0x440616e4")
  );

  assert.throws(
    () =>
      reconstructDeploymentExportFromBroadcast(
        { transactions, receipts },
        "worldchainSepolia"
      ),
    /ProtocolConfig\.setClusterPayoutOracle/
  );
});

test("reconstructDeploymentExportFromBroadcast rejects tampered completion arguments and targets", () => {
  const adminRole =
    "0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775";
  const defaultAdminRole =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

  const cases = [
    {
      label: /RaterRegistry\.renounceRole\(ADMIN_ROLE\)/,
      mutate: (transactions) => {
        const tx = findRequiredCall(
          transactions,
          (candidate) =>
            candidate.contractName === "RaterRegistry" &&
            candidate.function === "renounceRole(bytes32,address)" &&
            candidate.arguments?.[0] === adminRole
        );
        tx.arguments[1] = address(202);
      },
    },
    {
      label: /ClusterPayoutOracle\.grantRole\(DEFAULT_ADMIN_ROLE\)/,
      mutate: (transactions) => {
        const tx = findRequiredCall(
          transactions,
          (candidate) =>
            candidate.contractName === "ClusterPayoutOracle" &&
            candidate.function === "grantRole(bytes32,address)" &&
            candidate.arguments?.[0] === defaultAdminRole
        );
        tx.arguments[1] = address(203);
      },
    },
    {
      label: /LaunchDistributionPool\.setClusterPayoutOracle/,
      mutate: (transactions) => {
        const tx = findRequiredCall(
          transactions,
          (candidate) =>
            candidate.contractName === "LaunchDistributionPool" &&
            candidate.function === "setClusterPayoutOracle(address)"
        );
        tx.contractAddress = address(204);
      },
    },
    {
      label:
        /ClusterPayoutOracle\.setRoundPayoutSnapshotConsumer\(QUESTION_REWARD\)/,
      mutate: (transactions) => {
        const tx = findRequiredCall(
          transactions,
          (candidate) =>
            candidate.contractName === "ClusterPayoutOracle" &&
            candidate.function ===
              "setRoundPayoutSnapshotConsumer(uint8,address)" &&
            candidate.arguments?.[0] === "1"
        );
        tx.arguments[1] = address(205);
      },
    },
    {
      label:
        /LaunchDistributionPool\.setAuthorizedCaller\(RoundRewardDistributor\)/,
      mutate: (transactions) => {
        const tx = findRequiredCall(
          transactions,
          (candidate) =>
            candidate.contractName === "LaunchDistributionPool" &&
            candidate.function === "setAuthorizedCaller(address,bool)" &&
            candidate.arguments?.[1] === "true"
        );
        tx.arguments[1] = "false";
      },
    },
    {
      label: /ProtocolConfig\.setClusterPayoutOracle/,
      mutate: (transactions) => {
        const tx = findRequiredCall(transactions, (candidate) =>
          candidate.input?.startsWith("0x440616e4")
        );
        tx.input = encodeFunctionData({
          abi: protocolConfigAbi,
          functionName: "setClusterPayoutOracle",
          args: [address(206)],
        });
      },
    },
    {
      label: /LaunchDistributionPool\.transferOwnership/,
      mutate: (transactions) => {
        const tx = findRequiredCall(
          transactions,
          (candidate) =>
            candidate.contractName === "LaunchDistributionPool" &&
            candidate.function === "transferOwnership(address)"
        );
        tx.arguments[0] = address(207);
      },
    },
    {
      label: /LoopReputation\.setGovernor/,
      mutate: (transactions) => {
        const tx = findRequiredCall(
          transactions,
          (candidate) =>
            candidate.contractName === "LoopReputation" &&
            candidate.function === "setGovernor(address)"
        );
        tx.arguments[0] = address(208);
      },
    },
  ];

  for (const { mutate, label } of cases) {
    assertRejectsTamperedCompletion(mutate, label);
  }
});

test("reconstructDeploymentExportFromBroadcast rejects missing receipts", () => {
  const { transactions, receipts } = completeBroadcast();
  const minterRenounceIndex = transactions.findIndex(
    (tx) =>
      tx.contractName === "LoopReputation" &&
      tx.function === "renounceRole(bytes32,address)" &&
      tx.arguments?.[0] ===
        "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6"
  );
  assert.notEqual(
    minterRenounceIndex,
    -1,
    "test fixture should contain required call"
  );
  receipts.splice(minterRenounceIndex, 1);

  assert.throws(
    () =>
      reconstructDeploymentExportFromBroadcast(
        { transactions, receipts },
        "worldchainSepolia"
      ),
    /Missing receipt for transaction/
  );
});

test("reconstructDeploymentExportFromBroadcast rejects failed receipts", () => {
  const { transactions, receipts } = completeBroadcast();
  const minterRenounceIndex = transactions.findIndex(
    (tx) =>
      tx.contractName === "LoopReputation" &&
      tx.function === "renounceRole(bytes32,address)" &&
      tx.arguments?.[0] ===
        "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6"
  );
  assert.notEqual(
    minterRenounceIndex,
    -1,
    "test fixture should contain required call"
  );
  receipts[minterRenounceIndex] = {
    ...receipts[minterRenounceIndex],
    status: "0x0",
  };

  assert.throws(
    () =>
      reconstructDeploymentExportFromBroadcast(
        { transactions, receipts },
        "worldchainSepolia"
      ),
    /failed/
  );
});

test("reconstructDeploymentExportFromBroadcast rejects partial proxy runs", () => {
  const hash = txHash(1);
  assert.throws(
    () =>
      reconstructDeploymentExportFromBroadcast(
        {
          transactions: [
            {
              transactionType: "CREATE",
              contractName: "TransparentUpgradeableProxy",
              contractAddress: address(1),
              hash,
            },
          ],
          receipts: [
            {
              transactionHash: hash,
              blockNumber: "0x1",
              logs: [{ address: address(1) }, { address: address(2) }],
              status: "0x1",
            },
          ],
        },
        "worldchainSepolia"
      ),
    /Expected 10 proxy deployments, found 1/
  );
});
