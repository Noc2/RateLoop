import assert from "node:assert/strict";
import test from "node:test";
import {
  CredentialIssuerAbi,
  TokenlessFeedbackBonusAbi,
  TokenlessPanelAbi,
  TokenlessTestUSDCAbi,
  X402PanelSubmitterAbi,
  tokenlessDeployedContracts,
  tokenlessDeploymentSchema,
  tokenlessDeploymentStatus,
  tokenlessHistoricalDeployments,
  tokenlessHistoricalDeploymentSchema,
} from "./index.js";

type AbiParameter = {
  readonly type?: string;
  readonly name?: string;
  readonly components?: readonly AbiParameter[];
};

type AbiEntry = {
  readonly type?: string;
  readonly name?: string;
  readonly inputs?: readonly AbiParameter[];
  readonly outputs?: readonly AbiParameter[];
};

const deployment = tokenlessHistoricalDeployments[84532];
const nonZeroAddress = /^0x(?!0{40}$)[0-9a-f]{40}$/u;

function names(abi: readonly AbiEntry[], type: string) {
  return new Set(
    abi.filter((entry) => entry.type === type).map((entry) => entry.name),
  );
}

function findEntry(abi: readonly AbiEntry[], type: string, name: string) {
  const entry = abi.find(
    (candidate) => candidate.type === type && candidate.name === name,
  );
  assert.ok(entry, `missing ${type} ${name}`);
  return entry;
}

function tupleComponentNames(
  entry: AbiEntry,
  field: "inputs" | "outputs",
  index = 0,
) {
  const parameter = entry[field]?.[index];
  assert.equal(
    parameter?.type,
    "tuple",
    `${entry.name} ${field}[${index}] must be a tuple`,
  );
  return new Set(parameter.components?.map((component) => component.name));
}

test("keeps historical v2 separate from the unreleased v4 registry", () => {
  assert.equal(tokenlessDeploymentSchema, "rateloop-tokenless-deployment-v4");
  assert.deepEqual(tokenlessDeployedContracts, {});
  assert.deepEqual(tokenlessDeploymentStatus, {
    schemaVersion: "rateloop-tokenless-deployment-v4",
    status: "unreleased",
    chainId: 84_532,
    deploymentKey: null,
  });
  assert.equal(
    tokenlessHistoricalDeploymentSchema,
    "rateloop-tokenless-deployment-v2",
  );
  assert.deepEqual(Object.keys(tokenlessHistoricalDeployments), ["84532"]);
  assert.equal(deployment.schemaVersion, tokenlessHistoricalDeploymentSchema);
  assert.equal(deployment.deploymentStatus, "historical");
  assert.equal(
    deployment.supersededBySchema,
    "rateloop-tokenless-deployment-v3",
  );
  assert.equal(deployment.version, 2);
  assert.equal(deployment.chainId, 84532);
  assert.equal(deployment.networkName, "baseSepolia");
  assert.equal(deployment.deploymentComplete, true);
  assert.equal(deployment.deploymentProfile, "test");
  assert.deepEqual(Object.keys(deployment.contracts).sort(), [
    "CredentialIssuer",
    "TestUSDC",
    "TokenlessPanel",
    "X402PanelSubmitter",
  ]);

  for (const contract of Object.values(deployment.contracts)) {
    assert.match(contract.address, nonZeroAddress);
    assert.ok(contract.deployedOnBlock > 0);
  }
  assert.equal(
    deployment.deploymentBlockNumber,
    Math.max(
      ...Object.values(deployment.contracts).map(
        (contract) => contract.deployedOnBlock,
      ),
    ),
  );
});

