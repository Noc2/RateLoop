import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("evaluation dashboard discloses provenance and sample-size limitations without global rankings", () => {
  const source = readFileSync(new URL("./EvaluationDashboardPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /persisted run responses, evidence packets, and client decisions/);
  assert.match(source, /does not create\s+a global agent ranking/);
  assert.match(source, /Unattributed: this run does not contain an immutable agent-version reference/);
  assert.match(source, /Small sample/);
  assert.match(source, /Preference cells are suppressed/);
  assert.match(source, /no demo scores are generated/);
  assert.doesNotMatch(source, /leaderboard|top agent|worst agent/i);
});
