import { buildReviewAudienceRequestProfile, privateClassificationsThrough } from "./reviewAudience";
import { buildReviewCompensationConfiguration, reviewCompensationFormValues } from "./reviewCompensation";
import { buildReviewCriterionRequestProfile } from "./reviewCriterion";
import { buildReviewExpertiseRequestProfile, requirementForDefinition } from "./reviewExpertise";
import { buildReviewFrequencySelection } from "./reviewFrequency";
import { type SetupLocalization, setupMessages } from "./setupMessages";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const catalogue = JSON.parse(readFileSync(new URL("../../../../messages/de/agents.json", import.meta.url), "utf8")) as {
  reviewEditor: Record<string, string>;
  reviewPolicy: Record<string, string>;
  setupFlow: Record<string, string>;
};

function translator(namespace: Record<string, string>) {
  return (key: string, values: Record<string, number | string> = {}) => {
    const template = namespace[key];
    assert.ok(template, `the German catalogue is missing ${key}`);
    return template.replace(/\{(\w+)\}/gu, (placeholder, name: string) =>
      Object.hasOwn(values, name) ? String(values[name]) : placeholder,
    );
  };
}

const reviewPolicy = translator(catalogue.reviewPolicy);

/** The real German catalogue, shaped the way the wizard supplies it. */
const german: SetupLocalization = {
  editor: translator(catalogue.reviewEditor),
  flow: translator(catalogue.setupFlow),
  policy: {
    question: {
      authority: reviewPolicy("questionAuthority"),
      ownerFixed: reviewPolicy("questionOwnerFixed"),
      agentPerRequest: reviewPolicy("questionAgentPerRequest"),
      criterion: reviewPolicy("questionCriterion"),
      positiveAnswer: reviewPolicy("questionPositiveAnswer"),
      negativeAnswer: reviewPolicy("questionNegativeAnswer"),
      rationale: reviewPolicy("questionRationale"),
      rationaleOff: reviewPolicy("questionRationaleOff"),
      rationaleOptional: reviewPolicy("questionRationaleOptional"),
      rationaleRequired: reviewPolicy("questionRationaleRequired"),
      agentWrittenNote: reviewPolicy("questionAgentWrittenNote"),
    },
    limits: {
      adaptiveRate: reviewPolicy("limitsAdaptiveRate"),
      adaptiveSummary: reviewPolicy("limitsAdaptiveSummary"),
      adaptiveConnectionHelp: reviewPolicy("limitsAdaptiveConnectionHelp"),
      adaptiveDetail: reviewPolicy("limitsAdaptiveDetail"),
      fixedRate: reviewPolicy("limitsFixedRate"),
      maximumGap: reviewPolicy("limitsMaximumGap"),
      riskTiers: reviewPolicy("limitsRiskTiers"),
      confidence: reviewPolicy("limitsConfidence"),
    },
    audience: {
      label: reviewPolicy("audienceLabel"),
      invited: reviewPolicy("audienceInvited"),
      rateLoopNetwork: reviewPolicy("audienceRateLoopNetwork"),
    },
    timing: {
      responseWindow: reviewPolicy("timingResponseWindow"),
      panelSize: reviewPolicy("timingPanelSize"),
    },
    payment: {
      bounty: reviewPolicy("paymentBounty"),
      noBounty: reviewPolicy("paymentNoBounty"),
      addBounty: reviewPolicy("paymentAddBounty"),
      bountyPerReviewer: reviewPolicy("paymentBountyPerReviewer"),
      feedbackBonus: reviewPolicy("paymentFeedbackBonus"),
      noBonus: reviewPolicy("paymentNoBonus"),
      addBonus: reviewPolicy("paymentAddBonus"),
      bonusPool: reviewPolicy("paymentBonusPool"),
      awarder: reviewPolicy("paymentAwarder"),
      requester: reviewPolicy("paymentRequester"),
      designated: reviewPolicy("paymentDesignated"),
      awarderAccount: reviewPolicy("paymentAwarderAccount"),
    },
    confirmation: {
      title: reviewPolicy("confirmationTitle"),
      action: reviewPolicy("confirmationAction"),
    },
  },
};

const profile = {
  questionAuthority: "owner_fixed" as const,
  resultSemantics: "assurance" as const,
  criterion: "Ist diese Antwort sicher und korrekt?",
  positiveLabel: "Freigeben",
  negativeLabel: "Ablehnen",
  rationaleMode: "required" as const,
  audience: "private_invited" as const,
  contentBoundary: "private_workspace" as const,
  privateSensitivity: "confidential" as const,
  privateGroupId: "pgrp_reviewers",
  responseWindowSeconds: 3_600,
  panelSize: 2,
  compensationMode: "unpaid" as const,
  bountyPerSeatAtomic: null,
};

