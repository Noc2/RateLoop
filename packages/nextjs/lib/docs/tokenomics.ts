const lrepAmountFormatter = new Intl.NumberFormat("en-US");
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

export const tokenDistributionWhitepaperRows = tokenDistributionEntries.map(entry => [
  entry.label,
  formatLrepAmount(entry.amount),
  entry.purpose,
]);
