export type LandingSocialProofStats = {
  totalVotes?: number | string;
  totalVerifiedHumans?: number | string;
  totalQuestionRewardsPaid?: string;
  totalQuestionRewardPoolsForfeited?: string;
  totalFeedbackBonusesPaid?: string;
  totalFeedbackBonusesForfeited?: string;
};

type LandingSocialProofItem = {
  value: string;
  label: string;
};

function nonNegativeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nonNegativeBigInt(value: unknown) {
  try {
    const parsed = BigInt(String(value ?? 0));
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

export function formatUsdcPaidOut(rawAmount: unknown) {
  const amount = nonNegativeBigInt(rawAmount);
  const cents = amount > 0n ? (amount + 5_000n) / 10_000n : 0n;
  const dollars = cents / 100n;
  const centsPart = cents % 100n;

  if (centsPart === 0n) {
    return `$${dollars.toLocaleString("en-US")}`;
  }

  return `$${dollars.toLocaleString("en-US")}.${centsPart.toString().padStart(2, "0")}`;
}

export function buildLandingPageSocialProofItems(stats: LandingSocialProofStats): LandingSocialProofItem[] {
  const paidOut =
    nonNegativeBigInt(stats.totalQuestionRewardsPaid) +
    nonNegativeBigInt(stats.totalQuestionRewardPoolsForfeited) +
    nonNegativeBigInt(stats.totalFeedbackBonusesPaid) +
    nonNegativeBigInt(stats.totalFeedbackBonusesForfeited);
  const totalVerifiedHumans = Math.max(0, Math.floor(nonNegativeNumber(stats.totalVerifiedHumans)));
  const totalVotes = Math.max(0, Math.floor(nonNegativeNumber(stats.totalVotes)));

  return [
    {
      value: totalVerifiedHumans.toLocaleString("en-US"),
      label: "Verified Humans",
    },
    { value: totalVotes.toLocaleString("en-US"), label: "Ratings" },
    { value: formatUsdcPaidOut(paidOut), label: "USDC Paid" },
  ];
}
