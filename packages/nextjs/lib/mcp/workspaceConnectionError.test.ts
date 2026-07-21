import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  WORKSPACE_CONFLICT_RECOVERY_ACTION,
  WORKSPACE_MOVE_CONFIRMATION_ACTION,
  WORKSPACE_MOVE_CONSEQUENCE,
  workspaceToolErrorPayload,
} from "~~/lib/mcp/workspaceConnectionError";

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
    "This connection message cannot move an existing Codex connection. Create a reconnect message for the intended agent in RateLoop, then retry from the same task.",
  );
  assert.doesNotMatch(WORKSPACE_CONFLICT_RECOVERY_ACTION, /ws_|aci_|claim=|token|secret/iu);
  assert.doesNotMatch(WORKSPACE_CONFLICT_RECOVERY_ACTION, /delete|revoke|configuration/iu);
});

test("workspace moves disclose both consequences and the dual-consent sequence without identities", () => {
  assert.equal(
    WORKSPACE_MOVE_CONSEQUENCE,
    "Moving this Codex connection will disconnect it from its current RateLoop workspace and replace the selected agent’s previous connection.",
  );
  assert.match(WORKSPACE_MOVE_CONFIRMATION_ACTION, /user explicitly accepts/u);
  assert.match(WORKSPACE_MOVE_CONFIRMATION_ACTION, /workspace owner must then approve/u);
  assert.match(WORKSPACE_MOVE_CONFIRMATION_ACTION, /same privately preserved connection URL/u);
  for (const value of [WORKSPACE_MOVE_CONSEQUENCE, WORKSPACE_MOVE_CONFIRMATION_ACTION]) {
    assert.doesNotMatch(value, /ws_|agi_|aci_|claim=|token|secret/iu);
  }
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
