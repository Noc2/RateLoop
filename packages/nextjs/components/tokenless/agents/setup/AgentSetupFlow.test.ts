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
const messagesSource = readFileSync(new URL("../../../../messages/en/agents.json", import.meta.url), "utf8");
const localizedFlowSource = `${flowSource}\n${messagesSource}`;
const localizedRoutingSource = `${routingSource}\n${messagesSource}`;
const localizedProgressSource = `${progressSource}\n${messagesSource}`;
const localizedStartSource = `${startSource}\n${messagesSource}`;

test("setup uses one canonical URL and a focused workspace creation stage", () => {
  assert.equal(agentSetupUrl("ws one", "connect"), "/agents/connections?workspace=ws%20one&step=connect");
  assert.match(localizedStartSource, /Name your workspace/);
  assert.match(localizedStartSource, /Step/);
  assert.match(startSource, /\/agents\/connections\?workspace=.*&step=connect/);
  assert.doesNotMatch(startSource, /billing|publishing|API key/i);
});

test("progress is semantic, textual, keyboard-operable, and marks only the current step", () => {
  assert.match(progressSource, /<nav aria-label=\{t\("progress"\)\}>/);
  assert.match(progressSource, /<ol/);
  assert.match(progressSource, /aria-current=\{stage\.key === currentStep \? "step" : undefined\}/);
  assert.match(localizedProgressSource, /"Complete"/);
  assert.match(localizedProgressSource, /"Current"/);
  assert.match(localizedProgressSource, /"Not started"/);
  assert.match(progressSource, /<button/);
});

test("guided setup renders one stage at a time and keeps implementation details absent", () => {
  for (const heading of ["Workspace", "Connect your agent", "Name this workflow", "Set review behavior", "People"]) {
    assert.match(localizedFlowSource, new RegExp(heading));
  }
  assert.match(flowSource, /currentStep === "connect"/);
  assert.match(flowSource, /currentStep === "agent"/);
  assert.match(flowSource, /currentStep === "reviews"/);
  assert.match(flowSource, /currentStep === "people"/);
  assert.match(flowSource, /\/agents\/\$\{encodeURIComponent\(connectedAgent\.agentId\)\}\/human-review/);
  assert.match(flowSource, /expectedBindingVersion: draft\.bindingRevision/);
  assert.match(flowSource, /bindingRevision: Number\(ownerView\.bindingRevision\)/);
  assert.match(localizedRoutingSource, /without creating or sending a request/i);
  assert.doesNotMatch(flowSource, /Audience policy binding|admission policy hash/i);
  assert.doesNotMatch(flowSource, /Deployment name/i);
});

test("the connection stage links the setup guide without replacing its primary action", () => {
  const connectStage = flowSource.slice(
    flowSource.indexOf('currentStep === "connect"'),
    flowSource.indexOf('currentStep === "agent"'),
  );
  assert.match(connectStage, /href="\/docs\/connect"/);
  assert.match(connectStage, /<WorkspacePublicContentLink/);
  assert.match(localizedFlowSource, /Connection guide/);
  assert.doesNotMatch(connectStage, /target="_blank"|opens in a new tab/);
  assert.match(localizedFlowSource, /Create connection message/);
});

test("review setup distinguishes a saved policy decision from delivery authority", () => {
  assert.doesNotMatch(flowSource, /mark an eligible output for human review/i);
  assert.doesNotMatch(flowSource, /This saves a review policy/i);
  assert.doesNotMatch(flowSource, /safe\s+connection does not send requests or pay reviewers/i);
  for (const label of ["Every output — Recommended", "Adaptive", "Fixed percentage", "Rules and conditions"]) {
    assert.match(localizedRoutingSource, new RegExp(label));
  }
  assert.match(localizedRoutingSource, /Manual handoff only/);
  assert.match(localizedRoutingSource, /Never requires review automatically\. You start each handoff\./);
  assert.match(flowSource, /policyCopy\.limits\.adaptiveRate/);
  assert.match(flowSource, /disabled=\{reviewFrequency\.mode === "adaptive"\}/);
  assert.match(flowSource, /policyCopy\.limits\.fixedRate/);
  assert.match(flowSource, /policyCopy\.limits\.maximumGap/);
  assert.match(flowSource, /policyCopy\.limits\.riskTiers/);
  assert.match(flowSource, /policyCopy\.limits\.confidence/);
  assert.match(flowSource, /buildReviewFrequencySelection\(draft\.selection, reviewFrequency\)/);
  assert.doesNotMatch(flowSource, /Choose when this agent should involve people/i);
  assert.doesNotMatch(flowSource, /reviewerAudience|contentBoundary: "private_workspace"/);
});

