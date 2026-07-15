export type LandingSocialProofStats = {
  totalPaidAtomic: string | number | bigint;
  totalRatings: string | number;
  totalVerifiedHumans: string | number;
};

export type LandingSocialProofItem = {
  label: "Verified Humans" | "Ratings" | "USDC Paid";
  value: string;
};

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
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
  return [
    {
      value: nonNegativeInteger(stats.totalVerifiedHumans).toLocaleString("en-US"),
      label: "Verified Humans",
    },
    {
      value: nonNegativeInteger(stats.totalRatings).toLocaleString("en-US"),
      label: "Ratings",
    },
    {
      value: formatUsdcPaidOut(stats.totalPaidAtomic),
      label: "USDC Paid",
    },
  ];
}
