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
};

const tokenDistributionEntries: readonly TokenDistributionEntry[] = [
  {
    label: "Launch Distribution Pool",
    amount: 68_000_000,
    purpose:
      "Protocol-funded launch rewards: verified-human anchored earned rater rewards, one-time decaying human verification bonuses, and referrals",
  },
  {
    label: "Treasury",
    amount: 32_000_000,
    purpose:
      "Governance-controlled LREP for safety responses, verification acceleration, ecosystem grants, partner activation, and protocol development",
  },
] as const;

const LAUNCH_DISTRIBUTION_POOL_AMOUNT = tokenDistributionEntries[0].amount;
export const LAUNCH_DISTRIBUTION_POOL_AMOUNT_COMPACT_LABEL = lrepCompactFormatter.format(
  LAUNCH_DISTRIBUTION_POOL_AMOUNT,
);

const launchDistributionBreakdownEntries: readonly TokenDistributionEntry[] = [
  {
    label: "Human verified + referral rewards",
    amount: 35_000_000,
    purpose: "One-time decaying human verification bonuses plus bounded referrals",
  },
  {
    label: "Earned rater rewards",
    amount: 33_000_000,
    purpose:
      "Count-based rewards for useful revealed ratings in verified-human anchored rounds, with full caps unlockable by later human verification",
  },
] as const;

function formatLrepAmount(amount: number): string {
  return `${lrepAmountFormatter.format(amount)} LREP`;
}

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
