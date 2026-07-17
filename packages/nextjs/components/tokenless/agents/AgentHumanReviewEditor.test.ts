import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AgentHumanReviewEditor.tsx", import.meta.url), "utf8");

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
    "Frequency",
    "Minimum review rate",
    "Outputs reviewed",
    "Maximum outputs between reviews",
    "Reviewers",
    "Invited reviewer group",
    "Private material sensitivity",
    "Response window",
    "Reviewers per request",
    "Guaranteed bounty",
    "USDC per accepted reviewer",
    "Feedback Bonus",
    "No bonus",
    "Add bonus",
    "Bonus pool",
    "Human awarder",
    "Agent authority",
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /publishingGrant: null/);
  assert.match(source, /delegation\.publishingPolicy\.id/);
  assert.match(source, /delegation\?\.allowedWorkflowKeys/);
  assert.match(source, /disabled=\{!automaticAvailable\}/);
  assert.match(source, /humanReviewConfirmationMessage\(\{/);
  assert.match(source, /next\.confirmation && !window\.confirm\(next\.confirmation\)/);
  assert.match(source, /Save changes/);
  assert.doesNotMatch(source, /Confirm exact changes/);
  assert.doesNotMatch(source, /I confirm this exact human-review configuration/);
  assert.doesNotMatch(source, /Review changes/);
  assert.match(source, /can never select or execute a Feedback Bonus award/);
  assert.match(source, /Agent-written questions collect feedback only/);
  assert.match(source, /Agent-written questions cannot use adaptive review/);
  assert.match(source, /Agent-written questions require RateLoop network reviewers/);
});
