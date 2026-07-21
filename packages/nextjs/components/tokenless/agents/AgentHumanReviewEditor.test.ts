import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AgentHumanReviewEditor.tsx", import.meta.url), "utf8");
const routingSource = readFileSync(new URL("./ReviewRoutingFields.tsx", import.meta.url), "utf8");

test("the contextual editor owns every human-review dimension through one canonical API", () => {
  assert.match(source, /agents\/\$\{encodeURIComponent\(agentId\)\}\/human-review/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /expectedBindingVersion: view\.bindingRevision/);
  for (const label of [
    "Who writes the question?",
    "Use one question",
    "Let the agent ask each time",
    "Review question",
    "Positive label",
    "Negative label",
    "Rationale",
    "Minimum review rate",
    "Outputs reviewed",
    "Maximum outputs between reviews",
    "Reviewers",
    "Response window",
    "Reviewers per request",
    "Guaranteed bounty",
    "USDC per accepted reviewer",
    "Feedback Bonus",
    "No bonus",
    "Add bonus",
    "Bonus pool",
    "Human awarder",
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /<ReviewRoutingFields/);
  assert.match(routingSource, /When should RateLoop require human review\?/);
  assert.match(routingSource, /If review is required, what may the agent do\?/);
  assert.match(routingSource, /Manual handoff only/);
  assert.match(source, /publishingGrant: null/);
  assert.match(source, /delegation\.publishingPolicy\.id/);
  assert.match(source, /connection\?\.allowedWorkflowKeys/);
  assert.match(source, /provision: "private_invited_unpaid"/);
  assert.match(source, /privateReviewRouting\?\.ready/);
  assert.match(source, /Automatic review requests are ready/);
  assert.match(source, /unlock when enough invited reviewers join/);
  assert.match(source, /privateUnpaidBootstrapAvailable/);
  assert.match(source, /view\.configuration\?\.selection\.value \?\?/);
  assert.match(source, /privateReviewerCompatibilityId: String\(request\.privateGroupId \?\? ""\)/);
  assert.match(
    source,
    /privateGroupId\s*=\s*draft\.audience === "public_network" \? null : draft\.privateReviewerCompatibilityId\.trim\(\)/,
  );
  assert.match(source, /Workspace reviewer routing is not ready\. Invite reviewers in Reviews, then try again\./);
  assert.doesNotMatch(source, /private-groups|PrivateGroup|Invited reviewer group|Choose a group/);
  assert.match(source, /expectedBindingVersion: view\.bindingRevision/);
  assert.match(source, /creating \? "Finish setup" : "Save changes"/);
  assert.doesNotMatch(source, /Finish human-review setup before editing it/);
  assert.doesNotMatch(source, /Human-review configuration is unavailable/);
  assert.match(source, /number\(request\.panelSize, 2\)/);
  assert.match(source, /draft\.audience === "private_invited" \? 2 : 3/);
  assert.match(source, /view\.connection\?\.connectionStatus === "connected"/);
  assert.match(routingSource, /disabled=\{automaticUnavailable\}/);
  assert.match(source, /mode === "manual" \? "check_only"/);
  assert.match(source, /enforcementMode: draft\.mode === "manual" \? "advisory"/);
  assert.match(source, /draft\.mode !== "manual"/);
  assert.match(source, /requiredExpertiseKeys: strings\(currentRequestProfile\.requiredExpertiseKeys, \[\]\)/);
  assert.match(source, /Array\.isArray\(currentRequestProfile\.expertiseRequirements\)/);
  assert.match(source, /humanReviewConfirmationMessage\(\{/);
  assert.match(source, /authority,/);
  assert.match(source, /next\.confirmation && !window\.confirm\(next\.confirmation\)/);
  assert.match(source, /Save changes/);
  assert.doesNotMatch(source, /Confirm exact changes/);
  assert.doesNotMatch(source, /I confirm this exact human-review configuration/);
  assert.doesNotMatch(source, /Review changes/);
  assert.match(source, /can never select or execute a Feedback Bonus award/);
  assert.match(source, /Agent-written questions collect feedback only/);
  assert.match(source, /Agent-written questions cannot use adaptive review/);
  assert.match(source, /Agent-written questions require RateLoop network reviewers/);
  assert.doesNotMatch(source, /Private material sensitivity/);
  assert.match(source, /currentRequestProfile\.privateSensitivity \?\? "confidential"/);
});
