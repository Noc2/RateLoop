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
      "Coverage starts at 100% and never drops below 25%. Review setup shows the policy after approval.",
    adaptiveDetail:
      "Coverage starts at 100%, then may move to 50% and 25% after two stable 15-case windows with at least 14 agent-human agreements each and 70% minimum declared confidence. High and critical risk always require review, and at most 20 outputs can pass without a sample. After 100 comparable cases, monitoring returns to a full-review calibration block.",
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
