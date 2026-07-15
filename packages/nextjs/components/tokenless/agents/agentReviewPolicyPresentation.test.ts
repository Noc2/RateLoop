import {
  findBoundAgentVersion,
  listUnboundAgentVersions,
  reviewPolicySectionIsVisible,
} from "./agentReviewPolicyPresentation";
import assert from "node:assert/strict";
import test from "node:test";

const agent = {
  agentId: "agt_support",
  displayName: "Support agent",
  versions: [
    { versionId: "agtv_1", versionNumber: 1, displayName: "Support classic" },
    { versionId: "agtv_2", versionNumber: 2, displayName: "Support current" },
  ],
};

test("virgin workspaces hide review policy controls", () => {
  assert.equal(reviewPolicySectionIsVisible({ agents: [], policies: [] }), false);
});

test("archived-agent policies remain visible and manageable", () => {
  assert.equal(
    reviewPolicySectionIsVisible({
      agents: [],
      policies: [{ policyId: "rpol_1", agentId: agent.agentId, agentVersionId: "agtv_1" }],
    }),
    true,
  );
});

test("only versions without a policy are valid creation targets", () => {
  const registry = {
    agents: [agent],
    policies: [{ policyId: "rpol_1", agentId: agent.agentId, agentVersionId: "agtv_1" }],
  };
  assert.deepEqual(listUnboundAgentVersions(registry), [
    {
      agentId: agent.agentId,
      agentDisplayName: agent.displayName,
      versionId: "agtv_2",
      versionNumber: 2,
      versionDisplayName: "Support current",
    },
  ]);
});

test("policy cards resolve the exact bound version instead of the current label", () => {
  const policy = { policyId: "rpol_1", agentId: agent.agentId, agentVersionId: "agtv_1" };
  assert.deepEqual(findBoundAgentVersion({ agents: [agent], policies: [policy] }, policy), {
    agent,
    version: agent.versions[0],
  });
});
