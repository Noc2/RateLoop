import {
  CONFIDENTIALITY_SLASH_BOND_ACTION_ID,
  ORACLE_TIMING_CONFIG_ACTION_ID,
  RATER_REGISTRY_BAN_IDENTITY_ACTION_ID,
  RATER_REGISTRY_UNBAN_IDENTITY_ACTION_ID,
  getGovernanceActionTemplateSummaries,
  getOracleTimingLaunchBudgetPreview,
  oracleTimingDescriptionReferencesMonitoringEvidence,
} from "./GovernanceActionComposer";
import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData } from "viem";
import { contracts } from "~~/utils/scaffold-eth/contract";

test("governance action composer exposes confidentiality breach proposal templates", () => {
  const templates = new Map(getGovernanceActionTemplateSummaries().map(template => [template.id, template]));

  assert.deepEqual(templates.get(CONFIDENTIALITY_SLASH_BOND_ACTION_ID), {
    contractName: "ConfidentialityEscrow",
    fieldKeys: ["contentId", "identityKey", "reason", "evidenceHash", "reporterRecipient"],
    functionName: "slashBond",
    group: "Confidentiality Breach",
    id: CONFIDENTIALITY_SLASH_BOND_ACTION_ID,
    label: "Slash confidentiality bond",
    mode: "proposal",
  });
  assert.deepEqual(templates.get(RATER_REGISTRY_BAN_IDENTITY_ACTION_ID), {
    contractName: "RaterRegistry",
    fieldKeys: ["provider", "nullifierHash", "expiresAt", "reason", "evidenceHash"],
    functionName: "banIdentity",
    group: "Confidentiality Breach",
    id: RATER_REGISTRY_BAN_IDENTITY_ACTION_ID,
    label: "Ban breached identity",
    mode: "proposal",
  });
  assert.deepEqual(templates.get(RATER_REGISTRY_UNBAN_IDENTITY_ACTION_ID), {
    contractName: "RaterRegistry",
    fieldKeys: ["provider", "nullifierHash"],
    functionName: "unbanIdentity",
    group: "Confidentiality Breach",
    id: RATER_REGISTRY_UNBAN_IDENTITY_ACTION_ID,
    label: "Unban identity",
    mode: "proposal",
  });
});

test("governance action composer hides standalone voting engine rotations", () => {
  const templates = getGovernanceActionTemplateSummaries();

  assert.equal(
    templates.some(template => template.id === "frontend-set-voting-engine"),
    false,
  );
  assert.equal(
    templates.some(template => template.id === "content-set-voting-engine"),
    false,
  );
  assert.equal(
    templates.some(
      template =>
        template.functionName === "setVotingEngine" &&
        (template.contractName === "FrontendRegistry" || template.contractName === "ContentRegistry"),
    ),
    false,
  );
});

test("governance action composer routes treasury updates through ProtocolConfig", () => {
  const templates = new Map(getGovernanceActionTemplateSummaries().map(template => [template.id, template]));

  assert.deepEqual(templates.get("protocol-set-treasury"), {
    contractName: "ProtocolConfig",
    fieldKeys: ["treasury"],
    functionName: "setTreasury",
    group: "Protocol Config",
    id: "protocol-set-treasury",
    label: "Set treasury",
    mode: "proposal",
  });
  assert.equal(
    getGovernanceActionTemplateSummaries().some(
      template =>
        template.id === "content-set-treasury" ||
        (template.contractName === "ContentRegistry" && template.functionName === "setTreasury"),
    ),
    false,
  );
});

test("governance action composer exposes oracle finality timing with veto window", () => {
  const templates = new Map(getGovernanceActionTemplateSummaries().map(template => [template.id, template]));

  assert.deepEqual(templates.get(ORACLE_TIMING_CONFIG_ACTION_ID), {
    contractName: "ClusterPayoutOracle",
    fieldKeys: ["challengeWindow", "finalizationVetoWindow", "keeperOpsLagBudget"],
    functionName: "setOracleTimingConfig",
    group: "Cluster Payout Oracle",
    id: ORACLE_TIMING_CONFIG_ACTION_ID,
    label: "Set oracle timing",
    mode: "proposal",
  });
});

test("governance oracle timing template encodes with resolved contract metadata", () => {
  const oracleContracts = Object.values(contracts ?? {})
    .map(chainContracts => chainContracts.ClusterPayoutOracle)
    .filter(Boolean);
  assert.ok(oracleContracts.length > 0, "ClusterPayoutOracle deployment metadata is required");
  const oracleContract = oracleContracts[0];
  assert.ok(oracleContract, "ClusterPayoutOracle deployment metadata is required");

  const data = encodeFunctionData({
    abi: oracleContract.abi,
    functionName: "setOracleTimingConfig",
    args: [900n, 900n],
  });

  assert.match(data, /^0x[0-9a-f]+$/u);
});

test("oracle timing preview warns above the one-hour launch budget", () => {
  const launchPreview = getOracleTimingLaunchBudgetPreview({
    challengeWindow: "900",
    finalizationVetoWindow: "900",
  });
  assert.equal(launchPreview.healthyPathSeconds, 2700n);
  assert.equal(launchPreview.exceedsLaunchBudget, false);

  const slowerPreview = getOracleTimingLaunchBudgetPreview({
    challengeWindow: "2700",
    finalizationVetoWindow: "1200",
    keeperOpsLagBudget: "900",
  });
  assert.equal(slowerPreview.healthyPathSeconds, 4800n);
  assert.equal(slowerPreview.exceedsLaunchBudget, true);
  assert.equal(oracleTimingDescriptionReferencesMonitoringEvidence("Ponder dashboard shows zero SLA breaches"), true);
  assert.equal(oracleTimingDescriptionReferencesMonitoringEvidence("Make the timing more comfortable"), false);
});
