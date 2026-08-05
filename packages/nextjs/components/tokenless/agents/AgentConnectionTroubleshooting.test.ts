import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AgentConnectionTroubleshooting.tsx", import.meta.url), "utf8");
const messages = readFileSync(new URL("../../../messages/en/agents.json", import.meta.url), "utf8");

test("connection troubleshooting explains install-time OAuth and keeps recovery scoped", () => {
  assert.match(source, /<details/);
  assert.match(source, /<summary/);
  assert.match(source, /t\("summary"\)/);
  assert.match(source, /t\("body"\)/);
  assert.match(messages, /Authentication finished, but still waiting\?/);
  assert.match(messages, /New installs authorize RateLoop before the connection task starts/);
  assert.match(messages, /Authentication complete/);
  assert.match(messages, /should not need to type another message/);
  assert.match(messages, /still missing on a later turn and Codex offers no action/);
  assert.match(messages, /inspect the native plugin inventory once/);
  assert.match(messages, /install rateloop-workspace only if it is absent/);
  assert.match(messages, /already installed and enabled/);
  assert.match(messages, /preserve the task and original connection intent/);
  assert.match(messages, /follow only an action Codex actually presents/);
  assert.match(messages, /do not reinstall or uninstall plugins/);
  assert.match(messages, /do not.*start another login.*edit MCP configuration/s);
  assert.doesNotMatch(source, /create a new connection|paste.*link/i);
});
