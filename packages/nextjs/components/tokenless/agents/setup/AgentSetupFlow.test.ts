import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { agentSetupUrl } from "~~/lib/tokenless/agentSetupNavigation";

const flowSource = readFileSync(new URL("./AgentSetupFlow.tsx", import.meta.url), "utf8");
const routingSource = readFileSync(new URL("../ReviewRoutingFields.tsx", import.meta.url), "utf8");
const progressSource = readFileSync(new URL("./AgentSetupProgress.tsx", import.meta.url), "utf8");
const choiceGroupSource = readFileSync(new URL("./SetupChoiceGroup.tsx", import.meta.url), "utf8");
const startSource = readFileSync(new URL("./WorkspaceSetupStart.tsx", import.meta.url), "utf8");
const actionBarSource = readFileSync(new URL("./SetupActionBar.tsx", import.meta.url), "utf8");
const stageHeaderSource = readFileSync(new URL("./SetupStageHeader.tsx", import.meta.url), "utf8");

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
  for (const heading of ["Workspace", "Connect your agent", "Name this workflow", "Set review behavior", "People"]) {
    assert.match(flowSource, new RegExp(heading));
  }
  assert.match(flowSource, /currentStep === "connect"/);
  assert.match(flowSource, /currentStep === "agent"/);
  assert.match(flowSource, /currentStep === "reviews"/);
  assert.match(flowSource, /currentStep === "people"/);
  assert.match(flowSource, /\/agents\/\$\{encodeURIComponent\(connectedAgent\.agentId\)\}\/human-review/);
  assert.match(flowSource, /expectedBindingVersion: draft\.bindingRevision/);
  assert.match(flowSource, /bindingRevision: Number\(ownerView\.bindingRevision\)/);
  assert.match(routingSource, /without creating or sending a request/i);
  assert.doesNotMatch(flowSource, /Audience policy binding|admission policy hash/i);
  assert.doesNotMatch(flowSource, /Deployment name/i);
});

test("review setup distinguishes a saved policy decision from delivery authority", () => {
  assert.doesNotMatch(flowSource, /mark an eligible output for human review/i);
  assert.doesNotMatch(flowSource, /This saves a review policy/i);
  assert.doesNotMatch(flowSource, /safe\s+connection does not send requests or pay reviewers/i);
  for (const label of ["Adaptive — Recommended", "Every output", "Fixed percentage", "Rules and conditions"]) {
    assert.match(routingSource, new RegExp(label));
  }
  assert.match(routingSource, /Manual handoff only/);
  assert.match(routingSource, /Never requires review automatically\. You start each handoff\./);
  assert.match(flowSource, /Minimum review rate \(%\)/);
  assert.match(flowSource, /Outputs reviewed \(%\)/);
  assert.match(flowSource, /Maximum outputs between reviews/);
  assert.match(flowSource, /Review these risk levels/);
  assert.match(flowSource, /Review below confidence \(%\)/);
  assert.match(flowSource, /buildReviewFrequencySelection\(draft\.selection, reviewFrequency\)/);
  assert.doesNotMatch(flowSource, /Choose when this agent should involve people/i);
  assert.doesNotMatch(flowSource, /reviewerAudience|contentBoundary: "private_workspace"/);
});

