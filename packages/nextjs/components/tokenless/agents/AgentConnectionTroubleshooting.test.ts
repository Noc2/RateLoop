import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AgentConnectionTroubleshooting.tsx", import.meta.url), "utf8");

test("connection troubleshooting distinguishes OAuth from verification and keeps recovery scoped", () => {
  assert.match(source, /<details/);
  assert.match(source, /<summary/);
  assert.match(source, /Authentication finished, but still waiting\?/);
  assert.match(source, /Authentication complete.*Codex finished OAuth/s);
  assert.match(source, /not that RateLoop verified the workspace/);
  assert.match(source, /still missing on a later turn and Codex offers no action/);
  assert.match(source, /rateloop.*rateloop-workspace/s);
  assert.match(source, /same\s+task with the original connection message/);
  assert.doesNotMatch(source, /create a new connection|paste.*link/i);
});
