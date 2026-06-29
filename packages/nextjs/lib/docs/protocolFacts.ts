import {
  BPS_SCALE,
  DEFAULT_REVEAL_GRACE_PERIOD_SECONDS,
  DEFAULT_ROUND_CONFIG,
  EPOCH_WEIGHT_BPS,
  PLATFORM_REWARD_SPLIT_BPS,
  QUESTION_REWARD_PARTICIPANT_FLOORS,
  SCORE_SPREAD_POLICY,
} from "@rateloop/contracts/protocol";

function formatPercent(value: number): string {
  return `${value.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function percentFromBps(bps: number): number {
  return (bps / BPS_SCALE) * 100;
}

function formatDurationLabel(seconds: number): string {
  if (seconds % (24 * 60 * 60) === 0) {
    const days = seconds / (24 * 60 * 60);
    return `${days} day${days === 1 ? "" : "s"}`;
  }

  if (seconds % (60 * 60) === 0) {
    const hours = seconds / (60 * 60);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  return `${seconds} seconds`;
}

function formatUsdcAmountLabel(value: number): string {
  const raw = BigInt(value);
  const whole = raw / 1_000_000n;
  const fractional = raw % 1_000_000n;
  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fractionalText = fractional.toString().padStart(6, "0").replace(/0+$/, "");
  return `${fractionalText ? `${groupedWhole}.${fractionalText}` : groupedWhole} USDC`;
}

const ROUND_CONFIG_BOUNDS = {
  minEpochDurationSeconds: 20,
  maxEpochDurationSeconds: 30 * 24 * 60 * 60,
  minRoundDurationSeconds: 20,
  maxRoundDurationSeconds: 60 * 24 * 60 * 60,
  minSettlementVoters: 3,
  maxSettlementVoters: 100,
  minVoterCap: 3,
  maxVoterCap: 200,
} as const;
const MIN_QUESTION_DURATION_SECONDS = Math.max(
  ROUND_CONFIG_BOUNDS.minEpochDurationSeconds,
  ROUND_CONFIG_BOUNDS.minRoundDurationSeconds,
);
const MAX_QUESTION_DURATION_SECONDS = Math.min(
  ROUND_CONFIG_BOUNDS.maxEpochDurationSeconds,
  ROUND_CONFIG_BOUNDS.maxRoundDurationSeconds,
);

const CLUSTER_PAYOUT_CHALLENGE_WINDOW_SECONDS = 2 * 60 * 60;
const USDC_BOUNTY_PAYOUT_MINIMUM_DELAY_SECONDS = CLUSTER_PAYOUT_CHALLENGE_WINDOW_SECONDS;

export const protocolDocFacts = {
  governanceProposalThresholdLabel: "1,000 LREP hard floor",
  governanceMaxProposalThresholdLabel: "100,000 LREP",
  governanceProposalThresholdRangeLabel: "1,000-100,000 LREP",
  governanceQuorumLabel: "4% of circulating supply (min 100,000 LREP)",
  governanceMinimumQuorumLabel: "100,000 LREP",
  governanceTimelockDelayLabel: "2 days",
  governanceVotingDelegationLabel: "self-delegated LREP only",
  frontendOperatorStakeLabel: "1,000 LREP",
  submissionLrepMinimumLabel: "1 LREP hard floor",
  submissionUsdcMinimumLabel: "1 USDC hard floor",
  questionDurationLabel: formatDurationLabel(DEFAULT_ROUND_CONFIG.epochDurationSeconds),
  revealGracePeriodLabel: formatDurationLabel(DEFAULT_REVEAL_GRACE_PERIOD_SECONDS),
  minVotersLabel: String(DEFAULT_ROUND_CONFIG.minVoters),
  maxVotersLabel: DEFAULT_ROUND_CONFIG.maxVoters.toLocaleString(),
  launchFeedbackQuorumLabel: `${DEFAULT_ROUND_CONFIG.minVoters}-rater launch default`,
  quorumRatchetPolicyLabel:
    "Governance can raise the default settlement voter count and the allowed minimum for new rounds as rater supply, bounty value, and attack pressure grow; already-created questions and already-open rounds keep their snapshotted configuration.",
  minQuestionDurationLabel: formatDurationLabel(MIN_QUESTION_DURATION_SECONDS),
  maxQuestionDurationLabel: formatDurationLabel(MAX_QUESTION_DURATION_SECONDS),
  minSettlementVotersLabel: String(ROUND_CONFIG_BOUNDS.minSettlementVoters),
  maxSettlementVotersLabel: String(ROUND_CONFIG_BOUNDS.maxSettlementVoters),
  minVoterCapLabel: String(ROUND_CONFIG_BOUNDS.minVoterCap),
  maxVoterCapLabel: ROUND_CONFIG_BOUNDS.maxVoterCap.toLocaleString(),
  roundConfigBoundsSummaryLabel: `${formatDurationLabel(MIN_QUESTION_DURATION_SECONDS)}-${formatDurationLabel(
    MAX_QUESTION_DURATION_SECONDS,
  )} question duration, ${
    ROUND_CONFIG_BOUNDS.minSettlementVoters
  }-${ROUND_CONFIG_BOUNDS.maxSettlementVoters} settlement raters, ${ROUND_CONFIG_BOUNDS.minVoterCap}-${ROUND_CONFIG_BOUNDS.maxVoterCap.toLocaleString()} rater cap`,
  frontendNetSharePercentLabel: formatPercent(percentFromBps(PLATFORM_REWARD_SPLIT_BPS.frontend)),
  frontendShareLabel: formatPercent(percentFromBps(PLATFORM_REWARD_SPLIT_BPS.frontend)),
  blindPhaseWeightLabel: formatPercent(percentFromBps(EPOCH_WEIGHT_BPS.blind)),
  openPhaseWeightLabel: formatPercent(percentFromBps(EPOCH_WEIGHT_BPS.informed)),
  earlyVoterAdvantageLabel: `${EPOCH_WEIGHT_BPS.blind / EPOCH_WEIGHT_BPS.informed}:1`,
  scoreSpreadForfeitMinRevealsLabel: String(SCORE_SPREAD_POLICY.forfeitMinReveals),
  decisionGradeMinRevealsLabel: String(SCORE_SPREAD_POLICY.forfeitMinReveals),
  maxScoreSpreadForfeitPercentLabel: formatPercent(percentFromBps(SCORE_SPREAD_POLICY.maxForfeitBps)),
  scoreSpreadForfeitPolicyLabel: `Score-spread LREP forfeits are disabled below ${
    SCORE_SPREAD_POLICY.forfeitMinReveals
  } score-eligible revealed voters and capped at ${formatPercent(
    percentFromBps(SCORE_SPREAD_POLICY.maxForfeitBps),
  )} of each report's stake once active.`,
  feedbackTierPolicyLabel: `${
    DEFAULT_ROUND_CONFIG.minVoters
  }-rater rounds are the launch feedback tier; ${SCORE_SPREAD_POLICY.forfeitMinReveals}+ score-eligible revealed voters are the initial floor for full score-spread economics and decision-grade wording.`,
  bountyBaseVotersLabel: String(QUESTION_REWARD_PARTICIPANT_FLOORS.minParticipants),
  bountyHighValueAmountLabel: formatUsdcAmountLabel(QUESTION_REWARD_PARTICIPANT_FLOORS.highValueAmount),
  bountyHighValueVotersLabel: String(QUESTION_REWARD_PARTICIPANT_FLOORS.highValueMinParticipants),
  bountyVeryHighValueAmountLabel: formatUsdcAmountLabel(QUESTION_REWARD_PARTICIPANT_FLOORS.veryHighValueAmount),
  bountyVeryHighValueVotersLabel: String(QUESTION_REWARD_PARTICIPANT_FLOORS.veryHighValueMinParticipants),
  bountyParticipantFloorsLabel: `${QUESTION_REWARD_PARTICIPANT_FLOORS.minParticipants} below ${formatUsdcAmountLabel(
    QUESTION_REWARD_PARTICIPANT_FLOORS.highValueAmount,
  )}, ${QUESTION_REWARD_PARTICIPANT_FLOORS.highValueMinParticipants} from ${formatUsdcAmountLabel(
    QUESTION_REWARD_PARTICIPANT_FLOORS.highValueAmount,
  )}, and ${QUESTION_REWARD_PARTICIPANT_FLOORS.veryHighValueMinParticipants} from ${formatUsdcAmountLabel(
    QUESTION_REWARD_PARTICIPANT_FLOORS.veryHighValueAmount,
  )}`,
  clusterPayoutChallengeWindowLabel: formatDurationLabel(CLUSTER_PAYOUT_CHALLENGE_WINDOW_SECONDS),
  usdcBountyPayoutMinimumDelayLabel: formatDurationLabel(USDC_BOUNTY_PAYOUT_MINIMUM_DELAY_SECONDS),
  usdcBountyPayoutHappyPathMaxDelayLabel: "4 hours",
  usdcBountyPayoutTimingTooltip:
    "USDC bounty claims wait for finalized payout roots after settlement: minimum 2 hours when the correlation epoch is already finalized, normally up to 4 hours if both oracle layers still need their 2-hour challenge windows. Keeper polling, transactions, and artifact availability can add a little; challenged roots wait for arbiter resolution.",
} as const;

