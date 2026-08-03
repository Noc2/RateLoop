import assert from "node:assert/strict";
import test from "node:test";
import { workspaceMcpTools } from "~~/lib/mcp/workspaceProtocol";
import { __adaptiveReviewOrchestrationTestUtils } from "~~/lib/tokenless/adaptiveReviewOrchestration";
import { formatPrivateReviewWaitCursor } from "~~/lib/tokenless/privateReviewWaitCursor";

const waitTool = workspaceMcpTools.find(tool => tool.name === "rateloop_wait_for_review");
if (!waitTool) throw new Error("The workspace MCP wait tool is unavailable.");
const cursorSchema = waitTool.inputSchema.properties.cursor;
if (!("pattern" in cursorSchema)) throw new Error("The workspace MCP wait cursor pattern is unavailable.");
const publishedPattern = new RegExp(cursorSchema.pattern, "u");

test("private review wait cursors share one runtime and published MCP invariant", () => {
  const valid = [
    "0",
    "1:0",
    "9007199254740991:9007199254740991",
    formatPrivateReviewWaitCursor({ revision: 17, responseCount: 2 }),
  ];
  const invalid = ["", " 1:2 ", "1:", ":2", "1:2:3", "-1:2", "10000000000000000:0"];

  for (const cursor of valid) {
    assert.equal(publishedPattern.test(cursor), true, `${cursor} must match the published tool schema`);
    assert.doesNotThrow(() =>
      __adaptiveReviewOrchestrationTestUtils.normalizePrivateWaitOptions({ cursor, timeoutMs: 1 }),
    );
  }
  for (const cursor of invalid) {
    assert.equal(publishedPattern.test(cursor), false, `${cursor} must not match the published tool schema`);
    assert.throws(
      () => __adaptiveReviewOrchestrationTestUtils.normalizePrivateWaitOptions({ cursor, timeoutMs: 1 }),
      /cursor is invalid/u,
    );
  }
});
