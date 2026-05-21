const lrepAmountFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});
const lrepCompactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const LREP_MAX_SUPPLY = 100_000_000;
export const LREP_MAX_SUPPLY_LABEL = `${lrepAmountFormatter.format(LREP_MAX_SUPPLY)} LREP`;

type TokenDistributionEntry = {
  label: string;
  amount: number;
  purpose: string;
  color: string;
};

const tokenDistributionEntries: readonly TokenDistributionEntry[] = [
  {
    label: "Launch Distribution Pool",
    amount: 68_000_000,
    purpose:
      "Protocol-funded launch rewards: verified-human anchored earned rater rewards, one-time decaying human verification bonuses, and referrals",
    color: "var(--rateloop-blue)",
  },
  {
    label: "Treasury",
    amount: 32_000_000,
    purpose:
      "Governance-controlled LREP for safety responses, verification acceleration, ecosystem grants, partner activation, and protocol development",
    color: "var(--rateloop-pink)",
  },
] as const;

const LREP_INITIAL_MINTED_SUPPLY = tokenDistributionEntries.reduce((sum, entry) => sum + entry.amount, 0);
export const LREP_INITIAL_MINTED_SUPPLY_COMPACT_LABEL = lrepCompactFormatter.format(LREP_INITIAL_MINTED_SUPPLY);
const LAUNCH_DISTRIBUTION_POOL_AMOUNT = tokenDistributionEntries[0].amount;
export const LAUNCH_DISTRIBUTION_POOL_AMOUNT_COMPACT_LABEL = lrepCompactFormatter.format(
  LAUNCH_DISTRIBUTION_POOL_AMOUNT,
);

const launchDistributionBreakdownEntries: readonly TokenDistributionEntry[] = [
  {
    label: "Human verified + referral rewards",
    amount: 35_000_000,
    purpose: "One-time decaying human verification bonuses plus bounded referrals",
    color: "var(--rateloop-green)",
  },
  {
    label: "Earned rater rewards",
    amount: 33_000_000,
    purpose:
      "Count-based rewards for useful revealed ratings in verified-human anchored rounds, with full caps unlockable by later human verification",
    color: "var(--rateloop-yellow)",
  },
] as const;

function formatLrepAmount(amount: number): string {
  return `${lrepAmountFormatter.format(amount)} LREP`;
}

function formatAllocationPercent(amount: number, total: number): string {
  const percent = (amount / total) * 100;
  if (percent === 0) return "0.0%";
  if (Number.isInteger(percent)) return `${percent.toFixed(1)}%`;
  return `${percent.toFixed(1)}%`;
}

export const tokenAllocationChartSlices = tokenDistributionEntries.map((entry, index) => ({
  ...entry,
  index,
  amountLabel: formatLrepAmount(entry.amount),
  percentLabel: formatAllocationPercent(entry.amount, LREP_MAX_SUPPLY),
  value: (entry.amount / LREP_MAX_SUPPLY) * 100,
}));

export const launchDistributionChartSlices = launchDistributionBreakdownEntries.map((entry, index) => ({
  ...entry,
  index,
  amountLabel: formatLrepAmount(entry.amount),
  launchShareLabel: formatAllocationPercent(entry.amount, LAUNCH_DISTRIBUTION_POOL_AMOUNT),
  totalSupplyLabel: formatAllocationPercent(entry.amount, LREP_MAX_SUPPLY),
  value: (entry.amount / LAUNCH_DISTRIBUTION_POOL_AMOUNT) * 100,
}));

export const launchDistributionBreakdownRows = launchDistributionBreakdownEntries.map(entry => [
  entry.label,
  formatLrepAmount(entry.amount),
  entry.purpose,
]);

export const launchRewardOverviewRows = [
  {
    reward: "Verified human bonus",
    howToEarn: "Verify one active human credential and claim once from that wallet.",
    startingMax: formatLrepAmount(10),
    decay: "Drops as verified claims pass 50K, 200K, and 1M.",
  },
  {
    reward: "Referral bonus",
    howToEarn: "Refer a user who verifies, while the referrer also holds an active human credential.",
    startingMax: `${formatLrepAmount(5)} per verified referral`,
    decay: `Always 50% of the referee's verified bonus, capped at ${formatLrepAmount(10_000)} per referrer.`,
  },
  {
    reward: "Earned rater reward",
    howToEarn: "Complete qualifying ratings in verified-human anchored rounds; payout starts after 5 launch credits.",
    startingMax: `${formatLrepAmount(10)} full cap`,
    decay: "Full caps step down by eligible-rater cohort and fill over up to 10 reward slots.",
  },
] as const;

export const verifiedReferralRewardScheduleRows = [
  ["1-50,000", formatLrepAmount(10), formatLrepAmount(5)],
  ["50,001-200,000", formatLrepAmount(5), formatLrepAmount(2.5)],
  ["200,001-1,000,000", formatLrepAmount(2.5), formatLrepAmount(1.25)],
  ["1,000,001+", formatLrepAmount(1), formatLrepAmount(0.5)],
] as const;

export const earnedRaterRewardScheduleRows = [
  ["1-100,000", formatLrepAmount(10), formatLrepAmount(2.5), formatLrepAmount(1)],
  ["100,001-1,000,000", formatLrepAmount(5), formatLrepAmount(1.25), formatLrepAmount(0.5)],
  ["1,000,001-5,000,000", formatLrepAmount(2.5), formatLrepAmount(0.625), formatLrepAmount(0.25)],
  ["5,000,001-15,000,000", formatLrepAmount(1.25), formatLrepAmount(0.3125), formatLrepAmount(0.125)],
  ["15,000,001+", formatLrepAmount(0.5), formatLrepAmount(0.125), formatLrepAmount(0.05)],
] as const;

export const tokenDistributionWhitepaperRows = tokenDistributionEntries.map(entry => [
  entry.label,
  formatLrepAmount(entry.amount),
  entry.purpose,
]);
