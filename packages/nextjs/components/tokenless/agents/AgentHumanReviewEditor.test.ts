import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AgentHumanReviewEditor.tsx", import.meta.url), "utf8");

test("the contextual editor owns every human-review dimension through one canonical API", () => {
  assert.match(source, /agents\/\$\{encodeURIComponent\(agentId\)\}\/human-review/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /expectedBindingVersion: view\.bindingRevision/);
  for (const label of [
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
    "Base payment",
    "USDC per accepted reviewer",
    "Agent authority",
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /publishingGrant: null/);
  assert.match(source, /delegation\.publishingPolicy\.id/);
  assert.match(source, /delegation\?\.allowedWorkflowKeys/);
  assert.match(source, /disabled=\{!automaticAvailable\}/);
  assert.match(source, /Confirm exact changes/);
  assert.match(source, /I confirm this exact human-review configuration/);
  assert.doesNotMatch(source, /Feedback Bonus|feedback bonus/);
});
