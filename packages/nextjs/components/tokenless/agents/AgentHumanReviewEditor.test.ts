import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AgentHumanReviewEditor.tsx", import.meta.url), "utf8");
const routingSource = readFileSync(new URL("./ReviewRoutingFields.tsx", import.meta.url), "utf8");
const catalogSource = readFileSync(new URL("../../../messages/en/agents.json", import.meta.url), "utf8");
const localizedSource = `${source}\n${catalogSource}`;
const localizedRoutingSource = `${routingSource}\n${catalogSource}`;

test("the contextual editor owns every human-review dimension through one canonical API", () => {
  assert.match(source, /agents\/\$\{encodeURIComponent\(agentId\)\}\/human-review/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /expectedBindingVersion: view\.bindingRevision/);
  for (const label of ["Review question", "When to review"]) {
    assert.match(localizedSource, new RegExp(label));
  }
  assert.doesNotMatch(source, /Advanced review limits|<details/);
  assert.match(source, /draft\.mode === "adaptive" \|\| draft\.mode === "fixed"/);
  assert.match(source, /const policyCopy = useLocalizedReviewPolicyCopy\(\)/);
  assert.match(source, /policyCopy\.limits\.fixedRate/);
  assert.match(source, /policyCopy\.limits\.maximumGap/);
  assert.match(source, /policyCopy\.question\.criterion/);
  assert.match(source, /<p>\{policyCopy\.limits\.adaptiveSummary\}<\/p>/);
  assert.match(
    source,
    /<InfoPopover label=\{ui\("aboutAdaptiveCoverage"\)\}>\s*\{policyCopy\.limits\.adaptiveDetail\}/,
  );
  assert.match(source, /policyCopy\.limits\.adaptiveDetail/);
  assert.match(source, /policyCopy\.timing\.responseWindow/);
  assert.match(source, /policyCopy\.payment\.bountyPerReviewer/);
  assert.match(source, /canChooseQuestionAuthority/);
  assert.match(source, /canChooseAudience/);
  assert.match(source, /paidConfigurationRelevant/);
  assert.match(source, /<DurationInput/);
  assert.doesNotMatch(source, /\(unavailable\)/);
  assert.match(source, /<ReviewRoutingFields/);
  assert.match(localizedRoutingSource, /When should RateLoop require human review\?/);
  assert.match(localizedRoutingSource, /If review is required, what may the agent do\?/);
  assert.match(localizedRoutingSource, /Manual handoff only/);
  assert.match(source, /publishingGrant: null/);
  assert.match(source, /delegation\.publishingPolicy\.id/);
  assert.match(source, /connection\?\.allowedWorkflowKeys/);
  assert.match(source, /provision: "private_invited_unpaid"/);
  assert.match(source, /privateReviewRouting\?\.ready/);
  assert.match(localizedSource, /Required reviews will send after the agent checks each eligible output/);
  assert.match(localizedSource, /unlock when enough invited reviewers join/);
  assert.match(source, /privateUnpaidBootstrapAvailable/);
  assert.match(source, /view\.configuration\?\.selection\.value \?\?/);
  assert.match(source, /privateReviewerCompatibilityId: String\(request\.privateGroupId \?\? ""\)/);
  assert.match(
    source,
    /privateGroupId\s*=\s*draft\.audience === "public_network" \? null : draft\.privateReviewerCompatibilityId\.trim\(\)/,
  );
  assert.match(
    localizedSource,
    /Workspace reviewer routing is not ready\. Invite reviewers in Reviews, then try again\./,
  );
  assert.doesNotMatch(source, /private-groups|PrivateGroup|Invited reviewer group|Choose a group/);
  assert.match(source, /expectedBindingVersion: view\.bindingRevision/);
  assert.match(source, /creating \? ui\("finishSetup"\) : ui\("saveChanges"\)/);
  assert.doesNotMatch(source, /createDescription|editDescription/);
  assert.doesNotMatch(localizedSource, /Choose how this agent sends work|Edit this agent’s review settings/);
  assert.doesNotMatch(source, /Finish human-review setup before editing it/);
  assert.doesNotMatch(source, /Back to reviews|onClose/);
  assert.doesNotMatch(source, /Human-review configuration is unavailable/);
  assert.match(source, /number\(request\.panelSize, 2\)/);
  assert.match(source, /draft\.audience === "private_invited" \? 2 : 3/);
  assert.match(source, /view\.connection\?\.connectionStatus === "connected"/);
  assert.match(source, /view\.connection\?\.enforcementMode === "advisory"/);
  assert.match(source, /reportedLane === "plugin-with-hooks"/);
  assert.match(localizedSource, /Plugin connection/);
  assert.match(localizedSource, /cannot prove the host held an output until review reached a terminal result/);
  assert.match(routingSource, /disabled=\{automaticUnavailable\}/);
  assert.match(source, /mode === "manual" \? "check_only"/);
  assert.match(source, /enforcementMode: draft\.mode === "manual" \? "advisory"/);
  assert.match(source, /requiredExpertiseKeys: strings\(currentRequestProfile\.requiredExpertiseKeys, \[\]\)/);
  assert.match(source, /Array\.isArray\(currentRequestProfile\.expertiseRequirements\)/);
  assert.match(source, /humanReviewConfirmationMessage\(\s*\{/);
  assert.match(source, /authority,/);
  assert.match(source, /title: policyCopy\.confirmation\.title/);
  assert.match(source, /description: next\.confirmation/);
  assert.match(source, /confirmLabel: policyCopy\.confirmation\.action/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(localizedSource, /Save changes/);
  assert.doesNotMatch(source, /Confirm exact changes/);
  assert.doesNotMatch(source, /I confirm this exact human-review configuration/);
  assert.doesNotMatch(source, /Review changes/);
  assert.match(localizedSource, /can never select or execute a Feedback Bonus award/);
  assert.match(source, /policyCopy\.question\.agentWrittenNote/);
  assert.match(localizedSource, /Agent-written questions cannot use adaptive review/);
  assert.match(localizedSource, /Agent-written questions require RateLoop network reviewers/);
  assert.doesNotMatch(source, /Private material sensitivity/);
  assert.match(source, /currentRequestProfile\.privateSensitivity \?\? "confidential"/);
});
