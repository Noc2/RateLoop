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
  assert.match(source, /AdaptiveCoverageSummary/);
  assert.match(source, /<AdaptiveCoverageSummary agents=\{dashboard\.agents\}/);
  assert.doesNotMatch(source, /leaderboard|top agent|worst agent/i);
});

test("completed runs expose an oversight case detail that respects lane boundaries", () => {
  const source = readFileSync(new URL("./EvaluationDashboardPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /Case detail \(oversight\)/);
  // Lazy fetch through the dedicated access-checked endpoint.
  assert.match(source, /\/cases`/);
  assert.match(source, /onToggle=\{event => event\.currentTarget\.open && void load\(\)\}/);
  // Denied and aggregate-only outcomes stay explained, never silently empty.
  assert.match(source, /owners, admins, and designated decision owners/);
  assert.match(source, /view && !view\.detailAvailable/);
  assert.match(source, /\{view\.note\}/);
  // Material renders via the existing lease/encryption artifact route.
  assert.match(source, /assurance\/projects\/\$\{encodeURIComponent\(view\.projectId\)\}\/artifacts\//);
  assert.match(source, /reviewerPseudonym/);
  assert.match(source, /dissent/);
  assert.match(source, /Override history/);
  assert.match(source, /No workspace-owned rationale for this response\./);
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

test("anti-rubber-stamping: signals sit above every decision control and nothing is preselected", () => {
  const source = readFileSync(new URL("./EvaluationDashboardPanel.tsx", import.meta.url), "utf8");
  // Signals block: disagreement, gold/mechanism health, and evidence age.
  assert.match(source, /Before you decide/);
  assert.match(source, /Reviewer dissent/);
  assert.match(source, /Calibration failure rate/);
  assert.match(source, /Quorum-case unanimity/);
  assert.match(source, /Time since evidence/);
  // The signals render before the go/revise/stop buttons and before the
  // override outcome buttons in source order.
  const decisionRegion = source.slice(source.indexOf("{decidable ? ("));
  assert.ok(decisionRegion.indexOf("<DecisionSignals") < decisionRegion.indexOf("<ClientDecisionButtons"));
  const overrideForm = source.slice(source.indexOf("function OverrideRecordForm"));
  assert.ok(overrideForm.indexOf("<DecisionSignals") < overrideForm.indexOf("OVERRIDE_OUTCOMES.map"));
  // Sampled explain-this-decision prompt: reasons required even for go, and
  // the buttons stay disabled until the explanation exists.
  assert.match(source, /run\.explanationRequired/);
  assert.match(source, /Explain this decision/);
  assert.match(source, /even for go/);
  assert.match(source, /explanationMissing = run\.explanationRequired && note\.trim\(\)\.length < 10/);
  assert.match(source, /disabled=\{busy \|\| explanationMissing\}/);
  // The decider's own trend shows beside both forms.
  assert.match(source, /deciderTrendLabel/);
  assert.match(source, /You chose go on/);
  assert.match(source, /you accepted/);
  assert.match(source, /trend=\{dashboard\.deciderTrend\}/);
  // Nothing anywhere is preselected.
  assert.doesNotMatch(source, /defaultChecked|checked=\{true\}|aria-pressed=\{true\}/);
  assert.doesNotMatch(source, /defaultValue=\{?"(go|revise|stop|accepted|disregarded|overridden|reversed)/);
  assert.doesNotMatch(source, /<option[^>]*selected/);
});