/** Any of these surviving means an English fragment leaked into a German message. */
const ENGLISH = /\b(must|Choose|Enter|is required|between|whole number|outside|supported|valid|at least|differ)\b/u;

function germanMessage(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return assert.fail("expected the builder to reject this input");
}

test("every wizard step raises its validation errors in German", () => {
  const cases: Array<[string, () => unknown]> = [
    ["audience sensitivity", () => privateClassificationsThrough("nonsense" as never, german)],
    [
      "rationale mode",
      () =>
        buildReviewCriterionRequestProfile(
          profile,
          { ...profile, rationaleMode: "nonsense" as never, criterion: "x", positiveLabel: "a", negativeLabel: "b" },
          german,
        ),
    ],
    [
      "empty criterion",
      () =>
        buildReviewCriterionRequestProfile(
          profile,
          { ...profile, criterion: "   ", positiveLabel: "a", negativeLabel: "b" },
          german,
        ),
    ],
    [
      "identical answer labels",
      () =>
        buildReviewCriterionRequestProfile(
          profile,
          { ...profile, criterion: "x", positiveLabel: "Ja", negativeLabel: "ja" },
          german,
        ),
    ],
    [
      "hybrid specialist seats",
      () =>
        requirementForDefinition({
          audience: "hybrid",
          definition: { definitionId: "d", version: 1, hash: "h" } as never,
          localization: german,
          panelSize: 3,
        }),
    ],
    [
      "no specialist area chosen",
      () =>
        buildReviewExpertiseRequestProfile(
          profile,
          { needsSpecialists: true, requirements: [], legacyRequiredExpertiseKeys: [] } as never,
          2,
          german,
        ),
    ],
    [
      "invalid authority",
      () =>
        buildReviewCompensationConfiguration(
          profile,
          { compensationMode: "unpaid", usdcPerReviewer: "1", authority: "nonsense" as never },
          german,
        ),
    ],
    [
      "bonus awarder account missing",
      () =>
        buildReviewCompensationConfiguration(
          profile,
          {
            authority: "check_only",
            compensationMode: "unpaid",
            feedbackBonusAwarderAccount: "",
            feedbackBonusAwarderKind: "designated",
            usdcPerReviewer: "1",
          },
          german,
        ),
    ],
    [
      "corrupt saved bounty",
      () =>
        reviewCompensationFormValues(
          { ...profile, bountyPerSeatAtomic: "0x", configurationStatus: "ready" },
          null,
          german,
        ),
    ],
    [
      "maximum gap not a whole number",
      () =>
        buildReviewFrequencySelection(
          { mode: "adaptive" } as never,
          { mode: "adaptive", maximumUnreviewedGap: "1.5" } as never,
          german,
        ),
    ],
    [
      "fixed rate out of range",
      () =>
        buildReviewFrequencySelection(
          { mode: "fixed" } as never,
          { mode: "fixed", fixedPercent: "0", maximumUnreviewedGap: "10" } as never,
          german,
        ),
    ],
    [
      "risk tier format",
      () =>
        buildReviewFrequencySelection(
          { mode: "rules" } as never,
          { mode: "rules", requiredRiskTiers: "!!bad!!", minimumConfidencePercent: "" } as never,
          german,
        ),
    ],
    [
      "no rule condition",
      () =>
        buildReviewFrequencySelection(
          { mode: "rules" } as never,
          { mode: "rules", requiredRiskTiers: "", minimumConfidencePercent: "" } as never,
          german,
        ),
    ],
  ];

  for (const [name, run] of cases) {
    const message = germanMessage(run);
    assert.doesNotMatch(message, ENGLISH, `${name} still leaks English: ${message}`);
    assert.ok(message.length > 0, `${name} produced an empty message`);
  }
});

test("omitting the localization reproduces the previous English exactly", () => {
  // The builders stay callable outside React. If this drifts, every existing
  // test asserting English text is silently asserting something else.
  const english = setupMessages();
  assert.equal(english.required("Review question"), "Review question is required.");
  assert.equal(english.invalidAuthority(), "Choose a valid agent authority.");
  assert.equal(
    english.wholeNumber("Maximum outputs between reviews"),
    "Maximum outputs between reviews must be a whole number.",
  );
  assert.equal(english.policy.payment.bountyPerReviewer, "USDC per accepted reviewer");
});

test("the audience builder still accepts a valid sensitivity", () => {
  assert.deepEqual(privateClassificationsThrough("confidential", german), ["internal", "confidential"]);
  assert.equal(
    buildReviewAudienceRequestProfile({ ...profile, configurationStatus: "ready" }, profile).audience,
    "private_invited",
  );
});
