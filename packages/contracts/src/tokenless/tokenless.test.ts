import assert from "node:assert/strict";
import test from "node:test";
import {
  CredentialIssuerAbi,
  TokenlessPanelAbi,
  TokenlessTestUSDCAbi,
  X402PanelSubmitterAbi,
  tokenlessDeployedContracts,
  tokenlessDeploymentSchema,
  tokenlessHistoricalDeployments,
  tokenlessHistoricalDeploymentSchema,
} from "./index.js";

type AbiEntry = { type?: string; name?: string };

const deployment = tokenlessHistoricalDeployments[84532];
const nonZeroAddress = /^0x(?!0{40}$)[0-9a-f]{40}$/u;

function names(abi: readonly AbiEntry[], type: string) {
  return new Set(abi.filter((entry) => entry.type === type).map((entry) => entry.name));
}

test("keeps v1 historical while reserving the active registry for v2", () => {
  assert.equal(tokenlessDeploymentSchema, "rateloop-tokenless-deployment-v2");
  assert.deepEqual(Object.keys(tokenlessDeployedContracts), []);
  assert.equal(tokenlessHistoricalDeploymentSchema, "rateloop-tokenless-deployment-v1");
  assert.deepEqual(Object.keys(tokenlessHistoricalDeployments), ["84532"]);
  assert.equal(deployment.deploymentStatus, "historical");
  assert.equal(deployment.supersededBySchema, tokenlessDeploymentSchema);
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
    Math.max(...Object.values(deployment.contracts).map((contract) => contract.deployedOnBlock)),
  );
});

test("deployment key is derived from the panel, issuer, and adapter addresses", () => {
  const expected = [
    "tokenless-v1",
    "84532",
    deployment.contracts.TokenlessPanel.address,
    deployment.contracts.CredentialIssuer.address,
    deployment.contracts.X402PanelSubmitter.address,
  ]
    .join(":")
    .toLowerCase();
  assert.equal(deployment.deploymentKey, expected);
});

test("panel ABI exposes deterministic lifecycle evidence and no mutable administration", () => {
  const functions = names(TokenlessPanelAbi, "function");
  const events = names(TokenlessPanelAbi, "event");
  for (const functionName of [
    "createRound",
    "commit",
    "reveal",
    "beginSettlement",
    "processAggregate",
    "processWeights",
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
    "RoundFinalized",
    "RoundTerminal",
    "Claimed",
  ]) {
    assert.ok(events.has(eventName), `missing ${eventName}`);
  }
  for (const forbidden of ["owner", "pause", "sweep", "setIssuer", "setFeeRecipient"]) {
    assert.equal(functions.has(forbidden), false, `unexpected ${forbidden}`);
  }
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
