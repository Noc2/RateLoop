import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("evaluation dashboard leads with results and progressively discloses detail", () => {
  const source = readFileSync(new URL("./EvaluationDashboardPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /dashboard\?\.runs\.length === 0/);
  assert.match(source, /No evaluations yet/);
  assert.match(source, /initialWorkspaceId/);
  assert.match(source, /showWorkspaceSelector/);
  assert.match(source, /Results appear after your agent requests human review\./);
  assert.match(source, /dashboard && dashboard\.runs\.length > 0/);
  assert.match(source, /decisionLabel\(run\.clientDecision\)/);
  assert.match(source, /Evidence and run details/);
  assert.match(source, /How results are shown/);
  assert.match(source, /Workspace evaluation details/);
  assert.match(source, /persisted responses, evidence packets, and client decisions/);
  assert.match(source, /does not create\s+a global agent ranking/);
  assert.match(source, /Small sample/);
  assert.match(source, /Result hidden until/);
  assert.doesNotMatch(source, /leaderboard|top agent|worst agent/i);
});
