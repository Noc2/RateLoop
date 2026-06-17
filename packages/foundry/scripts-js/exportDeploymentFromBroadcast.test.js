import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, parseAbi } from "viem";

import {
  reconstructDeploymentExportFromBroadcast,
  resolveDeploymentProfile,
} from "./exportDeploymentFromBroadcast.js";

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
  "ConfidentialityEscrow",
  "FeedbackRegistry",
  "FeedbackBonusEscrow",
];

const protocolConfigAbi = parseAbi([
  "function setConfig(uint256 epochDuration,uint256 maxDuration,uint256 minVoters,uint256 maxVoters)",
  "function setClusterPayoutOracle(address value)",
  "function setAdvisoryVoteRecorder(address value)",
  "function setLaunchDistributionPool(address value)",
  "function setRewardDistributor(address value)",
  "function setFrontendRegistry(address value)",
  "function setCategoryRegistry(address value)",
  "function setRaterRegistry(address value)",
  "function setConfidentialityEscrow(address value)",
  "function renounceRole(bytes32 role,address account)",
]);

const contentRegistryAbi = parseAbi([
  "function pause()",
  "function unpause()",
  "function setVotingEngine(address value)",
  "function setQuestionRewardPoolEscrow(address value)",
  "function setProtocolConfig(address value)",
  "function setCategoryRegistry(address value)",
  "function grantRole(bytes32 role,address account)",
  "function renounceRole(bytes32 role,address account)",
]);

const profileRegistryAbi = parseAbi([
  "function setRaterRegistry(address value)",
]);

const frontendRegistryAbi = parseAbi([
  "function setVotingEngine(address value)",
  "function initializeFeeCreditor(address value)",
]);

const raterRegistryAbi = parseAbi([
  "function setConfidentialityEscrow(address value)",
  "function renounceRole(bytes32 role,address account)",
]);

const feedbackRegistryAbi = parseAbi([
  "function renounceRole(bytes32 role,address account)",
]);

const confidentialityEscrowAbi = parseAbi([
  "function renounceRole(bytes32 role,address account)",
]);

const loopReputationAbi = parseAbi([
  "function mint(address to,uint256 amount)",
  "function setGovernor(address governor)",
  "function renounceRole(bytes32 role,address account)",
]);

