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
  assert.match(flowSource, /\/agents\/\$\{encodeURIComponent\(connectedAgent\.agentId\)\}\/human-review/);
  assert.match(flowSource, /expectedBindingVersion: draft\.bindingRevision/);
  assert.match(flowSource, /bindingRevision: ownerView\.bindingRevision/);
  assert.match(flowSource, /no autonomous publishing\s+or spending/i);
  assert.doesNotMatch(flowSource, /Audience policy binding|admission policy hash/i);
});

test("review setup distinguishes a saved policy decision from delivery authority", () => {
  assert.match(flowSource, /mark an eligible output for human review/i);
  assert.match(flowSource, /This saves a review policy/i);
  assert.match(flowSource, /safe\s+connection does not send requests or pay reviewers/i);
  for (const label of [
    "Adaptive",
    "Every output",
    "Fixed percentage",
    "Rules and conditions",
    "Only after I approve",
  ]) {
    assert.match(flowSource, new RegExp(label));
  }
  assert.match(flowSource, /Minimum review rate \(%\)/);
  assert.match(flowSource, /Outputs reviewed \(%\)/);
  assert.match(flowSource, /Maximum outputs between reviews/);
  assert.match(flowSource, /Review these risk levels/);
  assert.match(flowSource, /Review below confidence \(%\)/);
  assert.match(flowSource, /buildReviewFrequencySelection\(draft\.selection, reviewFrequency\)/);
  assert.match(flowSource, /safe connection\s+does not assign or deliver work to reviewers/i);
  assert.doesNotMatch(flowSource, /Choose when this agent should involve people/i);
  assert.doesNotMatch(flowSource, /reviewerAudience|contentBoundary: "private_workspace"|autonomousAccess/);
});

test("review setup controls audience and shows only the relevant material boundary", () => {
  for (const label of [
    "Public network",
    "Invited reviewers",
    "Hybrid",
    "Private material sensitivity",
    "Internal",
    "Confidential",
    "Restricted",
    "Regulated",
  ]) {
    assert.match(flowSource, new RegExp(label));
  }
  assert.match(flowSource, /checked=\{reviewAudience\.audience === value\}/);
  assert.match(flowSource, /reviewAudience\.audience === "private_invited"/);
  assert.match(flowSource, /Public, synthetic, or safely redacted material only/);
  assert.match(flowSource, /Network reviewers are paid in USDC/);
  assert.match(flowSource, /buildReviewAudienceRequestProfile\(draft\.requestProfile, reviewAudience\)/);
  assert.match(flowSource, /privateClassificationsThrough\(reviewAudience\.privateSensitivity\)/);
  assert.match(flowSource, /audience === "public_network" \? null/);
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

test("workflow setup preserves the connected environment without asking the user to classify it", () => {
  assert.match(flowSource, /environment: connectedAgent\.environment/);
  assert.doesNotMatch(flowSource, /form\.get\("environment"\)/);
  assert.doesNotMatch(flowSource, />Environment</);
  assert.doesNotMatch(flowSource, /<option value="(?:production|staging)">/);
});

test("workspace step remains editable when revisited", () => {
  assert.match(flowSource, /htmlFor="agent-setup-workspace-name"/);
  assert.match(flowSource, /value=\{workspaceName\}/);
  assert.match(flowSource, /agent-setup\/workspace/);
  assert.match(flowSource, /Save and continue/);
});

test("setup content and navigation stay left-aligned with back before the primary action", () => {
  assert.match(flowSource, /<div className="mt-8 max-w-2xl">/);
  assert.doesNotMatch(flowSource, /mx-auto mt-8 max-w-2xl/);
  assert.match(
    flowSource,
    /<div className="mt-6 flex items-center gap-3">\s*\{backButton\}\s*\{setup\.connection\.status/,
  );
  assert.equal(flowSource.match(/\{backButton\}/g)?.length, 6);
});

test("connection polling cleans up timers and preserves explicit-navigation focus", () => {
  assert.match(flowSource, /document\.addEventListener\("visibilitychange"/);
  assert.match(flowSource, /document\.removeEventListener\("visibilitychange"/);
  assert.match(flowSource, /window\.clearTimeout/);
  assert.match(flowSource, /focusOnNavigation\.current/);
  assert.match(flowSource, /headingRef\.current\?\.focus\(\)/);
  assert.match(flowSource, /aria-live="polite"/);
});

test("connection creation keeps the complete message visible and confirms clipboard copies", () => {
  const exposeMessage = flowSource.indexOf("setConnectionMessage(message)");
  const automaticCopy = flowSource.indexOf("navigator.clipboard.writeText(message)");
  assert.ok(exposeMessage >= 0 && exposeMessage < automaticCopy);
  assert.match(flowSource, /id="agent-setup-connection-message"/);
  assert.match(flowSource, /value=\{connectionMessage\}/);
  assert.match(flowSource, /Copy message/);
  assert.match(flowSource, /notifications\.success\("Connection message copied to clipboard\."\)/);
  assert.match(flowSource, /notifications\.error\("Clipboard access was blocked\./);
});

test("invitation copy states that email binds the code but is not delivered", () => {
  assert.match(flowSource, /Bind code to recipient email/);
  assert.match(flowSource, /RateLoop does not send this email/);
  assert.match(flowSource, /Copy this invitation code now/);
  assert.match(flowSource, /copyInvitationCode/);
  assert.match(flowSource, /notifications\.success\("Invitation code copied to clipboard\."\)/);
});
