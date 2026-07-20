import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { __effectiveAgentReviewContextTestUtils } from "~~/lib/tokenless/effectiveAgentReviewContext";

const otherwiseActiveGrant = {
  configuredPolicy: { policyId: "agpol_legacy_manual", version: 1 },
  integrationPolicy: { policyId: "agpol_legacy_manual", version: 1 },
  authority: "ask_automatically",
  activationMode: "owner_approved",
  integrationBindingMatches: true,
  publishingPolicyActive: true,
  connectionReady: true,
  scopes: ["panel:publish", "payment:submit"],
  workflows: ["general-assistance"],
  paymentRequired: true,
};

test("manual selection never activates an otherwise exact legacy autonomous grant", () => {
  assert.equal(
    __effectiveAgentReviewContextTestUtils.grantReason({
      ...otherwiseActiveGrant,
      selectionMode: "manual",
    }),
    "manual_handoff_only",
  );
  assert.equal(
    __effectiveAgentReviewContextTestUtils.grantReason({
      ...otherwiseActiveGrant,
      selectionMode: "always",
    }),
    "active",
  );
});

test("both context branches surface the host-reported lane next to the enforcement boundary", () => {
  const source = readFileSync(new URL("./effectiveAgentReviewContext.ts", import.meta.url), "utf8");
  assert.equal((source.match(/enforcementBoundary: bound\.enforcementMode,\n\s*reportedLane,/gu) ?? []).length, 2);
  assert.match(source, /connectionLaneFromClientCapabilitiesJson/u);
  assert.match(source, /Host-attested only/u);
});