test("feedback bonus ABI exposes only immutable pool and award mechanics", () => {
  const functions = names(TokenlessFeedbackBonusAbi, "function");
  const events = names(TokenlessFeedbackBonusAbi, "event");
  for (const functionName of [
    "createPool",
    "createPoolFor",
    "registerFeedback",
    "award",
    "claimAward",
    "refundRemainder",
    "getPool",
    "getFeedback",
  ]) {
    assert.ok(functions.has(functionName), `missing ${functionName}`);
  }
  for (const eventName of [
    "PoolCreated",
    "FeedbackRegistered",
    "FeedbackAwarded",
    "FeedbackAwardClaimed",
    "RemainderRefunded",
  ]) {
    assert.ok(events.has(eventName), `missing ${eventName}`);
  }
  for (const forbidden of ["owner", "pause", "sweep", "setAwarder"]) {
    assert.equal(functions.has(forbidden), false, `unexpected ${forbidden}`);
  }
  assert.deepEqual(
    findEntry(TokenlessFeedbackBonusAbi, "function", "award").inputs?.map(
      (input) => input.name,
    ),
    ["poolId", "voteKey", "amount"],
  );
});

test("historical deployment key remains immutable evidence", () => {
  const expected = [
    "tokenless-v2",
    "84532",
    deployment.contracts.TokenlessPanel.address,
    deployment.contracts.CredentialIssuer.address,
    deployment.contracts.X402PanelSubmitter.address,
  ]
    .join(":")
    .toLowerCase();
  assert.equal(deployment.deploymentKey, expected);
});

test("panel ABI exposes deterministic RBTS lifecycle evidence and no mutable administration", () => {
  const functions = names(TokenlessPanelAbi, "function");
  const events = names(TokenlessPanelAbi, "event");
  for (const functionName of [
    "createRound",
    "commit",
    "reveal",
    "beginSettlement",
    "processAggregate",
    "finalizeScoringSeed",
    "finalizeScoringFallback",
    "processScores",
    "finalizeSettlement",
    "claim",
    "claimCompensation",
    "returnStaleShares",
  ]) {
    assert.ok(functions.has(functionName), `missing ${functionName}`);
  }
  for (const eventName of [
    "RoundCreated",
    "CommitAccepted",
    "RevealAccepted",
    "SettlementProgressed",
    "ScoringSeedFinalized",
    "RevealScored",
    "RoundFinalized",
    "RoundTerminal",
    "Claimed",
  ]) {
    assert.ok(events.has(eventName), `missing ${eventName}`);
  }
  assert.equal(functions.has("processWeights"), false);
  for (const forbidden of [
    "owner",
    "pause",
    "sweep",
    "setIssuer",
    "setFeeRecipient",
  ]) {
    assert.equal(functions.has(forbidden), false, `unexpected ${forbidden}`);
  }
});

test("round and commit evidence use RBTS liabilities instead of accuracy weights", () => {
  const roundFields = tupleComponentNames(
    findEntry(TokenlessPanelAbi, "function", "getRound"),
    "outputs",
  );
  const commitFields = tupleComponentNames(
    findEntry(TokenlessPanelAbi, "function", "getCommit"),
    "outputs",
  );
  for (const field of [
    "fixedBasePay",
    "maximumBonus",
    "totalRbtsScoreBps",
    "totalFinalizedLiability",
    "beaconEntropy",
    "scoringSeed",
    "scoreCursor",
    "scoringMode",
  ]) {
    assert.ok(roundFields.has(field), `missing round field ${field}`);
  }
  for (const field of [
    "referenceCommitKey",
    "peerCommitKey",
    "finalizedPayout",
    "informationScoreBps",
    "predictionScoreBps",
    "rbtsScoreBps",
  ]) {
    assert.ok(commitFields.has(field), `missing commit field ${field}`);
  }
  assert.equal(roundFields.has("totalAccuracyScore"), false);
  assert.equal(roundFields.has("weightCursor"), false);
  assert.equal(commitFields.has("accuracyScore"), false);
});