export const whitepaperSettlementConfigRows: string[][] = [
  [
    "questionDurationSeconds",
    `${protocolDocFacts.questionDurationLabel} default`,
    "Creator-selected shared blind response, bounty eligibility, and feedback-bonus duration within governance bounds",
  ],
  [
    "minVoters",
    `${protocolDocFacts.minVotersLabel} default`,
    "Creator-selected minimum revealed predictions required for settlement; launch starts at 3 for feedback-tier liveness, and governance can raise defaults and new-round floors over time",
  ],
  [
    "maxVoters",
    `${protocolDocFacts.maxVotersLabel} default`,
    "Creator-selected cap on raters for the question; bounty-paying questions must keep this cap at 200 or lower",
  ],
  [
    "revealGracePeriod",
    protocolDocFacts.revealGracePeriodLabel,
    "Time after each epoch during which all votes must be revealed before settlement",
  ],
];

export const whitepaperRoundConfigBoundsRows: string[][] = [
  ["question duration", `${protocolDocFacts.minQuestionDurationLabel} to ${protocolDocFacts.maxQuestionDurationLabel}`],
  [
    "settlement raters",
    `${protocolDocFacts.minSettlementVotersLabel} to ${protocolDocFacts.maxSettlementVotersLabel}; governance-ratchetable for new rounds`,
  ],
  ["rater cap", `${protocolDocFacts.minVoterCapLabel} to ${protocolDocFacts.maxVoterCapLabel}`],
];
