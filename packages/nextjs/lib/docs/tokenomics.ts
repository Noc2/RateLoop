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
    amount: 64_000_000,
    purpose:
      "Protocol-funded launch rewards: verified-human anchored earned rater rewards, one-time decaying human verification bonuses, referrals, and fixed legacy-user claims",
    color: "#7E8996",
  },
  {
    label: "Treasury",
    amount: 32_000_000,
    purpose:
      "Governance-controlled LREP for safety responses, verification acceleration, ecosystem grants, partner activation, and protocol development",
    color: "#F5F5F5",
  },
  {
    label: "Consensus Subsidy Reserve",
    amount: 4_000_000,
    purpose:
      "Pre-funded reserve for high-confidence agreement rewards, replenished by 5% of each round's losing stakes",
    color: "#FFC43D",
  },
] as const;

const LREP_INITIAL_MINTED_SUPPLY = tokenDistributionEntries.reduce((sum, entry) => sum + entry.amount, 0);
export const LREP_INITIAL_MINTED_SUPPLY_COMPACT_LABEL = lrepCompactFormatter.format(LREP_INITIAL_MINTED_SUPPLY);
const LAUNCH_DISTRIBUTION_POOL_AMOUNT = tokenDistributionEntries[0].amount;
export const LAUNCH_DISTRIBUTION_POOL_AMOUNT_COMPACT_LABEL = lrepCompactFormatter.format(
  LAUNCH_DISTRIBUTION_POOL_AMOUNT,
);

export const launchDistributionBreakdownRows = [
  [
    "Human verified + referral rewards",
    "35,000,000 LREP",
    "One-time decaying human verification bonuses plus bounded referrals",
  ],
  [
    "Earned rater rewards",
    "25,000,000 LREP",
    "Count-based rewards for useful revealed ratings in verified-human anchored rounds",
  ],
  ["Legacy users", "4,000,000 LREP", "Fixed allocation for the previous-user set"],
] as const;

function formatLrepAmount(amount: number): string {
  return `${lrepAmountFormatter.format(amount)} LREP`;
}

function formatAllocationPercent(amount: number): string {
  const percent = (amount / LREP_MAX_SUPPLY) * 100;
  if (percent === 0) return "0.0%";
  if (Number.isInteger(percent)) return `${percent.toFixed(1)}%`;
  return `${percent.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export const tokenDistributionTableRows = tokenDistributionEntries.map(entry => ({
  ...entry,
  amountLabel: formatLrepAmount(entry.amount),
}));

export const tokenAllocationChartSlices = tokenDistributionEntries.map((entry, index) => ({
  ...entry,
  index,
  amountLabel: formatLrepAmount(entry.amount),
  percentLabel: formatAllocationPercent(entry.amount),
  value: (entry.amount / LREP_MAX_SUPPLY) * 100,
}));

export const tokenDistributionWhitepaperRows = tokenDistributionEntries.map(entry => [
  entry.label,
  formatLrepAmount(entry.amount),
  entry.purpose,
]);
