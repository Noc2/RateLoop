import { reviewPolicyCopy } from "./reviewPolicyCopy";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editorSource = readFileSync(new URL("./AgentHumanReviewEditor.tsx", import.meta.url), "utf8");
const setupSource = readFileSync(new URL("./setup/AgentSetupFlow.tsx", import.meta.url), "utf8");
const criterionSource = readFileSync(new URL("./setup/reviewCriterion.ts", import.meta.url), "utf8");
const timingSource = readFileSync(new URL("./setup/reviewTiming.ts", import.meta.url), "utf8");
const compensationSource = readFileSync(new URL("./setup/reviewCompensation.ts", import.meta.url), "utf8");

const sharedCopyPaths = [
  "question.authority",
  "question.ownerFixed",
  "question.agentPerRequest",
  "question.criterion",
  "question.positiveAnswer",
  "question.negativeAnswer",
  "question.rationale",
  "question.rationaleOff",
  "question.rationaleOptional",
  "question.rationaleRequired",
  "question.agentWrittenNote",
  "limits.adaptiveRate",
  "limits.fixedRate",
  "limits.maximumGap",
  "limits.riskTiers",
  "limits.confidence",
  "audience.label",
  "audience.invited",
  "audience.rateLoopNetwork",
  "timing.responseWindow",
  "timing.panelSize",
  "payment.bounty",
  "payment.noBounty",
  "payment.addBounty",
  "payment.bountyPerReviewer",
  "payment.feedbackBonus",
  "payment.noBonus",
  "payment.addBonus",
  "payment.bonusPool",
  "payment.awarder",
  "payment.requester",
  "payment.designated",
  "payment.awarderAccount",
  "confirmation.title",
  "confirmation.action",
] as const;

test("setup and review setup render the same canonical policy copy", () => {
  assert.match(setupSource, /const policyCopy = useLocalizedReviewPolicyCopy\(\)/u);
  assert.match(editorSource, /const policyCopy = useLocalizedReviewPolicyCopy\(\)/u);
  for (const path of sharedCopyPaths) {
    const reference = `policyCopy.${path}`;
    assert.ok(setupSource.includes(reference), `setup must use ${reference}`);
    assert.ok(editorSource.includes(reference), `review setup must use ${reference}`);
  }

  assert.equal(reviewPolicyCopy.question.rationale, "Reviewer explanation");
  assert.equal(reviewPolicyCopy.payment.bountyPerReviewer, "USDC per accepted reviewer");
  assert.equal(reviewPolicyCopy.timing.panelSize, "Reviewers per request");
  assert.equal(reviewPolicyCopy.timing.responseWindow, "Response window");
  assert.equal(reviewPolicyCopy.audience.rateLoopNetwork, "RateLoop network");
});

test("canonical field names also drive setup and review-setup validation", () => {
  for (const source of [criterionSource, timingSource, compensationSource]) {
    assert.match(source, /reviewPolicyCopy\./);
  }
  assert.match(criterionSource, /reviewPolicyCopy\.question\.criterion/);
  assert.match(criterionSource, /reviewPolicyCopy\.question\.positiveAnswer/);
  assert.match(criterionSource, /reviewPolicyCopy\.question\.negativeAnswer/);
  assert.match(timingSource, /reviewPolicyCopy\.timing\.responseWindow/);
  assert.match(timingSource, /reviewPolicyCopy\.timing\.panelSize/);
  assert.match(compensationSource, /reviewPolicyCopy\.payment\.bountyPerReviewer/);

  assert.doesNotMatch(
    setupSource,
    /"Public network"|"Positive label"|"Negative label"|"Rationale"|"USDC per reviewer"/,
  );
  assert.doesNotMatch(
    editorSource,
    /"Question shown to reviewers"|"Risk levels"|"Response deadline"|"Panel size"|"Feedback bonus"/,
  );
  assert.doesNotMatch(timingSource, /"Reviewer count"/);
  assert.doesNotMatch(compensationSource, /"USDC per reviewer"/);
});

test("adaptive policy detail is concise at connection time and complete in review setup", () => {
  const connectionSource = readFileSync(new URL("./AgentConnectionPanel.tsx", import.meta.url), "utf8");
  assert.equal(reviewPolicyCopy.limits.adaptiveSummary, "Safe adaptive preset applied.");
  assert.ok(reviewPolicyCopy.limits.adaptiveConnectionHelp.split(/\s+/u).length <= 20);
  assert.match(reviewPolicyCopy.limits.adaptiveDetail, /two stable 15-case windows/u);
  assert.match(reviewPolicyCopy.limits.adaptiveDetail, /at least 14 agent-human agreements each/u);
  assert.match(reviewPolicyCopy.limits.adaptiveDetail, /70% minimum declared confidence/u);
  assert.match(reviewPolicyCopy.limits.adaptiveDetail, /at most 20 outputs/u);
  assert.match(reviewPolicyCopy.limits.adaptiveDetail, /100 comparable cases/u);
  assert.match(connectionSource, /policyCopy\.limits\.adaptiveConnectionHelp/u);
  assert.match(editorSource, /policyCopy\.limits\.adaptiveDetail/u);
});
