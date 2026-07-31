"use client";

import { useAgentTranslations } from "./AgentsLocaleProvider";

export const reviewPolicyCopy = {
  question: {
    authority: "Who writes the question?",
    ownerFixed: "Use one question",
    agentPerRequest: "Let the agent ask each time",
    criterion: "Review question",
    positiveAnswer: "Positive answer",
    negativeAnswer: "Negative answer",
    rationale: "Reviewer explanation",
    rationaleOff: "Off",
    rationaleOptional: "Optional",
    rationaleRequired: "Required",
    agentWrittenNote:
      "Agent-written questions collect feedback only. They use RateLoop network reviewers and never change adaptive review coverage.",
  },
  limits: {
    adaptiveRate: "Minimum review rate (%)",
    adaptiveSummary: "Safe adaptive preset applied.",
    adaptiveConnectionHelp:
      "Coverage starts at 100% and never drops below 10%. Review setup shows the policy after approval.",
    adaptiveDetail:
      "Coverage starts at 100%. It moves to 50% after two stable 15-case windows with at least 14 agent-human agreements each and 70% minimum declared confidence, then to 25% after 50 stable cases and 10% after 100. High and critical risk always require review; at most 20 outputs can pass without a sample, and every 100 comparable cases triggers full-review calibration.",
    fixedRate: "Outputs reviewed (%)",
    maximumGap: "Maximum outputs between reviews",
    riskTiers: "Review these risk levels",
    confidence: "Review below confidence (%)",
  },
  audience: {
    label: "Reviewers",
    invited: "Invited reviewers",
    rateLoopNetwork: "RateLoop network",
  },
  timing: {
    responseWindow: "Response window",
    panelSize: "Reviewers per request",
  },
  payment: {
    bounty: "Guaranteed bounty",
    noBounty: "No bounty",
    addBounty: "Add USDC bounty",
    bountyPerReviewer: "USDC per accepted reviewer",
    feedbackBonus: "Feedback Bonus",
    noBonus: "No bonus",
    addBonus: "Add bonus",
    bonusPool: "Bonus pool (USDC)",
    awarder: "Human awarder",
    requester: "Requester",
    designated: "Designated authenticated human",
    awarderAccount: "Awarder account",
  },
  confirmation: {
    title: "Confirm paid review policy",
    action: "Save review policy",
  },
} as const;

export function useLocalizedReviewPolicyCopy() {
  const t = useAgentTranslations("reviewPolicy");
  return {
    question: {
      authority: t("questionAuthority"),
      ownerFixed: t("questionOwnerFixed"),
      agentPerRequest: t("questionAgentPerRequest"),
      criterion: t("questionCriterion"),
      positiveAnswer: t("questionPositiveAnswer"),
      negativeAnswer: t("questionNegativeAnswer"),
      rationale: t("questionRationale"),
      rationaleOff: t("questionRationaleOff"),
      rationaleOptional: t("questionRationaleOptional"),
      rationaleRequired: t("questionRationaleRequired"),
      agentWrittenNote: t("questionAgentWrittenNote"),
    },
    limits: {
      adaptiveRate: t("limitsAdaptiveRate"),
      adaptiveSummary: t("limitsAdaptiveSummary"),
      adaptiveConnectionHelp: t("limitsAdaptiveConnectionHelp"),
      adaptiveDetail: t("limitsAdaptiveDetail"),
      fixedRate: t("limitsFixedRate"),
      maximumGap: t("limitsMaximumGap"),
      riskTiers: t("limitsRiskTiers"),
      confidence: t("limitsConfidence"),
    },
    audience: {
      label: t("audienceLabel"),
      invited: t("audienceInvited"),
      rateLoopNetwork: t("audienceRateLoopNetwork"),
    },
    timing: {
      responseWindow: t("timingResponseWindow"),
      panelSize: t("timingPanelSize"),
    },
    payment: {
      bounty: t("paymentBounty"),
      noBounty: t("paymentNoBounty"),
      addBounty: t("paymentAddBounty"),
      bountyPerReviewer: t("paymentBountyPerReviewer"),
      feedbackBonus: t("paymentFeedbackBonus"),
      noBonus: t("paymentNoBonus"),
      addBonus: t("paymentAddBonus"),
      bonusPool: t("paymentBonusPool"),
      awarder: t("paymentAwarder"),
      requester: t("paymentRequester"),
      designated: t("paymentDesignated"),
      awarderAccount: t("paymentAwarderAccount"),
    },
    confirmation: {
      title: t("confirmationTitle"),
      action: t("confirmationAction"),
    },
  };
}
