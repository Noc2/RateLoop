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
  assert.match(source, /decisionLabel\(clientDecision\)/);
  assert.match(source, /Evidence and run details/);
  assert.match(source, /Calibration items/);
  assert.match(source, /Quorum-case unanimity/);
  assert.match(source, /Calibration failure rate/);
  assert.match(source, /Comparable-case drift/);
  assert.match(source, /Quality score variance \(percentage points²\)/);
  assert.match(source, /BigInt\(value\)/);
  assert.doesNotMatch(source, /rbtsScoreVarianceBps2 \/ 10_000/);
  assert.doesNotMatch(source, /bps²/);
  assert.match(source, /How results are shown/);
  assert.match(source, /Workspace evaluation details/);
  assert.match(source, /persisted responses, evidence packets, and client decisions/);
  assert.match(source, /does not create\s+a global agent ranking/);
  assert.match(source, /Small sample/);
  assert.match(source, /Result hidden until/);
  assert.match(source, /Assurance operations/);
  assert.match(source, /Sampling rate/);
  assert.match(source, /Mean verdict latency/);
  assert.match(source, /Disagreement rate/);
  assert.match(source, /Override rate/);
  assert.match(source, /Latest evidence anchor/);
  assert.doesNotMatch(source, /leaderboard|top agent|worst agent/i);
});

test("run cards submit go/revise/stop and record per-output overrides without a preselected choice", () => {
  const source = readFileSync(new URL("./EvaluationDashboardPanel.tsx", import.meta.url), "utf8");
  // Go/revise/stop write control: plain buttons, nothing preselected, wired to
  // the existing decision API and gated on a completed evidence-backed run.
  assert.match(source, /\["go", "revise", "stop"\] as const/);
  assert.match(source, /no choice is preselected/i);
  assert.match(source, /evidence\/decision/);
  assert.match(source, /run\.status === "completed" && run\.evidencePacketAvailable && !clientDecision/);
  assert.doesNotMatch(
    source,
    /defaultChecked|defaultValue=\{?"(go|revise|stop|accepted|disregarded|overridden|reversed)/,
  );
  // Per-output override record: four plain outcome buttons, mandatory reasons,
  // optional corrective action, append-only supersession semantics.
  assert.match(source, /\["accepted", "disregarded", "overridden", "reversed"\] as const/);
  assert.match(source, /evidence\/overrides/);
  assert.match(source, /Reasons \(required, 10-2000 characters\)/);
  assert.match(source, /Linked corrective action \(optional\)/);
  assert.match(source, /a new record supersedes, never edits/i);
  assert.match(source, /reasons\.trim\(\)\.length < 10/);
});