test("disclosure and post-reveal scoring beacons remain distinct across the ABI", () => {
  const panelTerms = tupleComponentNames(
    findEntry(TokenlessPanelAbi, "function", "createRound"),
    "inputs",
  );
  const roundFields = tupleComponentNames(
    findEntry(TokenlessPanelAbi, "function", "getRound"),
    "outputs",
  );
  const adapterTerms = tupleComponentNames(
    findEntry(X402PanelSubmitterAbi, "function", "roundTermsDigest"),
    "inputs",
  );
  for (const fields of [panelTerms, roundFields, adapterTerms]) {
    assert.ok(fields.has("beaconRound"), "missing tlock disclosure round");
    assert.ok(fields.has("scoringBeaconRound"), "missing scoring beacon round");
  }
  for (const eventName of ["SettlementBegun", "ScoringSeedFinalized"]) {
    const names = new Set(
      findEntry(TokenlessPanelAbi, "event", eventName).inputs?.map(
        (parameter) => parameter.name,
      ),
    );
    assert.ok(
      names.has("scoringBeaconRound"),
      `${eventName} must identify the scoring beacon`,
    );
    assert.equal(
      names.has("beaconRound"),
      false,
      `${eventName} must not label scoring as disclosure`,
    );
  }
});

test("reveal evidence distinguishes scored votes from compensation-only openings", () => {
  const revealAccepted = findEntry(
    TokenlessPanelAbi,
    "event",
    "RevealAccepted",
  );
  assert.deepEqual(
    revealAccepted.inputs?.map(({ name, type }) => ({ name, type })),
    [
      { name: "roundId", type: "uint256" },
      { name: "commitKey", type: "bytes32" },
      { name: "vote", type: "uint8" },
      { name: "predictedUpBps", type: "uint16" },
      { name: "responseHash", type: "bytes32" },
      { name: "scoringEligible", type: "bool" },
    ],
  );
});

test("panel and adapter ABIs bind admission to an exact policy hash", () => {
  const voucherFields = tupleComponentNames(
    findEntry(TokenlessPanelAbi, "function", "commit"),
    "inputs",
  );
  const roundTermFields = tupleComponentNames(
    findEntry(TokenlessPanelAbi, "function", "createRound"),
    "inputs",
  );
  const roundFields = tupleComponentNames(
    findEntry(TokenlessPanelAbi, "function", "getRound"),
    "outputs",
  );
  const adapterRoundTermFields = tupleComponentNames(
    findEntry(X402PanelSubmitterAbi, "function", "roundTermsDigest"),
    "inputs",
  );
  const roundCreatedFields = new Set(
    findEntry(TokenlessPanelAbi, "event", "RoundCreated").inputs?.map(
      (parameter) => parameter.name,
    ),
  );

  for (const fields of [
    voucherFields,
    roundTermFields,
    roundFields,
    adapterRoundTermFields,
  ]) {
    assert.ok(fields.has("admissionPolicyHash"));
    assert.equal(fields.has("tierId"), false);
    assert.equal(fields.has("requiredTier"), false);
  }

  assert.ok(roundCreatedFields.has("admissionPolicyHash"));
  assert.equal(roundCreatedFields.has("requiredTier"), false);
});

test("issuer and adapter ABIs retain only their narrow responsibilities", () => {
  const issuerFunctions = names(CredentialIssuerAbi, "function");
  assert.ok(issuerFunctions.has("rotateScheduled"));
  assert.ok(issuerFunctions.has("rotateEmergency"));
  assert.ok(issuerFunctions.has("isValidVoucherSignature"));
  assert.equal(issuerFunctions.has("transfer"), false);

  const adapterFunctions = names(X402PanelSubmitterAbi, "function");
  assert.ok(adapterFunctions.has("createRoundWithAuthorization"));
  assert.equal(adapterFunctions.has("withdraw"), false);
  assert.equal(adapterFunctions.has("setPanel"), false);

  const testCurrencyFunctions = names(TokenlessTestUSDCAbi, "function");
  assert.ok(testCurrencyFunctions.has("mint"));
  assert.ok(testCurrencyFunctions.has("receiveWithAuthorization"));
});