test("review setup resolves frequency before reviewer terms and authority", () => {
  assert.match(flowSource, /<ReviewFrequencyFields/);
  assert.match(flowSource, /<ReviewAuthorityFields/);
  assert.doesNotMatch(flowSource, /<ReviewRoutingFields/);
  assert.match(routingSource, /<select/);
  assert.match(routingSource, /sm:grid-cols-2/);
  assert.match(flowSource, /reviewFrequency\.mode === "adaptive" \|\| reviewFrequency\.mode === "fixed"/);
  assert.match(flowSource, /reviewFrequency\.mode === "rules"/);
  assert.match(flowSource, /mode === "manual"/);
  assert.match(flowSource, /authority: "check_only"/);
  assert.match(flowSource, /Reviewers, timing and payment/);
  assert.match(flowSource, /reviewerDetailsSummary/);
  const frequencyIndex = flowSource.indexOf("<ReviewFrequencyFields");
  const reviewerTermsIndex = flowSource.indexOf("Reviewers, timing and payment");
  const authorityIndex = flowSource.indexOf("<ReviewAuthorityFields");
  const actionIndex = flowSource.indexOf("<SetupActionBar>", authorityIndex);
  assert.ok(frequencyIndex < reviewerTermsIndex);
  assert.ok(reviewerTermsIndex < authorityIndex);
  assert.ok(authorityIndex < actionIndex);
  assert.match(choiceGroupSource, /surface-card-nested/);
  assert.match(choiceGroupSource, /min-h-16/);
  assert.doesNotMatch(choiceGroupSource, /#[\da-f]{3,8}/iu);
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
  for (const label of [
    "Who writes the question?",
    "Use one question",
    "Let the agent ask each time",
    "Review question",
    "Answer format",
    "Positive label",
    "Negative label",
    "Rationale",
  ]) {
    assert.match(flowSource, new RegExp(label));
  }
  assert.match(flowSource, /questionAuthority === "owner_fixed"/);
  assert.match(flowSource, /Agent-written questions collect feedback only/);
  assert.match(flowSource, /adaptiveAvailable=\{reviewCriterion\.questionAuthority !== "agent_per_request"\}/);
  assert.match(flowSource, /questionAuthority === "agent_per_request" && value !== "public_network"/);
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

test("review setup uses one duration control for the frozen response deadline", () => {
  assert.match(flowSource, /Review round/);
  assert.match(flowSource, /Response window/);
  assert.match(flowSource, /Reviewers per request/);
  assert.match(flowSource, /<DurationInput/);
  assert.match(flowSource, /valueSeconds=\{reviewTiming\.responseWindowSeconds\}/);
  assert.match(flowSource, /summarySuffix="Frozen when a request opens"/);
  assert.match(flowSource, /reviewAudience\.audience === "private_invited" \? 1 : 3/);
  assert.match(flowSource, /buildReviewTimingRequestProfile\(expertiseProfile, reviewTiming\)/);
  assert.doesNotMatch(flowSource, /Expected active review time|Effective-hourly guidance/);
  assert.doesNotMatch(flowSource, /slo\.estimatedSeconds/);
});

test("review setup defines specialist requirements and leaves pool coverage to People", () => {
  for (const label of [
    "Does this review need specialist knowledge?",
    "No specialist needed",
    "Require specialist knowledge",
    "Suggested for this workflow",
    "Examples",
    "Reviewers needed",
    "Define another specialist area",
    "What qualifies someone?",
  ]) {
    assert.match(flowSource, new RegExp(label.replace(/[?]/gu, "\\?")));
  }
  assert.match(flowSource, /reviewer-expertise\/definitions\?/);
  assert.match(flowSource, /method: "POST"/);
  assert.match(flowSource, /reviewExpertise\.requirements/);
  assert.match(flowSource, /Required for all.*network reviewers/);
  assert.doesNotMatch(flowSource, /reviewer-expertise\/eligibility/);
  assert.doesNotMatch(flowSource, /expertiseEligibilityStatus/);
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
    "Check only",
    "Prepare for approval",
    "Send automatically",
  ]) {
    assert.match(`${flowSource}\n${routingSource}`, new RegExp(label));
  }
  assert.match(flowSource, /Public and hybrid network assignments currently require a guaranteed bounty/);
  assert.match(flowSource, /reviewCompensation\.feedbackBonusEnabled/);
  assert.match(flowSource, /feedbackBonusAwarderKind/);
  assert.match(flowSource, /value=\{reviewCompensation\.usdcPerReviewer\}/);
  assert.match(flowSource, /authority=\{displayedReviewAuthority\}/);
  assert.match(flowSource, /const automaticGrantOffer = setup\.capabilities\.automaticGrantOffer/);
  assert.match(flowSource, /automaticAvailable=\{automaticAvailable\}/);
  assert.match(flowSource, /provision: "private_invited_unpaid"/);
  assert.match(flowSource, /allowedWorkflowKeys: automaticGrantOffer\.allowedWorkflowKeys/);
  assert.doesNotMatch(flowSource, /maxPanelAtomic|maxDailyAtomic|maxMonthlyAtomic|maxFeeBps/);
  assert.match(flowSource, /buildReviewCompensationConfiguration\(timingProfile, reviewCompensation\)/);
  assert.match(flowSource, /requestProfile: \{ \.\.\.requestProfile, privateGroupId \}/);
  assert.match(flowSource, /\s+authority,\s+/);
  assert.match(flowSource, /agent may prepare or fund this exact pool/i);
  assert.match(flowSource, /can never select or execute\s+an award/i);
  assert.doesNotMatch(flowSource, /authority: draft\.authority/);
});

test("setup reconciles automatic sending after its prerequisites and fails closed on the final profile", () => {
  assert.match(flowSource, /setupAutomaticSendingEligibility/);
  assert.match(flowSource, /reconcileSetupAutomaticAuthority/);
  assert.match(flowSource, /authority=\{displayedReviewAuthority\}/);
  assert.match(flowSource, /authorityAdjustmentNotice/);
  assert.match(flowSource, /changeReviewCompensationMode\("unpaid"\)/);
  assert.match(flowSource, /changeReviewCompensationMode\("usdc"\)/);
  assert.match(flowSource, /changeFeedbackBonus\(false\)/);
  assert.match(flowSource, /changeFeedbackBonus\(true\)/);
  assert.match(flowSource, /Automatic sending changed to Prepare for approval/);
  assert.match(flowSource, /Saving will change it to Prepare for approval/);
  assert.doesNotMatch(
    flowSource,
    /Setup can grant automatic delivery only for unpaid invited review without a feedback bonus/,
  );
  assert.match(flowSource, /const finalAutomaticEligibility = setupAutomaticSendingEligibility/);
  assert.match(flowSource, /requestProfile\.contentBoundary !== "private_workspace"/);
  assert.match(flowSource, /automaticGrantOffer\.allowedWorkflowKeys\.length === 0/);
  const finalEligibilityIndex = flowSource.indexOf("const finalAutomaticEligibility");
  assert.ok(finalEligibilityIndex < flowSource.indexOf("humanReviewConfirmationMessage", finalEligibilityIndex));
});

test("review save and wizard advance run as one retry-safe operation", () => {
  // AUD-14: the review save and the wizard advance must be a single retry-safe operation so a
  // partial failure adopts the authoritative binding version instead of stranding a stale one.
  assert.match(flowSource, /saveReviewConfigurationAndAdvance\(\{/);
  assert.match(flowSource, /putHumanReviewConfiguration: async \(\) =>/);
  assert.match(flowSource, /advanceSetup: async bindingRevision =>/);
  assert.match(flowSource, /reloadAuthoritativeSetup: async \(\) =>/);
  assert.match(flowSource, /adoptAuthoritativeSetup: authoritative =>/);
  assert.match(flowSource, /adoptBindingRevision: bindingRevision =>/);
  // Adopt must preserve in-progress edits by touching only bindingRevision.
  assert.match(flowSource, /reviewDraft: \{ \.\.\.current\.reviewDraft, bindingRevision \}/);
});

test("review setup saves directly and confirms only spending or automatic sending", () => {
  assert.match(flowSource, /humanReviewConfirmationMessage\(\{/);
  assert.match(flowSource, /authority,/);
  assert.match(flowSource, /bountyPerSeatAtomic:/);
  assert.match(flowSource, /feedbackBonusPoolAtomic:/);
  assert.match(flowSource, /panelSize: requestProfile\.panelSize/);
  assert.match(flowSource, /confirmation && !window\.confirm\(confirmation\)/);
  assert.match(flowSource, /Save and continue/);
  assert.doesNotMatch(flowSource, /Confirm these exact terms/);
  assert.doesNotMatch(flowSource, /I confirm this exact human-review configuration/);
  assert.doesNotMatch(flowSource, /pendingReviewConfirmation/);
  assert.doesNotMatch(flowSource, /confirmedReviewFingerprint/);
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

test("setup uses one branded stage header aligned to the progress width", () => {
  assert.equal(flowSource.match(/<SetupStageHeader/g)?.length, 6);
  assert.match(startSource, /<SetupStageHeader/);
  assert.match(stageHeaderSource, /font-display/);
  assert.match(stageHeaderSource, /text-3xl/);
  assert.match(stageHeaderSource, /AGENT_SETUP_STAGE_VISUALS/);
  assert.equal(flowSource.match(/<div className="mt-8 w-full">/g)?.length, 2);
  assert.match(startSource, /<form className="mt-8 w-full"/);
  assert.doesNotMatch(flowSource, /mx-auto mt-8 w-full|max-w-[234]xl/);
  assert.doesNotMatch(startSource, /mx-auto mt-8 w-full|max-w-[234]xl/);
  assert.doesNotMatch(stageHeaderSource, /max-w-/);
  assert.match(flowSource, /<SetupActionBar>\s*\{backButton\}\s*\{setup\.connection\.status/);
  assert.equal(flowSource.match(/\{backButton\}/g)?.length, 6);
});

test("setup uses one responsive action pattern and exposes busy forms", () => {
  assert.equal(flowSource.match(/<SetupActionBar/g)?.length, 6);
  assert.match(startSource, /<SetupActionBar>/);
  assert.match(actionBarSource, /flex-col/);
  assert.match(actionBarSource, /sm:flex-row/);
  assert.match(actionBarSource, /border-t/);
  assert.match(flowSource, /variant="secondary"/);
  assert.match(flowSource, /disabled=\{busy\}/);
  assert.equal(flowSource.match(/aria-busy=\{busy\}/g)?.length, 4);
  assert.match(startSource, /aria-busy=\{busy\}/);
  assert.doesNotMatch(flowSource, /className="rateloop-gradient-action px-5"/);
  assert.doesNotMatch(startSource, /<button className="rateloop-gradient-action/);
});

test("reviewer audience, timing, and payment stay visible in the review step", () => {
  assert.match(flowSource, /aria-labelledby="agent-setup-reviewer-details-heading"/);
  assert.match(flowSource, /id="agent-setup-reviewer-details-heading"/);
  assert.match(flowSource, /Reviewers, timing and payment/);
  assert.match(flowSource, /\{reviewerDetailsSummary\}/);
  assert.doesNotMatch(flowSource, /reviewDetailsRef|<details ref=\{reviewDetailsRef\}/);
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
  assert.match(flowSource, /<AgentConnectionTroubleshooting \/>/);
});

test("people and funding are conditional on the exact review audience and compensation", () => {
  assert.match(flowSource, /title="People"/);
  assert.match(flowSource, /requestProfile\.audience === "public_network"/);
  assert.match(flowSource, /name="decision" value="not_required"/);
  assert.match(flowSource, /No invitation is needed/);
  assert.match(flowSource, /requestProfile\.compensationMode === "usdc"/);
  assert.match(flowSource, /USDC per accepted reviewer/);
  assert.match(flowSource, /checked and reserved only when a request is prepared/);
  assert.doesNotMatch(flowSource, /RateLoop will still prepare the private group/);
});

test("invitation copy states that email binds the code but is not delivered", () => {
  assert.match(flowSource, /const \[peopleDecision, setPeopleDecision\]/);
  assert.match(flowSource, /checked=\{peopleDecision === "invited"\}/);
  assert.match(flowSource, /checked=\{peopleDecision === "later"\}/);
  assert.match(flowSource, /peopleDecision === "invited" \? \(/);
  assert.match(flowSource, /Bind code to recipient email/);
  assert.match(flowSource, /RateLoop does not send this email/);
  assert.match(flowSource, /Copy this invitation code now/);
  assert.match(flowSource, /copyInvitationCode/);
  assert.match(flowSource, /notifications\.success\("Invitation code copied to clipboard\."\)/);
  assert.match(flowSource, /Intended specialist areas/);
  assert.match(flowSource, /expertiseDefinitionIds/);
  assert.match(flowSource, /required=\{invitationExpertiseIds\.length > 0\}/);
  assert.doesNotMatch(flowSource, /defaultChecked/);
});

test("People finalizes setup once and reports operational request readiness", () => {
  assert.match(flowSource, /agent-setup\/finalize/);
  assert.match(flowSource, /idempotencyKey/);
  assert.match(flowSource, /crypto\.randomUUID\(\)/);
  assert.match(flowSource, /postcondition\.canSend/);
  assert.match(flowSource, /Automatic requests stay unavailable until enough reviewers join/);
  assert.match(flowSource, /Finish setup/);
  assert.doesNotMatch(flowSource, /agent-setup\/people/);
});

test("People shows confirmed and pending specialist coverage separately", () => {
  assert.match(flowSource, /Confirmed reviewers/);
  assert.match(flowSource, /group\?\.memberCount/);
  assert.match(flowSource, /confirmedReviewerPoolReady/);
  assert.match(flowSource, /Use confirmed reviewers/);
  assert.match(flowSource, /Specialist coverage/);
  assert.match(flowSource, /Pending invitations do not make a request ready/);
  assert.match(flowSource, /private-groups\/\$\{encodeURIComponent\(groupId\)\}\/expertise-coverage/);
  assert.match(flowSource, /coverage\.confirmedSeats/);
  assert.match(flowSource, /coverage\.pendingInvitationSeats/);
  assert.match(flowSource, /expertiseCoverage\.ready \? "Ready" : "Action required"/);
});
