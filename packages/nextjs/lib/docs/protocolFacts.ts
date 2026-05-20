import {
  BPS_SCALE,
  DEFAULT_REVEAL_GRACE_PERIOD_SECONDS,
  DEFAULT_ROUND_CONFIG,
  EPOCH_WEIGHT_BPS,
  PLATFORM_REWARD_SPLIT_BPS,
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

const ROUND_CONFIG_BOUNDS = {
  minEpochDurationSeconds: 60,
  maxEpochDurationSeconds: 7 * 24 * 60 * 60,
  minRoundDurationSeconds: 60,
  maxRoundDurationSeconds: 30 * 24 * 60 * 60,
  minSettlementVoters: 3,
  maxSettlementVoters: 100,
  minVoterCap: 3,
  maxVoterCap: 1_000,
} as const;

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
  blindPhaseDurationLabel: formatDurationLabel(DEFAULT_ROUND_CONFIG.epochDurationSeconds),
  revealGracePeriodLabel: formatDurationLabel(DEFAULT_REVEAL_GRACE_PERIOD_SECONDS),
  maxRoundDurationLabel: formatDurationLabel(DEFAULT_ROUND_CONFIG.maxDurationSeconds),
  minVotersLabel: String(DEFAULT_ROUND_CONFIG.minVoters),
  maxVotersLabel: DEFAULT_ROUND_CONFIG.maxVoters.toLocaleString(),
  minBlindPhaseDurationLabel: formatDurationLabel(ROUND_CONFIG_BOUNDS.minEpochDurationSeconds),
  maxBlindPhaseDurationLabel: formatDurationLabel(ROUND_CONFIG_BOUNDS.maxEpochDurationSeconds),
  minRoundDurationLabel: formatDurationLabel(ROUND_CONFIG_BOUNDS.minRoundDurationSeconds),
  maxAllowedRoundDurationLabel: formatDurationLabel(ROUND_CONFIG_BOUNDS.maxRoundDurationSeconds),
  minSettlementVotersLabel: String(ROUND_CONFIG_BOUNDS.minSettlementVoters),
  maxSettlementVotersLabel: String(ROUND_CONFIG_BOUNDS.maxSettlementVoters),
  minVoterCapLabel: String(ROUND_CONFIG_BOUNDS.minVoterCap),
  maxVoterCapLabel: ROUND_CONFIG_BOUNDS.maxVoterCap.toLocaleString(),
  roundConfigBoundsSummaryLabel: `${formatDurationLabel(
    ROUND_CONFIG_BOUNDS.minEpochDurationSeconds,
  )}-${formatDurationLabel(ROUND_CONFIG_BOUNDS.maxEpochDurationSeconds)} blind phase, ${formatDurationLabel(
    ROUND_CONFIG_BOUNDS.minRoundDurationSeconds,
  )}-${formatDurationLabel(ROUND_CONFIG_BOUNDS.maxRoundDurationSeconds)} max duration, ${
    ROUND_CONFIG_BOUNDS.minSettlementVoters
  }-${ROUND_CONFIG_BOUNDS.maxSettlementVoters} settlement raters, ${ROUND_CONFIG_BOUNDS.minVoterCap}-${ROUND_CONFIG_BOUNDS.maxVoterCap.toLocaleString()} rater cap`,
  frontendNetSharePercentLabel: formatPercent(percentFromBps(PLATFORM_REWARD_SPLIT_BPS.frontend)),
  frontendShareLabel: formatPercent(percentFromBps(PLATFORM_REWARD_SPLIT_BPS.frontend)),
  blindPhaseWeightLabel: formatPercent(percentFromBps(EPOCH_WEIGHT_BPS.blind)),
  openPhaseWeightLabel: formatPercent(percentFromBps(EPOCH_WEIGHT_BPS.informed)),
  earlyVoterAdvantageLabel: `${EPOCH_WEIGHT_BPS.blind / EPOCH_WEIGHT_BPS.informed}:1`,
} as const;

export const whitepaperSettlementConfigRows: string[][] = [
  [
    "epochDuration",
    `${protocolDocFacts.blindPhaseDurationLabel} default`,
    "Creator-selected blind/reward-tier duration within governance bounds",
  ],
  [
    "minVoters",
    `${protocolDocFacts.minVotersLabel} default`,
    "Creator-selected minimum revealed predictions required for settlement",
  ],
  [
    "maxDuration",
    `${protocolDocFacts.maxRoundDurationLabel} default`,
    "Creator-selected maximum round lifetime  -- below commit quorum rounds cancel; commit-quorum rounds can end as RevealFailed",
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
  ["blind phase", `${protocolDocFacts.minBlindPhaseDurationLabel} to ${protocolDocFacts.maxBlindPhaseDurationLabel}`],
  ["max duration", `${protocolDocFacts.minRoundDurationLabel} to ${protocolDocFacts.maxAllowedRoundDurationLabel}`],
  ["settlement raters", `${protocolDocFacts.minSettlementVotersLabel} to ${protocolDocFacts.maxSettlementVotersLabel}`],
  ["rater cap", `${protocolDocFacts.minVoterCapLabel} to ${protocolDocFacts.maxVoterCapLabel}`],
];
