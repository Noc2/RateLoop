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
  assert.match(messages, /rateloop.*rateloop-workspace/s);
  assert.match(messages, /same task with the original connection message/);
  assert.doesNotMatch(source, /create a new connection|paste.*link/i);
});
