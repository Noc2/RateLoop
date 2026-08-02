export type LandingSocialProofStats = {
  totalPaidAtomic: string | number | bigint;
  totalRatings: string | number;
  totalVerifiedHumans: string | number;
};

export type LandingSocialProofItem =
  | { labelKey: "verifiedHumans" | "reviewResponses"; value: number }
  | { labelKey: "usdcPaid"; value: string };

export type LandingSocialProofLabels = {
  verifiedHumans: { one: string; other: string };
  reviewResponses: { one: string; other: string };
  usdcPaid: string;
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
  const verifiedHumans = nonNegativeInteger(stats.totalVerifiedHumans);
  const reviewResponses = nonNegativeInteger(stats.totalRatings);
  const usdcPaid = formatUsdcPaidOut(stats.totalPaidAtomic);
  const items: LandingSocialProofItem[] = [
    ...(verifiedHumans > 0 ? [{ value: verifiedHumans, labelKey: "verifiedHumans" as const }] : []),
    ...(reviewResponses > 0 ? [{ value: reviewResponses, labelKey: "reviewResponses" as const }] : []),
    ...(usdcPaid !== "$0" ? [{ value: usdcPaid, labelKey: "usdcPaid" as const }] : []),
  ];
  return items;
}

export function formatLandingSocialProofItem(
  item: LandingSocialProofItem,
  locale: string,
  labels: LandingSocialProofLabels,
) {
  if (item.labelKey === "usdcPaid") return { value: item.value, label: labels.usdcPaid };
  return {
    value: new Intl.NumberFormat(locale).format(item.value),
    label: labels[item.labelKey][item.value === 1 ? "one" : "other"],
  };
}
