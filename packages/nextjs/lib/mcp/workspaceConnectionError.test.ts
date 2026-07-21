import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { WORKSPACE_CONFLICT_RECOVERY_ACTION, workspaceToolErrorPayload } from "~~/lib/mcp/workspaceConnectionError";

const workspaceProtocol = readFileSync(new URL("./workspaceProtocol.ts", import.meta.url), "utf8");

test("workspace conflicts return one display-safe owner recovery action", () => {
  assert.deepEqual(
    workspaceToolErrorPayload({
      code: "workspace_conflict",
      message: "This OAuth connection is already bound to another workspace.",
      retryable: false,
    }),
    {
      code: "workspace_conflict",
      message: "This OAuth connection is already bound to another workspace.",
      retryable: false,
      recoveryAction: WORKSPACE_CONFLICT_RECOVERY_ACTION,
    },
  );
  assert.equal(
    WORKSPACE_CONFLICT_RECOVERY_ACTION,
    "This Codex connection is active in another workspace. Complete the host’s OAuth action to connect this task with a separate credential.",
  );
  assert.doesNotMatch(WORKSPACE_CONFLICT_RECOVERY_ACTION, /ws_|aci_|claim=|token|secret/iu);
  assert.doesNotMatch(WORKSPACE_CONFLICT_RECOVERY_ACTION, /disconnect|delete|revoke|configuration/iu);
});

test("unrelated workspace errors do not invent a recovery action", () => {
  assert.deepEqual(
    workspaceToolErrorPayload({
      code: "connection_not_ready",
      message: "Connection is not ready.",
      retryable: true,
    }),
    {
      code: "connection_not_ready",
      message: "Connection is not ready.",
      retryable: true,
    },
  );
});

test("the workspace MCP adapter includes display-safe recovery in tool errors", () => {
  assert.match(workspaceProtocol, /const value = workspaceToolErrorPayload\(error\)/u);
  assert.match(workspaceProtocol, /return \{ \.\.\.toolResult\(value\), isError: true \}/u);
});
