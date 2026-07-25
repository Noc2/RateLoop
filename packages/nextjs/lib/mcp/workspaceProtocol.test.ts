import assert from "node:assert/strict";
import { test } from "node:test";
import { oauthWorkspaceMcpTools, pairingMcpTools, workspaceMcpTools } from "~~/lib/mcp/workspaceProtocol";

/**
 * Tool-annotation honesty gate.
 *
 * MCP hosts treat `readOnlyHint: true` as permission to run a tool without
 * asking the user, so the hint must never outrun the implementation. These
 * tools reach server code that commits database writes on the read path:
 *
 * - rateloop_wait_for_review -> waitForAdaptiveHumanReview ->
 *   refreshDirectPrivateReviewState -> reconcileDirectPrivateReviewDeadline,
 *   which writes a terminal `response_deadline_elapsed` envelope and advances
 *   the delivery, opportunity, and integration rows.
 * - rateloop_get_review_result -> getAdaptiveHumanReviewResult ->
 *   finalizeAdaptiveReviewEvidence, which upserts
 *   tokenless_agent_evaluation_observations and completes the opportunity (and,
 *   on the private lane, also reconciles an elapsed response deadline).
 *
 * Both writes are load-bearing; the annotation is what has to tell the truth.
 */

type AnnotatedTool = {
  name: string;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  description: string;
};

const WRITING_TOOLS = ["rateloop_wait_for_review", "rateloop_get_review_result"] as const;

const allTools = new Map<string, AnnotatedTool>();
for (const tool of [...pairingMcpTools, ...workspaceMcpTools, ...oauthWorkspaceMcpTools]) {
  allTools.set(tool.name, tool as AnnotatedTool);
}

test("every advertised MCP tool carries a complete annotation set", () => {
  for (const tool of allTools.values()) {
    assert.deepEqual(
      Object.keys(tool.annotations).sort(),
      ["destructiveHint", "idempotentHint", "openWorldHint", "readOnlyHint"],
      `${tool.name} must declare all four MCP tool hints`,
    );
  }
});

for (const name of WRITING_TOOLS) {
  test(`${name} is never advertised as read-only because it commits database writes`, () => {
    const tool = allTools.get(name);
    assert.ok(tool, `${name} is not advertised`);
    assert.equal(
      tool.annotations.readOnlyHint,
      false,
      `${name} performs server-side writes, so readOnlyHint must stay false`,
    );
    assert.equal(tool.annotations.idempotentHint, true, `${name} writes are idempotent`);
    assert.equal(tool.annotations.openWorldHint, false, `${name} touches only RateLoop-owned state`);
  });

  test(`${name} does not describe itself as a pure read`, () => {
    const tool = allTools.get(name);
    assert.ok(tool, `${name} is not advertised`);
    assert.match(
      tool.description,
      /not a read-only/u,
      `${name} must disclose that it mutates server state, not imply a pure read`,
    );
  });
}

test("the same tool name never carries conflicting annotations across advertised tool sets", () => {
  const byName = new Map<string, string>();
  for (const tool of [...pairingMcpTools, ...workspaceMcpTools, ...oauthWorkspaceMcpTools] as AnnotatedTool[]) {
    const fingerprint = JSON.stringify(tool.annotations);
    const seen = byName.get(tool.name);
    if (seen === undefined) byName.set(tool.name, fingerprint);
    else assert.equal(fingerprint, seen, `${tool.name} is advertised with two different annotation sets`);
  }
});
