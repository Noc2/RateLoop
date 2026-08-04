import { WORKSPACE_API_KEY_SCOPES, WORKSPACE_API_KEY_SCOPE_DETAILS } from "./workspaceApiKeyScopes";
import assert from "node:assert/strict";
import test from "node:test";

test("workspace API key scopes all have task-language labels and explanations", () => {
  assert.deepEqual(WORKSPACE_API_KEY_SCOPES, [
    "panel:publish",
    "payment:submit",
    "result:read",
    "evaluation:read",
    "review:decide",
    "telemetry:write",
  ]);

  for (const scope of WORKSPACE_API_KEY_SCOPES) {
    const details = WORKSPACE_API_KEY_SCOPE_DETAILS[scope];
    assert.notEqual(details.label, scope);
    assert.match(details.label, /\S/);
    assert.match(details.description, /\S.+\S/);
  }
});
