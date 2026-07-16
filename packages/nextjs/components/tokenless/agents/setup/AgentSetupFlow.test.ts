import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { agentSetupUrl } from "~~/lib/tokenless/agentSetupNavigation";

const flowSource = readFileSync(new URL("./AgentSetupFlow.tsx", import.meta.url), "utf8");
const progressSource = readFileSync(new URL("./AgentSetupProgress.tsx", import.meta.url), "utf8");
const startSource = readFileSync(new URL("./WorkspaceSetupStart.tsx", import.meta.url), "utf8");

test("setup uses one canonical URL and a focused workspace creation stage", () => {
  assert.equal(agentSetupUrl("ws one", "connect"), "/agents?workspace=ws%20one&step=connect");
  assert.match(startSource, /Name your workspace/);
  assert.match(startSource, /Step/);
  assert.match(startSource, /\/agents\?workspace=.*&step=connect/);
  assert.doesNotMatch(startSource, /billing|publishing|API key/i);
});

test("progress is semantic, textual, keyboard-operable, and marks only the current step", () => {
  assert.match(progressSource, /<nav aria-label="Workspace setup progress">/);
  assert.match(progressSource, /<ol/);
  assert.match(progressSource, /aria-current=\{stage\.key === currentStep \? "step" : undefined\}/);
  assert.match(progressSource, /"Complete"/);
  assert.match(progressSource, /"Current"/);
  assert.match(progressSource, /"Not started"/);
  assert.match(progressSource, /<button/);
});

test("guided setup renders one stage at a time and keeps future authority absent", () => {
  for (const heading of [
    "Workspace",
    "Connect your agent",
    "Name this workflow",
    "Set review behavior",
    "Add people and finish",
  ]) {
    assert.match(flowSource, new RegExp(heading));
  }
  assert.match(flowSource, /currentStep === "connect"/);
  assert.match(flowSource, /currentStep === "agent"/);
  assert.match(flowSource, /currentStep === "reviews"/);
  assert.match(flowSource, /currentStep === "people"/);
  assert.match(flowSource, /autonomousAccess: false/);
  assert.match(flowSource, /no autonomous publishing\s+or spending/i);
  assert.doesNotMatch(flowSource, /Audience policy binding|admission policy hash/i);
});

test("setup separates the connected client from per-run model provenance", () => {
  assert.match(flowSource, /connected client stays separate/i);
  assert.match(flowSource, /model, effort, and timing reported for each eligible run/i);
  assert.match(flowSource, /provider: "unknown"/);
  assert.match(flowSource, /model: "unknown"/);
  assert.doesNotMatch(flowSource, />Declared details</);
  assert.doesNotMatch(flowSource, />Provider</);
  assert.doesNotMatch(flowSource, />Model version</);
});

test("workspace step remains editable when revisited", () => {
  assert.match(flowSource, /htmlFor="agent-setup-workspace-name"/);
  assert.match(flowSource, /value=\{workspaceName\}/);
  assert.match(flowSource, /agent-setup\/workspace/);
  assert.match(flowSource, /Save and continue/);
});

test("connection polling cleans up timers and preserves explicit-navigation focus", () => {
  assert.match(flowSource, /document\.addEventListener\("visibilitychange"/);
  assert.match(flowSource, /document\.removeEventListener\("visibilitychange"/);
  assert.match(flowSource, /window\.clearTimeout/);
  assert.match(flowSource, /focusOnNavigation\.current/);
  assert.match(flowSource, /headingRef\.current\?\.focus\(\)/);
  assert.match(flowSource, /aria-live="polite"/);
});

test("invitation copy states that email binds the code but is not delivered", () => {
  assert.match(flowSource, /Bind code to recipient email/);
  assert.match(flowSource, /RateLoop does not send this email/);
  assert.match(flowSource, /Copy this invitation code now/);
});
