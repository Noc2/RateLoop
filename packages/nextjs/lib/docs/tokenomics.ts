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
    label: "Human verified + referral rewards",
    amount: 42_000_000,
    purpose: "Front-loaded one-time human verification bonuses plus immediate bounded referral rewards",
    color: "var(--rateloop-green)",
  },
  {
    label: "Earned rater rewards",
    amount: 24_000_000,
    purpose:
      "Count-based rewards for useful revealed ratings in verified-human anchored rounds, with full caps unlockable by later human verification",
    color: "var(--rateloop-yellow)",
  },
  {
    label: "Legacy contributors",
    amount: 9_000_000,
    purpose:
      "Prior-allocation-based contributor claims plus standard-TTL seeded human credentials for the same legacy addresses",
    color: "var(--rateloop-blue)",
  },
  {
    label: "Treasury",
    amount: 25_000_000,
    purpose:
      "Governance-controlled LREP for safety responses, verification acceleration, ecosystem grants, partner activation, and protocol development",
    color: "var(--rateloop-pink)",
  },
] as const;

const LREP_INITIAL_MINTED_SUPPLY = tokenDistributionEntries.reduce((sum, entry) => sum + entry.amount, 0);
export const LREP_INITIAL_MINTED_SUPPLY_COMPACT_LABEL = lrepCompactFormatter.format(LREP_INITIAL_MINTED_SUPPLY);
const LAUNCH_DISTRIBUTION_POOL_AMOUNT =
  tokenDistributionEntries[0].amount + tokenDistributionEntries[1].amount + tokenDistributionEntries[2].amount;
export const LAUNCH_DISTRIBUTION_POOL_AMOUNT_COMPACT_LABEL = lrepCompactFormatter.format(
  LAUNCH_DISTRIBUTION_POOL_AMOUNT,
);

const launchDistributionBreakdownEntries = tokenDistributionEntries.slice(0, 3);

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
    howToEarn:
      "Verify one active human credential and claim once from that wallet; earliest claims receive larger cold-start bonuses.",
  },
  {
    reward: "Referral bonus",
    howToEarn:
      "Refer a user who verifies, while the referrer also holds an active human credential; the referral bonus remains 50% of the verified user's bonus.",
  },
  {
    reward: "Earned rater reward",
    howToEarn:
      "Complete qualifying ratings in verified-human anchored rounds; payout starts after 5 launch credits, with higher early-rater caps.",
  },
] as const;

export const legacyContributorVestingRows = [
  ["Root activation", "1% of allocation", "Claimable immediately"],
  ["Months 0-24", "99% of allocation", "Unlocks linearly over 730 days"],
  ["Months 24-27", "100% of allocation", "Fully vested balance remains claimable during the 91-day grace period"],
  ["Month 27+", "Expired unclaimed balance", "Governance can sweep unclaimed allocation to the treasury"],
] as const;

export const verifiedReferralRewardScheduleRows = [
  ["1-100", formatLrepAmount(250), formatLrepAmount(125)],
  ["101-1,000", formatLrepAmount(100), formatLrepAmount(50)],
  ["1,001-10,000", formatLrepAmount(40), formatLrepAmount(20)],
  ["10,001-50,000", formatLrepAmount(10), formatLrepAmount(5)],
  ["50,001-200,000", formatLrepAmount(5), formatLrepAmount(2.5)],
  ["200,001-1,000,000", formatLrepAmount(2.5), formatLrepAmount(1.25)],
  ["1,000,001+", formatLrepAmount(1), formatLrepAmount(0.5)],
] as const;

export const earnedRaterRewardScheduleRows = [
  ["1-100", formatLrepAmount(500), formatLrepAmount(125), formatLrepAmount(50)],
  ["101-1,000", formatLrepAmount(250), formatLrepAmount(62.5), formatLrepAmount(25)],
  ["1,001-10,000", formatLrepAmount(100), formatLrepAmount(25), formatLrepAmount(10)],
  ["10,001-100,000", formatLrepAmount(10), formatLrepAmount(2.5), formatLrepAmount(1)],
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
