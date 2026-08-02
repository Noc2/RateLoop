import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overview = readFileSync(new URL("./AgentOverviewMonitor.tsx", import.meta.url), "utf8");
const modelEvidence = readFileSync(new URL("./ModelEvidencePanel.tsx", import.meta.url), "utf8");

test("agent charts share theme-aware data colors with visible low-volume series", () => {
  for (const token of ["--rateloop-green", "--rateloop-pink", "--rateloop-yellow"]) {
    assert.match(overview, new RegExp(token));
  }
  assert.doesNotMatch(overview, /(?:fill|bg)-(?:emerald|rose|amber)-|bg-(?:success|warning)\//);

  assert.match(modelEvidence, /fillOpacity="0\.7"/);
  assert.match(modelEvidence, /bg-\[var\(--rateloop-blue\)\]\/70/);
  assert.match(modelEvidence, /bg-\[var\(--rateloop-green\)\]/);
  assert.match(modelEvidence, /bg-\[var\(--rateloop-pink\)\]/);
  assert.doesNotMatch(modelEvidence, /fillOpacity="0\.25"|bg-\[var\(--rateloop-blue\)\]\/25|bg-success\/|bg-rose-/);
});