function address(index) {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

const fixtureDeployer = address(101);
const treasuryMintAmount = "25000000000000";

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

function pushProxyCall(
  transactions,
  receipts,
  proxyAddress,
  abi,
  functionName,
  args
) {
  const hash = nextTxHash(transactions);
  transactions.push({
    transactionType: "CALL",
    contractName: "TransparentUpgradeableProxy",
    contractAddress: proxyAddress,
    function: null,
    arguments: null,
    input: encodeFunctionData({ abi, functionName, args }),
    transaction: { from: fixtureDeployer, to: proxyAddress },
    hash,
  });
  receipts.push(successfulReceipt(hash));
}

function removeRequiredCall(
  transactions,
  receipts,
  predicate,
  label = "required call"
) {
  const index = transactions.findIndex(predicate);
  assert.notEqual(index, -1, `test fixture should contain ${label}`);
  transactions.splice(index, 1);
  receipts.splice(index, 1);
}

function findRequiredCall(transactions, predicate) {
  const tx = transactions.find(predicate);
  assert.ok(tx, "test fixture should contain required call");
  return tx;
}

function encodeExistingCallWithAbi(tx, abi, functionName) {
  const args = tx.arguments || [];
  tx.function = null;
  tx.arguments = null;
  tx.input = encodeFunctionData({ abi, functionName, args });
}

function encodeExistingProxyCallWithAbi(tx, abi, functionName) {
  tx.contractName = "TransparentUpgradeableProxy";
  encodeExistingCallWithAbi(tx, abi, functionName);
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

function completeBroadcast({ treasuryMint = treasuryMintAmount } = {}) {
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

  for (const [proxyIndex, contractName] of proxyNames.entries()) {
    const proxyAddress = address(nextAddress++);
    const adminAddress = address(nextAddress++);
    const hash = nextTxHash(transactions);
    proxyAddressByName.set(contractName, proxyAddress);
    transactions.push({
      transactionType: "CREATE",
      contractName: "TransparentUpgradeableProxy",
      contractAddress: proxyAddress,
      arguments: [
        address(9000 + proxyIndex),
        directAddressByName.get("TimelockController"),
        "0x",
      ],
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
  const accessRecorderRole =
    "0xb82259307557a2e745f9b5e8967a4017845406824ddb2b55b3da0f9e27c2a8db";
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
  const confidentialityEscrow = proxyAddressByName.get("ConfidentialityEscrow");
  const feedbackRegistry = proxyAddressByName.get("FeedbackRegistry");
  const advisoryRecorder = directAddressByName.get("AdvisoryVoteRecorder");
  const protocolConfig = proxyAddressByName.get("ProtocolConfig");
  const x402QuestionSubmitter = directAddressByName.get(
    "X402QuestionSubmitter"
  );

  pushProxyCall(
    transactions,
    receipts,
    contentRegistry,
    contentRegistryAbi,
    "pause",
    []
  );
  pushProxyCall(
    transactions,
    receipts,
    contentRegistry,
    contentRegistryAbi,
    "setVotingEngine",
    [votingEngine]
  );
  pushProxyCall(
    transactions,
    receipts,
    contentRegistry,
    contentRegistryAbi,
    "setQuestionRewardPoolEscrow",
    [questionEscrow]
  );
  pushProxyCall(
    transactions,
    receipts,
    contentRegistry,
    contentRegistryAbi,
    "unpause",
    []
  );
  pushProxyCall(
    transactions,
    receipts,
    contentRegistry,
    contentRegistryAbi,
    "setProtocolConfig",
    [protocolConfig]
  );
  pushProxyCall(
    transactions,
    receipts,
    contentRegistry,
    contentRegistryAbi,
    "setCategoryRegistry",
    [categoryRegistry]
  );
  pushProxyCall(
    transactions,
    receipts,
    contentRegistry,
    contentRegistryAbi,
    "grantRole",
    [
      "0xf8fc5b762a56b84305af28ac287dfaf08d491f8de4965459339ae40cec115613",
      x402QuestionSubmitter,
    ]
  );
  pushProtocolConfigProxyCall(
    transactions,
    receipts,
    protocolConfig,
    "setRewardDistributor",
    [rewardDistributor]
  );
  pushProtocolConfigProxyCall(
    transactions,
    receipts,
    protocolConfig,
    "setFrontendRegistry",
    [frontendRegistry]
  );
  pushProtocolConfigProxyCall(
    transactions,
    receipts,
    protocolConfig,
    "setCategoryRegistry",
    [categoryRegistry]
  );
  pushProtocolConfigProxyCall(
    transactions,
    receipts,
    protocolConfig,
    "setRaterRegistry",
    [raterRegistry]
  );
  pushProxyCall(
    transactions,
    receipts,
    raterRegistry,
    raterRegistryAbi,
    "setConfidentialityEscrow",
    [confidentialityEscrow]
  );
  pushProtocolConfigProxyCall(
    transactions,
    receipts,
    protocolConfig,
    "setConfidentialityEscrow",
    [confidentialityEscrow]
  );
  pushProxyCall(
    transactions,
    receipts,
    profileRegistry,
    profileRegistryAbi,
    "setRaterRegistry",
    [raterRegistry]
  );
  pushProxyCall(
    transactions,
    receipts,
    frontendRegistry,
    frontendRegistryAbi,
    "setVotingEngine",
    [votingEngine]
  );
  pushProxyCall(
    transactions,
    receipts,
    frontendRegistry,
    frontendRegistryAbi,
    "initializeFeeCreditor",
    [rewardDistributor]
  );

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
  pushProxyCall(
    transactions,
    receipts,
    confidentialityEscrow,
    confidentialityEscrowAbi,
    "renounceRole",
    [pauserRole, deployer]
  );
  pushProxyCall(
    transactions,
    receipts,
    confidentialityEscrow,
    confidentialityEscrowAbi,
    "renounceRole",
    [configRole, deployer]
  );
  pushProxyCall(
    transactions,
    receipts,
    confidentialityEscrow,
    confidentialityEscrowAbi,
    "renounceRole",
    [accessRecorderRole, deployer]
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
    ["4", questionEscrow],
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
    "setRoundPayoutSnapshotConsumer(uint8,address)",
    ["3", contentRegistry],
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
    ["7200", "5000000", governance],
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
  pushProtocolConfigProxyCall(
    transactions,
    receipts,
    protocolConfig,
    "setConfig",
    ["1200", "1200", "3", "100"]
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
    "LoopReputation",
    "mint(address,uint256)",
    [governance, treasuryMint],
    directAddressByName.get("LoopReputation")
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
    "mint(address,uint256)",
    [launchPool, "75000000000000"],
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
    [
      "0xcaa28d15e6c6c1bb47d347a413cb808e40c38a7e43171ce9a131983a92b97d18",
      "9000000000000",
    ],
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
  assert.equal(deploymentExport.deploymentProfile, "default");
  assert.equal(deploymentExport.networkName, "worldchainSepolia");
  assert.equal(deploymentAt(deploymentExport, address(9)), "FrontendRegistry");
  assert.equal(
    deploymentAt(deploymentExport, address(10)),
    "FrontendRegistryProxyAdmin"
  );
  assert.equal(
    deploymentAt(deploymentExport, address(25)),
    "ConfidentialityEscrow"
  );
  assert.equal(
    deploymentAt(deploymentExport, address(26)),
    "ConfidentialityEscrowProxyAdmin"
  );
  assert.equal(
    deploymentAt(deploymentExport, address(29)),
    "FeedbackBonusEscrow"
  );
  assert.equal(
    deploymentAt(deploymentExport, address(30)),
    "FeedbackBonusEscrowProxyAdmin"
  );
});

test("reconstructDeploymentExportFromBroadcast accepts full treasury mint on base mainnet", () => {
  const { transactions, receipts } = completeBroadcast({
    treasuryMint: treasuryMintAmount,
  });

  const deploymentExport = reconstructDeploymentExportFromBroadcast(
    { transactions, receipts },
    "base"
  );

  assert.equal(deploymentExport.deploymentComplete, "true");
  assert.equal(deploymentExport.deploymentProfile, "production");
  assert.equal(deploymentExport.networkName, "base");
});

test("reconstructDeploymentExportFromBroadcast rejects non-production mainnet profiles", () => {
  const { transactions, receipts } = completeBroadcast({
    treasuryMint: treasuryMintAmount,
  });

  assert.throws(
    () =>
      reconstructDeploymentExportFromBroadcast(
        { transactions, receipts },
        "base",
        { deploymentProfile: "staging" }
      ),
    /must use deploymentProfile=production/
  );
});

test("resolveDeploymentProfile rejects non-production mainnet env overrides", () => {
  assert.throws(
    () =>
      resolveDeploymentProfile("base", {
        RATELOOP_DEPLOYMENT_PROFILE: "staging",
      }),
    /must be production/
  );
});

test("resolveDeploymentProfile uses network defaults", () => {
  assert.equal(resolveDeploymentProfile("base", {}), "production");
  assert.equal(resolveDeploymentProfile("baseSepolia", {}), "default");
  assert.equal(resolveDeploymentProfile("worldchain", {}), "production");
  assert.equal(resolveDeploymentProfile("worldchainSepolia", {}), "default");
});

test("reconstructDeploymentExportFromBroadcast exports optional mock World ID router", () => {
  const { transactions, receipts } = completeBroadcast();
  const mockRouter = address(700);
  const hash = nextTxHash(transactions);
  transactions.push({
    transactionType: "CREATE",
    contractName: "MockWorldIDRouter",
    contractAddress: mockRouter,
    transaction: { from: fixtureDeployer },
    hash,
  });
  receipts.push(successfulReceipt(hash, "0xc9"));

  const deploymentExport = reconstructDeploymentExportFromBroadcast(
    { transactions, receipts },
    "worldchainSepolia"
  );

  assert.equal(deploymentAt(deploymentExport, mockRouter), "MockWorldIDRouter");
  assert.equal(deploymentExport.deploymentBlockNumber, 201);
});

test("reconstructDeploymentExportFromBroadcast accepts Foundry proxy and decoded call shapes", () => {
  const { transactions, receipts } = completeBroadcast();
  const adminRole =
    "0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775";
  const configRole =
    "0x82db594318110a04b6349ce48645aa69f0892751bc893d15e61d9e2b9c4630f5";
  const pauserRole =
    "0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a";
  const seederRole =
    "0x240afcd1926e36e0297a1eb63ba484f52ddbef788e7f4e9b38b0dcc66de129e1";

  encodeExistingProxyCallWithAbi(
    findRequiredCall(
      transactions,
      (tx) =>
        tx.contractName === "RaterRegistry" && tx.arguments?.[0] === adminRole
    ),
    raterRegistryAbi,
    "renounceRole"
  );
  encodeExistingProxyCallWithAbi(
    findRequiredCall(
      transactions,
      (tx) =>
        tx.contractName === "RaterRegistry" && tx.arguments?.[0] === seederRole
    ),
    raterRegistryAbi,
    "renounceRole"
  );
  encodeExistingProxyCallWithAbi(
    findRequiredCall(
      transactions,
      (tx) =>
        tx.contractName === "FeedbackRegistry" &&
        tx.arguments?.[0] === configRole
    ),
    feedbackRegistryAbi,
    "renounceRole"
  );
  encodeExistingProxyCallWithAbi(
    findRequiredCall(
      transactions,
      (tx) =>
        tx.contractName === "ContentRegistry" &&
        tx.arguments?.[0] === configRole
    ),
    contentRegistryAbi,
    "renounceRole"
  );
  encodeExistingProxyCallWithAbi(
    findRequiredCall(
      transactions,
      (tx) =>
        tx.contractName === "ContentRegistry" &&
        tx.arguments?.[0] === pauserRole
    ),
    contentRegistryAbi,
    "renounceRole"
  );

  for (const [functionName, predicate] of [
    [
      "mint",
      (tx) =>
        tx.contractName === "LoopReputation" &&
        tx.function === "mint(address,uint256)" &&
        tx.arguments?.[1] === treasuryMintAmount,
    ],
    [
      "setGovernor",
      (tx) =>
        tx.contractName === "LoopReputation" &&
        tx.function === "setGovernor(address)",
    ],
    [
      "mint",
      (tx) =>
        tx.contractName === "LoopReputation" &&
        tx.function === "mint(address,uint256)" &&
        tx.arguments?.[1] === "75000000000000",
    ],
  ]) {
    encodeExistingCallWithAbi(
      findRequiredCall(transactions, predicate),
      loopReputationAbi,
      functionName
    );
  }

  const deploymentExport = reconstructDeploymentExportFromBroadcast(
    { transactions, receipts },
    "worldchainSepolia"
  );

  assert.equal(deploymentExport.deploymentComplete, "true");
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

test("reconstructDeploymentExportFromBroadcast rejects missing oracle payout consumers", () => {
  const cases = [
    {
      domain: "4",
      label:
        /ClusterPayoutOracle\.setRoundPayoutSnapshotConsumer\(QUESTION_BUNDLE_REWARD\)/,
    },
    {
      domain: "3",
      label:
        /ClusterPayoutOracle\.setRoundPayoutSnapshotConsumer\(PUBLIC_RATING\)/,
    },
  ];

  for (const { domain, label } of cases) {
    const { transactions, receipts } = completeBroadcast();
    removeRequiredCall(
      transactions,
      receipts,
      (tx) =>
        tx.contractName === "ClusterPayoutOracle" &&
        tx.function === "setRoundPayoutSnapshotConsumer(uint8,address)" &&
        tx.arguments?.[0] === domain
    );

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

test("reconstructDeploymentExportFromBroadcast rejects missing deployer handoffs", () => {
  const configRole =
    "0x82db594318110a04b6349ce48645aa69f0892751bc893d15e61d9e2b9c4630f5";
  const pauserRole =
    "0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a";
  const accessRecorderRole =
    "0xb82259307557a2e745f9b5e8967a4017845406824ddb2b55b3da0f9e27c2a8db";
  const confidentialityEscrow = address(25);
  const confidentialityEscrowRenounce = (role) =>
    encodeFunctionData({
      abi: confidentialityEscrowAbi,
      functionName: "renounceRole",
      args: [role, fixtureDeployer],
    });
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
    {
      label: /ConfidentialityEscrow\.renounceRole\(PAUSER_ROLE\)/,
      predicate: (tx) =>
        tx.contractAddress?.toLowerCase() ===
          confidentialityEscrow.toLowerCase() &&
        tx.input === confidentialityEscrowRenounce(pauserRole),
    },
    {
      label: /ConfidentialityEscrow\.renounceRole\(CONFIG_ROLE\)/,
      predicate: (tx) =>
        tx.contractAddress?.toLowerCase() ===
          confidentialityEscrow.toLowerCase() &&
        tx.input === confidentialityEscrowRenounce(configRole),
    },
    {
      label: /ConfidentialityEscrow\.renounceRole\(ACCESS_RECORDER_ROLE\)/,
      predicate: (tx) =>
        tx.contractAddress?.toLowerCase() ===
          confidentialityEscrow.toLowerCase() &&
        tx.input === confidentialityEscrowRenounce(accessRecorderRole),
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

test("reconstructDeploymentExportFromBroadcast rejects missing critical wiring", () => {
  const cases = [
    {
      label: /ContentRegistry\.pause/,
      selector: "0x8456cb59",
      target: address(13),
    },
    {
      label: /ContentRegistry\.setVotingEngine/,
      selector: "0xf5a750c1",
      target: address(13),
    },
    {
      label: /ContentRegistry\.setQuestionRewardPoolEscrow/,
      selector: "0x38df9df7",
      target: address(13),
    },
    {
      label: /ContentRegistry\.unpause/,
      selector: "0x3f4ba83a",
      target: address(13),
    },
    {
      label: /ContentRegistry\.setProtocolConfig/,
      selector: "0x736d5beb",
      target: address(13),
    },
    {
      label: /ContentRegistry\.setCategoryRegistry/,
      selector: "0x1ea60576",
      target: address(13),
    },
    {
      label: /ContentRegistry\.grantRole\(X402_GATEWAY_ROLE\)/,
      selector: "0x2f2ff15d",
      target: address(13),
      arg: "0xf8fc5b762a56b84305af28ac287dfaf08d491f8de4965459339ae40cec115613",
    },
    {
      label: /ProtocolConfig\.setConfig/,
      selector: "0xe5c389cd",
      target: address(15),
    },
    {
      label: /ProtocolConfig\.setRewardDistributor/,
      selector: "0xa1809b95",
      target: address(15),
    },
    {
      label: /ProtocolConfig\.setFrontendRegistry/,
      selector: "0x6848070b",
      target: address(15),
    },
    {
      label: /ProtocolConfig\.setCategoryRegistry/,
      selector: "0x1ea60576",
      target: address(15),
    },
    {
      label: /ProtocolConfig\.setRaterRegistry/,
      selector: "0x4ae92ae4",
      target: address(15),
    },
    {
      label: /ProtocolConfig\.setConfidentialityEscrow/,
      selector: "0x1bc0f67c",
      target: address(15),
      arg: address(25),
    },
    {
      label: /ProfileRegistry\.setRaterRegistry/,
      selector: "0x4ae92ae4",
      target: address(11),
    },
    {
      label: /RaterRegistry\.setConfidentialityEscrow/,
      selector: "0x1bc0f67c",
      target: address(21),
      arg: address(25),
    },
    {
      label: /FrontendRegistry\.setVotingEngine/,
      selector: "0xf5a750c1",
      target: address(9),
    },
    {
      label: /FrontendRegistry\.initializeFeeCreditor/,
      selector: "0x93cca7c6",
      target: address(9),
    },
    {
      label: /LoopReputation\.mint\(Treasury\)/,
      functionName: "mint(address,uint256)",
      target: address(2),
      arg: address(1),
    },
    {
      label: /LoopReputation\.mint\(LaunchDistributionPool\)/,
      functionName: "mint(address,uint256)",
      target: address(2),
      arg: address(7),
    },
  ];

  for (const { label, selector, functionName, target, arg } of cases) {
    const { transactions, receipts } = completeBroadcast();
    removeRequiredCall(
      transactions,
      receipts,
      (tx) => {
        if (selector && !tx.input?.startsWith(selector)) return false;
        if (functionName && tx.function !== functionName) return false;
        if (
          target &&
          tx.contractAddress.toLowerCase() !== target.toLowerCase()
        ) {
          return false;
        }
        if (!arg) return true;
        if (functionName) {
          return tx.arguments?.some(
            (value) => value.toLowerCase?.() === arg.toLowerCase()
          );
        }
        if (tx.input) return tx.input.toLowerCase().includes(arg.slice(2));
        return tx.arguments?.some(
          (value) => value.toLowerCase?.() === arg.toLowerCase()
        );
      },
      String(label)
    );

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

test("reconstructDeploymentExportFromBroadcast rejects final-state rewrites after required calls", () => {
  const cases = [
    {
      label: /ProtocolConfig\.setRewardDistributor/,
      mutate: (transactions, receipts) => {
        pushProtocolConfigProxyCall(
          transactions,
          receipts,
          address(15),
          "setRewardDistributor",
          [address(601)]
        );
      },
    },
    {
      label: /ContentRegistry\.setVotingEngine/,
      mutate: (transactions, receipts) => {
        pushProxyCall(
          transactions,
          receipts,
          address(13),
          contentRegistryAbi,
          "setVotingEngine",
          [address(602)]
        );
      },
    },
    {
      label:
        /LaunchDistributionPool\.setAuthorizedCaller\(RoundRewardDistributor\)/,
      mutate: (transactions, receipts) => {
        pushCall(
          transactions,
          receipts,
          "LaunchDistributionPool",
          "setAuthorizedCaller(address,bool)",
          [address(19), "false"],
          address(7)
        );
      },
    },
    {
      label: /RaterRegistry\.setConfidentialityEscrow/,
      mutate: (transactions, receipts) => {
        pushProxyCall(
          transactions,
          receipts,
          address(21),
          raterRegistryAbi,
          "setConfidentialityEscrow",
          [address(603)]
        );
      },
    },
    {
      label: /ProtocolConfig\.setConfidentialityEscrow/,
      mutate: (transactions, receipts) => {
        pushProtocolConfigProxyCall(
          transactions,
          receipts,
          address(15),
          "setConfidentialityEscrow",
          [address(604)]
        );
      },
    },
    {
      label:
        /ClusterPayoutOracle\.setRoundPayoutSnapshotConsumer\(QUESTION_REWARD\)/,
      mutate: (transactions, receipts) => {
        pushCall(
          transactions,
          receipts,
          "ClusterPayoutOracle",
          "setRoundPayoutSnapshotConsumer(uint8,address)",
          ["1", address(603)],
          address(6)
        );
      },
    },
    {
      label:
        /ClusterPayoutOracle\.setRoundPayoutSnapshotConsumer\(QUESTION_BUNDLE_REWARD\)/,
      mutate: (transactions, receipts) => {
        pushCall(
          transactions,
          receipts,
          "ClusterPayoutOracle",
          "setRoundPayoutSnapshotConsumer(uint8,address)",
          ["4", address(604)],
          address(6)
        );
      },
    },
    {
      label:
        /ClusterPayoutOracle\.setRoundPayoutSnapshotConsumer\(PUBLIC_RATING\)/,
      mutate: (transactions, receipts) => {
        pushCall(
          transactions,
          receipts,
          "ClusterPayoutOracle",
          "setRoundPayoutSnapshotConsumer(uint8,address)",
          ["3", address(605)],
          address(6)
        );
      },
    },
  ];

  for (const { label, mutate } of cases) {
    const { transactions, receipts } = completeBroadcast();
    mutate(transactions, receipts);

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

test("reconstructDeploymentExportFromBroadcast rejects deployments left paused", () => {
  const { transactions, receipts } = completeBroadcast();
  pushProxyCall(
    transactions,
    receipts,
    address(13),
    contentRegistryAbi,
    "pause",
    []
  );

  assert.throws(
    () =>
      reconstructDeploymentExportFromBroadcast(
        { transactions, receipts },
        "worldchainSepolia"
      ),
    /ContentRegistry remains paused/
  );
});

test("reconstructDeploymentExportFromBroadcast rejects non-governance proxy admins", () => {
  const { transactions, receipts } = completeBroadcast();
  const proxy = transactions.find(
    (tx) => tx.contractName === "TransparentUpgradeableProxy"
  );
  proxy.arguments[1] = address(333);

  assert.throws(
    () =>
      reconstructDeploymentExportFromBroadcast(
        { transactions, receipts },
        "worldchainSepolia"
      ),
    /FrontendRegistry proxy admin is not initialized to governance/
  );
});

test("reconstructDeploymentExportFromBroadcast rejects unexpected authority mutations", () => {
  const proposerRole =
    "0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1";
  const { transactions, receipts } = completeBroadcast();
  pushCall(
    transactions,
    receipts,
    "TimelockController",
    "grantRole(bytes32,address)",
    [proposerRole, address(555)],
    address(1)
  );

  assert.throws(
    () =>
      reconstructDeploymentExportFromBroadcast(
        { transactions, receipts },
        "worldchainSepolia"
      ),
    /TimelockController grants governance role to unexpected account/
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
      label: /ClusterPayoutOracle\.setOracleConfig/,
      mutate: (transactions) => {
        const tx = findRequiredCall(
          transactions,
          (candidate) =>
            candidate.contractName === "ClusterPayoutOracle" &&
            candidate.function === "setOracleConfig(uint64,uint256,address)"
        );
        tx.arguments[0] = "0";
      },
    },
    {
      label: /ClusterPayoutOracle\.setOracleConfig/,
      mutate: (transactions) => {
        const tx = findRequiredCall(
          transactions,
          (candidate) =>
            candidate.contractName === "ClusterPayoutOracle" &&
            candidate.function === "setOracleConfig(uint64,uint256,address)"
        );
        tx.arguments[1] = "1000000";
      },
    },
    {
      label: /ClusterPayoutOracle\.setOracleConfig/,
      mutate: (transactions) => {
        const tx = findRequiredCall(
          transactions,
          (candidate) =>
            candidate.contractName === "ClusterPayoutOracle" &&
            candidate.function === "setOracleConfig(uint64,uint256,address)"
        );
        tx.arguments[2] = address(209);
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
        /ClusterPayoutOracle\.setRoundPayoutSnapshotConsumer\(QUESTION_BUNDLE_REWARD\)/,
      mutate: (transactions) => {
        const tx = findRequiredCall(
          transactions,
          (candidate) =>
            candidate.contractName === "ClusterPayoutOracle" &&
            candidate.function ===
              "setRoundPayoutSnapshotConsumer(uint8,address)" &&
            candidate.arguments?.[0] === "4"
        );
        tx.arguments[1] = address(206);
      },
    },
    {
      label:
        /ClusterPayoutOracle\.setRoundPayoutSnapshotConsumer\(PUBLIC_RATING\)/,
      mutate: (transactions) => {
        const tx = findRequiredCall(
          transactions,
          (candidate) =>
            candidate.contractName === "ClusterPayoutOracle" &&
            candidate.function ===
              "setRoundPayoutSnapshotConsumer(uint8,address)" &&
            candidate.arguments?.[0] === "3"
        );
        tx.arguments[1] = address(207);
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
    /Expected 11 proxy deployments, found 1/
  );
});
