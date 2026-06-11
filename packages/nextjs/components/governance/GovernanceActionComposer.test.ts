import {
  CONFIDENTIALITY_SLASH_BOND_ACTION_ID,
  RATER_REGISTRY_BAN_IDENTITY_ACTION_ID,
  RATER_REGISTRY_UNBAN_IDENTITY_ACTION_ID,
  getGovernanceActionTemplateSummaries,
} from "./GovernanceActionComposer";
import assert from "node:assert/strict";
import test from "node:test";

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