test("review setup resolves frequency before reviewer terms and authority", () => {
  assert.match(flowSource, /<ReviewFrequencyFields/);
  assert.match(flowSource, /<ReviewAuthorityFields/);
  assert.doesNotMatch(flowSource, /<ReviewRoutingFields/);
  assert.match(routingSource, /<SelectField/);
  assert.doesNotMatch(routingSource, /<select\b/);
  assert.match(routingSource, /sm:grid-cols-2/);
  assert.match(flowSource, /reviewFrequency\.mode === "adaptive" \|\| reviewFrequency\.mode === "fixed"/);
  assert.match(flowSource, /reviewFrequency\.mode === "rules"/);
  assert.match(flowSource, /mode === "manual"/);
  assert.match(flowSource, /authority: "check_only"/);
  assert.match(localizedFlowSource, /Reviewers, timing and payment/);
  assert.match(flowSource, /reviewerDetailsSummary/);
  const frequencyIndex = flowSource.indexOf("<ReviewFrequencyFields");
  const reviewerTermsIndex = flowSource.indexOf('t("reviewerDetails")');
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
  assert.match(flowSource, /policyCopy\.audience\.rateLoopNetwork/);
  assert.match(flowSource, /policyCopy\.audience\.invited/);
  assert.match(localizedFlowSource, /private material/i);
  assert.match(flowSource, /checked=\{reviewAudience\.audience === value\}/);
  assert.doesNotMatch(flowSource, /Private material sensitivity/);
  assert.doesNotMatch(flowSource, /<option value="(?:internal|confidential|restricted|regulated)">/);
  assert.match(localizedFlowSource, /Public, synthetic, or safely redacted material only/);
  assert.match(localizedFlowSource, /Public and hybrid network assignments currently require a guaranteed bounty/);
  assert.match(flowSource, /buildReviewAudienceRequestProfile\(draft\.requestProfile, reviewAudience\)/);
  assert.match(flowSource, /privateClassificationsThrough\(reviewAudience\.privateSensitivity\)/);
  assert.match(flowSource, /audience === "public_network" \? null/);
});

test("review setup resumes a controlled question and compact answer format", () => {
  for (const label of ["Answer format"]) {
    assert.match(localizedFlowSource, new RegExp(label));
  }
  for (const path of [
    "question.authority",
    "question.ownerFixed",
    "question.agentPerRequest",
    "question.criterion",
    "question.positiveAnswer",
    "question.negativeAnswer",
    "question.rationale",
  ]) {
    assert.ok(flowSource.includes(`policyCopy.${path}`));
  }
  assert.match(flowSource, /questionAuthority === "owner_fixed"/);
  assert.match(flowSource, /policyCopy\.question\.agentWrittenNote/);
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
  assert.match(localizedFlowSource, /Review round/);
  assert.match(flowSource, /policyCopy\.timing\.responseWindow/);
  assert.match(flowSource, /policyCopy\.timing\.panelSize/);
  assert.match(flowSource, /<DurationInput/);
  assert.match(flowSource, /valueSeconds=\{reviewTiming\.responseWindowSeconds\}/);
  assert.match(flowSource, /summarySuffix=\{t\("frozenWhenOpen"\)\}/);
  assert.match(flowSource, /reviewAudience\.audience === "private_invited" \? MIN_REVIEW_PANEL_SIZE : 3/);
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
    assert.match(localizedFlowSource, new RegExp(label.replace(/[?]/gu, "\\?")));
  }
  assert.match(flowSource, /reviewer-expertise\/definitions\?/);
  assert.match(flowSource, /method: "POST"/);
  assert.match(flowSource, /reviewExpertise\.requirements/);
  assert.match(localizedFlowSource, /Required for all/);
  assert.match(localizedFlowSource, /network reviewers/);
  assert.doesNotMatch(flowSource, /reviewer-expertise\/eligibility/);
  assert.doesNotMatch(flowSource, /expertiseEligibilityStatus/);
});

