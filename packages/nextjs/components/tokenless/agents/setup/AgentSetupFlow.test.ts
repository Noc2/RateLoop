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

test("guided setup renders one stage at a time and keeps implementation details absent", () => {
  for (const heading of [
    "Workspace",
    "Connect your agent",
    "Name this workflow",
    "Set review behavior",
    "People and funding",
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
  assert.match(flowSource, /do not prepare, send, or spend/i);
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
  assert.match(flowSource, /No request is published and no funds are spent during setup/i);
  assert.doesNotMatch(flowSource, /Choose when this agent should involve people/i);
  assert.doesNotMatch(flowSource, /reviewerAudience|contentBoundary: "private_workspace"|autonomousAccess/);
});

test("review setup controls audience and shows only the relevant material boundary", () => {
  for (const label of ["Public network", "Invited reviewers", "Hybrid", "private workspace material"]) {
    assert.match(flowSource, new RegExp(label));
  }
  assert.match(flowSource, /checked=\{reviewAudience\.audience === value\}/);
  assert.doesNotMatch(flowSource, /Private material sensitivity/);
  assert.doesNotMatch(flowSource, /<option value="(?:internal|confidential|restricted|regulated)">/);
  assert.match(flowSource, /Public, synthetic, or safely redacted material only/);
  assert.match(flowSource, /Public and hybrid network assignments currently require a guaranteed bounty/);
  assert.match(flowSource, /buildReviewAudienceRequestProfile\(draft\.requestProfile, reviewAudience\)/);
  assert.match(flowSource, /privateClassificationsThrough\(reviewAudience\.privateSensitivity\)/);
  assert.match(flowSource, /audience === "public_network" \? null/);
});

test("review setup resumes a controlled question and compact answer format", () => {
  for (const label of ["Review question", "Answer format", "Positive label", "Negative label", "Rationale"]) {
    assert.match(flowSource, new RegExp(label));
  }
  for (const option of ["off", "optional", "required"]) {
    assert.match(flowSource, new RegExp(`<option value="${option}">`, "u"));
  }
  assert.match(flowSource, /value=\{reviewCriterion\.criterion\}/);
  assert.match(flowSource, /value=\{reviewCriterion\.positiveLabel\}/);
  assert.match(flowSource, /value=\{reviewCriterion\.negativeLabel\}/);
  assert.match(flowSource, /value=\{reviewCriterion\.rationaleMode\}/);
  assert.match(flowSource, /maxLength=\{REVIEW_CRITERION_MAX_LENGTH\}/);
  assert.match(flowSource, /maxLength=\{REVIEW_ANSWER_LABEL_MAX_LENGTH\}/);
  assert.match(flowSource, /buildReviewCriterionRequestProfile\(audienceProfile, reviewCriterion\)/);
  assert.doesNotMatch(flowSource, /form\.get\("(?:criterion|positiveLabel|negativeLabel|rationaleMode)"\)/);
});

test("review setup uses duration controls for the frozen deadline and separate active-effort guidance", () => {
  assert.match(flowSource, /Review round/);
  assert.match(flowSource, /Response window/);
  assert.match(flowSource, /Reviewers per request/);
  assert.match(flowSource, /<DurationInput/);
  assert.match(flowSource, /valueSeconds=\{reviewTiming\.responseWindowSeconds\}/);
  assert.match(flowSource, /Expected active review time/);
  assert.match(flowSource, /valueSeconds=\{reviewTiming\.expectedEffortSeconds \?\? "600"\}/);
  assert.match(flowSource, /summarySuffix="Frozen when a request opens"/);
  assert.match(flowSource, /reviewAudience\.audience === "private_invited" \? 1 : 3/);
  assert.match(flowSource, /buildReviewTimingRequestProfile\(expertiseProfile, reviewTiming\)/);
  assert.doesNotMatch(flowSource, /slo\.estimatedSeconds/);
});

test("review setup fails closed while a changed expertise pool is being checked", () => {
  const reset = flowSource.indexOf("setExpertiseEligibility(null)");
  const request = flowSource.indexOf("/reviewer-expertise/eligibility?");
  assert.ok(reset >= 0 && request > reset);
  assert.match(flowSource, /requiredExpertiseKeys\.length === 0/);
  assert.match(flowSource, /expertiseEligibility\?\.key === expertiseEligibilityKey/);
  assert.match(flowSource, /setExpertiseEligibility\(\{ key: expertiseEligibilityKey, value \}\)/);
  assert.match(flowSource, /if \(!expertiseEligibilityStatus\.feasible\)/);
});

test("review setup controls independent base compensation, optional Feedback Bonus, and agent authority", () => {
  for (const label of [
    "Guaranteed bounty",
    "No bounty",
    "Add USDC bounty",
    "USDC per reviewer",
    "Feedback Bonus",
    "No bonus",
    "Add bonus",
    "Bonus pool",
    "Human awarder",
    "Agent authority",
    "Check only",
    "Prepare for approval",
    "Ask automatically",
  ]) {
    assert.match(flowSource, new RegExp(label));
  }
  assert.match(flowSource, /Public and hybrid network assignments currently require a guaranteed bounty/);
  assert.match(flowSource, /reviewCompensation\.feedbackBonusEnabled/);
  assert.match(flowSource, /feedbackBonusAwarderKind/);
  assert.match(flowSource, /value=\{reviewCompensation\.usdcPerReviewer\}/);
  assert.match(flowSource, /checked=\{reviewCompensation\.authority === value\}/);
  assert.match(flowSource, /buildReviewCompensationConfiguration\(timingProfile, reviewCompensation\)/);
  assert.match(flowSource, /requestProfile: \{ \.\.\.requestProfile, privateGroupId \}/);
  assert.match(flowSource, /\s+authority,\s+/);
  assert.match(flowSource, /agent may prepare or fund this exact pool/i);
  assert.match(flowSource, /can never select or execute\s+an award/i);
  assert.doesNotMatch(flowSource, /authority: draft\.authority/);
});

test("review setup requires exact informed consent before it persists the configuration", () => {
  for (const label of [
    "Confirm these exact terms",
    "When",
    "Who and what",
    "Question",
    "Answers",
    "Round",
    "Base payment",
    "Feedback Bonus",
    "Maximum payment consent",
    "Agent authority",
    "I confirm this exact human-review configuration",
  ]) {
    assert.match(flowSource, new RegExp(label));
  }
  assert.match(flowSource, /pendingReviewConfirmation\?\.fingerprint !== currentReviewFingerprint/);
  assert.match(flowSource, /confirmedReviewFingerprint !== currentReviewFingerprint/);
  assert.match(flowSource, /Review settings/);
  assert.match(flowSource, /Save and continue/);
  assert.match(flowSource, /reviewFrequencySummary\(pendingReviewConfirmation\.selection\)/);
  assert.match(flowSource, /reviewAudienceSummary\(pendingReviewConfirmation\.requestProfile\.audience\)/);
  assert.match(flowSource, /formatResponseWindow\(pendingReviewConfirmation\.requestProfile\.responseWindowSeconds\)/);
  assert.match(flowSource, /usdcAtomicToDecimal\(pendingReviewConfirmation\.requestProfile\.bountyPerSeatAtomic\)/);
  assert.match(flowSource, /reviewAuthoritySummary\(pendingReviewConfirmation\.authority\)/);
  assert.match(flowSource, /pendingReviewConfirmation\.requestProfile\.feedbackBonusPoolAtomic/);
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

test("people and funding are conditional on the exact review audience and compensation", () => {
  assert.match(flowSource, /People and funding/);
  assert.match(flowSource, /requestProfile\.audience === "public_network"/);
  assert.match(flowSource, /name="decision" value="not_required"/);
  assert.match(flowSource, /No invitation is needed/);
  assert.match(flowSource, /requestProfile\.compensationMode === "usdc"/);
  assert.match(flowSource, /USDC per accepted reviewer/);
  assert.match(flowSource, /checked and reserved only when a request is prepared/);
  assert.doesNotMatch(flowSource, /RateLoop will still prepare the private group/);
});

test("invitation copy states that email binds the code but is not delivered", () => {
  assert.match(flowSource, /Bind code to recipient email/);
  assert.match(flowSource, /RateLoop does not send this email/);
  assert.match(flowSource, /Copy this invitation code now/);
  assert.match(flowSource, /copyInvitationCode/);
  assert.match(flowSource, /notifications\.success\("Invitation code copied to clipboard\."\)/);
});
