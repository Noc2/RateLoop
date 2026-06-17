export type LandingSocialProofStats = {
  totalVotes?: number | string;
  totalVerifiedHumans?: number | string;
  totalQuestionRewardsPaid?: string;
  totalFeedbackBonusesPaid?: string;
};

type LandingSocialProofItem = {
  value: string;
  label: string;
};

export const FALLBACK_SOCIAL_PROOF_STATS = {
  totalVotes: 3482,
  totalVerifiedHumans: 287,
  totalQuestionRewardsPaid: "0",
  totalFeedbackBonusesPaid: "0",
} satisfies Required<LandingSocialProofStats>;

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
  const paidOut = nonNegativeBigInt(stats.totalQuestionRewardsPaid) + nonNegativeBigInt(stats.totalFeedbackBonusesPaid);
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
