import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("review policy UI leads with understandable presets and keeps tuning secondary", () => {
  const source = readFileSync(new URL("./AgentReviewPolicyPanel.tsx", import.meta.url), "utf8");

  assert.match(source, /Review everything/);
  assert.match(source, /Review higher-risk work/);
  assert.match(source, /Adaptive review/);
  assert.match(source, /Review a fixed percentage/);
  assert.match(source, /Review rate \(%\)/);
  assert.match(source, /fixedRateBps:/);
  assert.match(source, /Confidence-adjusted agreement threshold/);
  assert.match(source, /Manual handoff only/);
  assert.match(source, /Who should review\?/);
  assert.match(source, /Customize rules/);
  assert.match(source, /aria-pressed=\{draft\.mode === preset\.mode\}/);
  assert.match(source, /<details className="rounded-xl border border-white\/10 p-4">/);
  assert.doesNotMatch(source, /<option value="host_enforced">/);
  assert.doesNotMatch(source, /100% calibrating|50% high coverage|25% medium coverage|10% monitoring floor/);
  assert.match(source, /Edit as new version/);
  assert.match(source, /Technical details/);
  assert.match(source, /Set review for \$\{selectedTarget\.agentDisplayName\}/);
  assert.match(source, /Review behavior is already set for every active agent version/);
  assert.match(source, /existing policies remain visible for audit/);
  assert.match(source, /if \(loading && !registry\) return null/);
  assert.match(source, /reviewPolicySectionIsVisible\(registry\)/);
  assert.match(source, />\s*Retry\s*</);
  assert.doesNotMatch(source, /No review policy is active for these agent versions yet/);
});