test("review setup keeps governed compensation experiments behind the shared capability", () => {
  for (const label of ["Check only", "Prepare for approval", "Send automatically"]) {
    assert.match(`${flowSource}\n${localizedRoutingSource}`, new RegExp(label));
  }
  for (const path of [
    "payment.bounty",
    "payment.noBounty",
    "payment.addBounty",
    "payment.bountyPerReviewer",
    "payment.feedbackBonus",
    "payment.noBonus",
    "payment.addBonus",
    "payment.bonusPool",
    "payment.awarder",
  ]) {
    assert.ok(flowSource.includes(`policyCopy.${path}`));
  }
  assert.match(localizedFlowSource, /Public and hybrid network assignments currently require a guaranteed bounty/);
  assert.match(flowSource, /<InfoPopover label=\{t\("aboutBonus"\)\}>/);
  assert.match(localizedFlowSource, /Optional and separate from the guaranteed bounty/);
  assert.match(localizedFlowSource, /A human later chooses useful written feedback to pay/);
  assert.match(flowSource, /reviewCompensation\.feedbackBonusEnabled/);
  assert.match(flowSource, /const feedbackBonusAvailable = configuredHumanReviewMutationCapability\(/);
  assert.match(flowSource, /\{feedbackBonusAvailable \? \(/);
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
  assert.match(localizedFlowSource, /agent may prepare or fund this exact pool/i);
  assert.match(localizedFlowSource, /can never select or execute\s+an award/i);
  assert.doesNotMatch(flowSource, /authority: draft\.authority/);
});

test("setup reconciles automatic sending after its prerequisites and fails closed on the final profile", () => {
  assert.match(flowSource, /setupAutomaticSendingEligibility/);
  assert.match(flowSource, /reconcileSetupAutomaticAuthority/);
  assert.match(flowSource, /authority=\{displayedReviewAuthority\}/);
  assert.match(flowSource, /authorityAdjustmentNotice/);
  assert.match(flowSource, /changeReviewCompensationMode\("unpaid"\)/);
  assert.match(flowSource, /changeReviewCompensationMode\("usdc"\)/);
  assert.match(flowSource, /changeFeedbackBonus\(value === "enabled"\)/);
  assert.match(localizedFlowSource, /Automatic sending changed to Prepare for approval/);
  assert.match(localizedFlowSource, /Saving will change it to Prepare for approval/);
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
  assert.match(flowSource, /humanReviewConfirmationMessage\(\s*\{/);
  assert.match(flowSource, /authority,/);
  assert.match(flowSource, /bountyPerSeatAtomic:/);
  assert.match(flowSource, /feedbackBonusPoolAtomic:/);
  assert.match(flowSource, /panelSize: requestProfile\.panelSize/);
  assert.match(flowSource, /title: policyCopy\.confirmation\.title/);
  assert.match(flowSource, /description: confirmation/);
  assert.match(flowSource, /confirmLabel: policyCopy\.confirmation\.action/);
  assert.doesNotMatch(flowSource, /window\.confirm/);
  assert.match(localizedFlowSource, /Save and continue/);
  assert.doesNotMatch(flowSource, /Confirm these exact terms/);
  assert.doesNotMatch(flowSource, /I confirm this exact human-review configuration/);
  assert.doesNotMatch(flowSource, /pendingReviewConfirmation/);
  assert.doesNotMatch(flowSource, /confirmedReviewFingerprint/);
});

test("setup does not collect per-run model provenance from the connected client", () => {
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
  assert.match(flowSource, /id="agent-setup-workspace-name"/);
  assert.match(flowSource, /label=\{t\("workspaceName"\)\}/);
  assert.match(flowSource, /value=\{workspaceName\}/);
  assert.match(flowSource, /agent-setup\/workspace/);
  assert.match(localizedFlowSource, /Save and continue/);
});

test("setup applies shared fields and preserves server field errors across editable stages", () => {
  assert.ok((flowSource.match(/<Field/g)?.length ?? 0) >= 12);
  assert.match(flowSource, /const \{ capture: captureFormError, clear: clearFormErrors, fieldErrors, formError \}/);
  assert.match(flowSource, /typeof body\.field === "string" \? body\.field : null/);
  assert.match(flowSource, /captureFormError\(completion\("saveReviews"\), completion\("saveReviews"\)\)/);
  // Only these five field names are ever returned as `field` by the agent-setup API, so a binding
  // for any other name is a control that can never show an error. Keep the wiring honest: the
  // rendered behaviour of these bindings is covered by AgentSetupFlow.interaction.test.tsx.
  assert.deepEqual([...new Set([...flowSource.matchAll(/fieldErrors\.([A-Za-z]+)/g)].map(match => match[1]))].sort(), [
    "description",
    "displayName",
    "intendedEmail",
    "intendedEmailDomain",
    "name",
  ]);
  assert.doesNotMatch(flowSource, /fieldErrors\[/);
});

test("setup uses one stage header aligned to the progress width without repeating progress metadata", () => {
  assert.equal(flowSource.match(/<SetupStageHeader/g)?.length, 6);
  assert.match(startSource, /<SetupStageHeader/);
  assert.match(stageHeaderSource, /font-display/);
  assert.match(stageHeaderSource, /text-3xl/);
  assert.doesNotMatch(stageHeaderSource, /AGENT_SETUP_STAGE_VISUALS|AGENT_SETUP_STAGE_LABELS|\/ 05/);
  assert.doesNotMatch(flowSource, /<SetupStageHeader[^>]*\bstep=/);
  assert.doesNotMatch(startSource, /<SetupStageHeader[^>]*\bstep=/);
  for (const subtitle of [
    "Use a team or project name. You can change it later.",
    "Copy one message into the agent chat. RateLoop continues here after verification.",
    "The connected client stays separate from the model, effort, and timing reported for each eligible run.",
    "Choose when this workflow needs human review. Nothing is sent or charged during setup.",
    "Invite reviewers and check that required specialist seats are covered.",
  ]) {
    assert.doesNotMatch(`${flowSource}\n${startSource}`, new RegExp(subtitle.replace(/[.]/gu, "\\.")));
  }
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
  assert.match(localizedFlowSource, /Reviewers, timing and payment/);
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
  assert.match(localizedFlowSource, /Copy message/);
  assert.match(flowSource, /notifications\.success\(t\("connectionMessageCopied"\)\)/);
  assert.match(flowSource, /notifications\.error\(t\("connectionMessageCopyBlocked"\)\)/);
  assert.match(flowSource, /<AgentConnectionTroubleshooting \/>/);
});

test("people and funding are conditional on the exact review audience and compensation", () => {
  assert.match(flowSource, /title=\{t\("people"\)\}/);
  assert.match(flowSource, /requestProfile\.audience === "public_network"/);
  assert.match(flowSource, /name="decision" value="not_required"/);
  assert.match(localizedFlowSource, /No invitation is needed/);
  assert.match(flowSource, /requestProfile\.compensationMode === "usdc"/);
  assert.match(localizedFlowSource, /USDC per accepted reviewer/);
  assert.match(localizedFlowSource, /checked and reserved only when a request is prepared/);
  assert.doesNotMatch(flowSource, /RateLoop will still prepare the private group/);
});

test("invitation copy states that an email-bound link is delivered", () => {
  assert.match(flowSource, /const \[peopleDecision, setPeopleDecision\]/);
  assert.match(flowSource, /checked=\{peopleDecision === "invited" && !sharedInvitation\}/);
  assert.match(flowSource, /checked=\{peopleDecision === "later"\}/);
  assert.match(flowSource, /peopleDecision === "invited" \? \(/);
  assert.match(localizedFlowSource, /Invite one person/);
  assert.match(localizedFlowSource, /Bind code to recipient email/);
  assert.match(localizedFlowSource, /RateLoop sends the personal invitation link/);
  assert.match(localizedFlowSource, /Copy this invitation link now/);
  assert.match(flowSource, /issuedInvitationCapacity/);
  assert.match(flowSource, /copyInvitationLink/);
  assert.match(flowSource, /notifications\.success\(t\("invitationCopied"\)\)/);
  assert.match(localizedFlowSource, /Intended specialist areas/);
  assert.match(flowSource, /expertiseDefinitionIds/);
  assert.match(flowSource, /required=\{invitationExpertiseIds\.length > 0\}/);
  assert.doesNotMatch(flowSource, /defaultChecked/);
});

test("People offers a bounded shared code without recipient-specific specialist claims", () => {
  assert.match(flowSource, /const \[sharedInvitation, setSharedInvitation\]/);
  assert.match(flowSource, /missingReviewerSeats >= 2/);
  assert.match(localizedFlowSource, /Invite several people/);
  assert.match(flowSource, /name="maximumRedemptions"/);
  assert.match(flowSource, /min=\{2\}/);
  assert.match(flowSource, /max=\{missingReviewerSeats\}/);
  assert.match(flowSource, /name="intendedEmailDomain"/);
  assert.match(localizedFlowSource, /Verified email domain/);
  assert.match(localizedFlowSource, /Anyone with this code can claim one place/);
  assert.match(localizedFlowSource, /Revoking the code stops future joins but does not remove existing members/);
  assert.match(localizedFlowSource, /creates reviewer memberships only/);
  assert.match(flowSource, /const creatingSharedInvitation = decision === "invited" && sharedInvitation/);
  assert.match(flowSource, /intendedEmail: creatingSharedInvitation \? null/);
  assert.match(flowSource, /intendedEmailDomain: creatingSharedInvitation/);
  assert.match(flowSource, /maximumRedemptions: creatingSharedInvitation/);
  assert.match(flowSource, /decision === "invited" && !creatingSharedInvitation \? invitationExpertiseIds : \[\]/);
});

test("People finalizes setup once and reports operational request readiness", () => {
  assert.match(flowSource, /agent-setup\/finalize/);
  assert.match(flowSource, /idempotencyKey/);
  assert.match(flowSource, /crypto\.randomUUID\(\)/);
  assert.match(flowSource, /postcondition\.canSend/);
  assert.match(localizedFlowSource, /Automatic requests stay unavailable until enough reviewers join/);
  assert.match(localizedFlowSource, /Finish setup/);
  assert.match(flowSource, /url\.searchParams\.delete\("step"\)/);
  assert.match(flowSource, /router\.replace\(`\$\{url\.pathname\}\$\{url\.search\}`\)/);
  assert.doesNotMatch(flowSource, /window\.location\.assign\(destination\)/);
  assert.doesNotMatch(flowSource, /agent-setup\/people/);
});

test("People shows confirmed and pending specialist coverage separately", () => {
  assert.match(localizedFlowSource, /Confirmed reviewers/);
  assert.match(flowSource, /group\?\.memberCount/);
  assert.match(flowSource, /confirmedReviewerPoolReady/);
  assert.match(localizedFlowSource, /Use confirmed reviewers/);
  assert.match(localizedFlowSource, /Specialist coverage/);
  assert.match(localizedFlowSource, /Pending invitations do not make a request ready/);
  assert.match(flowSource, /private-groups\/\$\{encodeURIComponent\(groupId\)\}\/expertise-coverage/);
  assert.match(flowSource, /coverage\.confirmedSeats/);
  assert.match(flowSource, /coverage\.pendingInvitationSeats/);
  assert.match(flowSource, /expertiseCoverage\.ready \? t\("ready"\) : t\("actionRequired"\)/);
});
