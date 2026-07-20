import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AgentConnectionTroubleshooting.tsx", import.meta.url), "utf8");

test("connection troubleshooting explains install-time OAuth and keeps recovery scoped", () => {
  assert.match(source, /<details/);
  assert.match(source, /<summary/);
  assert.match(source, /Authentication finished, but still waiting\?/);
  assert.match(source, /New installs authorize RateLoop before the connection task starts/);
  assert.match(source, /Authentication complete/);
  assert.match(source, /should not need to type\s+another\s+message/);
  assert.match(source, /still missing on a later turn and Codex offers no\s+action/);
  assert.match(source, /rateloop.*rateloop-workspace/s);
  assert.match(source, /same\s+task with the\s+original\s+connection\s+message/);
  assert.doesNotMatch(source, /create a new connection|paste.*link/i);
});
