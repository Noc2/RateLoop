import { legacyClaimManifest } from "~~/lib/legacy-claim/manifest";

export type LandingSocialProofStats = {
  totalVotes?: number | string;
  totalVerifiedHumans?: number | string;
  totalQuestionRewardsPaid?: string;
  totalFeedbackBonusesPaid?: string;
};

export type LandingSocialProofItem = {
  value: string;
  label: string;
};

export const LEGACY_VERIFIED_HUMAN_COUNT = new Set(
  legacyClaimManifest.entries.map(entry => entry.address.toLowerCase()),
).size;

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
      // L-7: We sum the live verified-credential count with the legacy contributor count.
      // This can over-count if a legacy contributor (identified by EOA address in
      // `legacyClaimManifest.entries[].address`) ALSO re-verifies as a human on the current
      // contract (`raterHumanCredential`, keyed by the same `rater` address). Those two sets are
      // NOT guaranteed disjoint — nothing stops a legacy address from verifying again.
      //
      // We accept this small headline over-count on purpose: the only inputs available here are
      // scalar counts, not address lists. `totalVerifiedHumans` comes from a `count(*)` in the
      // ponder stats route (data-routes.ts), which does not expose the underlying addresses, so a
      // true union-dedupe is not possible without changing the API shape and shipping the full
      // legacy + live address sets to the client. Treat this figure as an upper-bound display stat.
      value: (totalVerifiedHumans + LEGACY_VERIFIED_HUMAN_COUNT).toLocaleString("en-US"),
      label: "Verified Humans",
    },
    { value: totalVotes.toLocaleString("en-US"), label: "Ratings" },
    { value: formatUsdcPaidOut(paidOut), label: "USDC Paid" },
  ];
}
