import { createHash } from "node:crypto";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const COUNTRY = /^[A-Z]{2}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const DEFAULT_BLOCKED_COUNTRIES = new Set(["BY", "CU", "IR", "KP", "RU", "SY"]);
const DEFAULT_BLOCKED_REGIONS = new Set(["UA-09", "UA-14", "UA-23", "UA-43", "UA-65"]);

export type PaidEligibilityRequestContext = {
  edgeCountry: string | null;
  edgeRegion: string | null;
  localeCountry: string | null;
};

export type PaidEligibilityRiskResult = {
  edgeCountry: string;
  edgeRegion: string | null;
  localeCountry: string | null;
  geoblockStatus: "clear";
  plausibilityStatus: "pass" | "review";
  plausibilityReasonCodes: string[];
  walletReferenceHash: `sha256:${string}`;
  walletScreeningProvider: string;
  walletScreeningStatus: "clear" | "review" | "match";
  walletScreeningReferenceHash: `sha256:${string}`;
  walletListSnapshotHash: `sha256:${string}`;
  checkedAt: Date;
  expiresAt: Date;
};

function configuredSet(value: string | undefined, fallback: Set<string>) {
  if (!value?.trim()) return fallback;
  return new Set(
    value
      .split(",")
      .map(item => item.trim().toUpperCase())
      .filter(Boolean),
  );
}

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}

function country(value: string | null) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return COUNTRY.test(normalized) ? normalized : null;
}

export function localeCountryFromAcceptLanguage(value: string | null) {
  if (!value) return null;
  for (const language of value.split(",")) {
    const match = /(?:^|[-_])([A-Za-z]{2})(?:;|$)/u.exec(language.trim());
    if (match?.[1]) return match[1].toUpperCase();
  }
  return null;
}

export function assertPaidEligibilityGeoblock(context: PaidEligibilityRequestContext) {
  const edgeCountry = country(context.edgeCountry);
  if (!edgeCountry) {
    throw new TokenlessServiceError(
      "Paid eligibility is unavailable because server-side location could not be verified.",
      403,
      "paid_geolocation_unavailable",
    );
  }
  const edgeRegion = context.edgeRegion?.trim().toUpperCase() || null;
  const edgeRegionKey = edgeRegion?.includes("-") ? edgeRegion : edgeRegion ? `${edgeCountry}-${edgeRegion}` : null;
  const blockedCountries = configuredSet(process.env.TOKENLESS_PAID_BLOCKED_COUNTRIES, DEFAULT_BLOCKED_COUNTRIES);
  const blockedRegions = configuredSet(process.env.TOKENLESS_PAID_BLOCKED_REGIONS, DEFAULT_BLOCKED_REGIONS);
  if (blockedCountries.has(edgeCountry) || (edgeRegionKey && blockedRegions.has(edgeRegionKey))) {
    throw new TokenlessServiceError("Paid work is unavailable in this location.", 403, "paid_location_blocked");
  }
  return {
    edgeCountry,
    edgeRegion,
    localeCountry: country(context.localeCountry),
  };
}

async function screenWallet(input: { payoutAccount: string; now: Date }) {
  const provider = process.env.TOKENLESS_WALLET_SCREENING_PROVIDER_ID?.trim();
  const url = process.env.TOKENLESS_WALLET_SCREENING_PROVIDER_URL?.trim();
  const secret = process.env.TOKENLESS_WALLET_SCREENING_PROVIDER_SECRET?.trim();
  if (!provider || !url || !secret || secret.length < 32) {
    throw new TokenlessServiceError(
      "Paid eligibility wallet screening is unavailable.",
      503,
      "wallet_screening_unavailable",
      true,
    );
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new TokenlessServiceError(
      "Paid eligibility wallet screening is unavailable.",
      503,
      "wallet_screening_unavailable",
      true,
    );
  }
  if (parsedUrl.protocol !== "https:") {
    throw new TokenlessServiceError(
      "Paid eligibility wallet screening is unavailable.",
      503,
      "wallet_screening_unavailable",
      true,
    );
  }
  const response = await fetch(parsedUrl, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(7_500),
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chainId: 84532, walletAddress: input.payoutAccount }),
  }).catch(() => null);
  if (!response?.ok) {
    throw new TokenlessServiceError(
      "Paid eligibility wallet screening is temporarily unavailable.",
      503,
      "wallet_screening_unavailable",
      true,
    );
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const status = body?.status;
  const listSnapshotHash = body?.listSnapshotHash;
  const reference = body?.reference;
  const expiresAt = new Date(String(body?.expiresAt ?? ""));
  if (
    (status !== "clear" && status !== "review" && status !== "match") ||
    typeof listSnapshotHash !== "string" ||
    !SHA256.test(listSnapshotHash) ||
    typeof reference !== "string" ||
    !reference.trim() ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt <= input.now ||
    expiresAt.getTime() - input.now.getTime() > 370 * 86_400_000
  ) {
    throw new TokenlessServiceError(
      "Paid eligibility wallet screening returned invalid evidence.",
      503,
      "wallet_screening_invalid",
      true,
    );
  }
  return {
    provider,
    status: status as "clear" | "review" | "match",
    listSnapshotHash: listSnapshotHash as `sha256:${string}`,
    referenceHash: hash(`${provider}\0${reference}`),
    expiresAt,
  };
}

export async function evaluatePaidEligibilityRisk(input: {
  payoutAccount: string;
  declaredResidenceCountry: string;
  taxResidenceCountry: string;
  requestContext: PaidEligibilityRequestContext;
  now: Date;
}): Promise<PaidEligibilityRiskResult> {
  const geography = assertPaidEligibilityGeoblock(input.requestContext);
  const reasons = [
    ...(geography.edgeCountry !== input.declaredResidenceCountry ? ["edge_residence_mismatch"] : []),
    ...(geography.localeCountry && geography.localeCountry !== input.declaredResidenceCountry
      ? ["locale_residence_mismatch"]
      : []),
    ...(input.taxResidenceCountry !== input.declaredResidenceCountry ? ["tax_residence_mismatch"] : []),
  ];
  const wallet = await screenWallet({ payoutAccount: input.payoutAccount, now: input.now });
  return {
    ...geography,
    geoblockStatus: "clear",
    plausibilityStatus: reasons.length === 0 ? "pass" : "review",
    plausibilityReasonCodes: reasons,
    walletReferenceHash: hash(input.payoutAccount.toLowerCase()),
    walletScreeningProvider: wallet.provider,
    walletScreeningStatus: wallet.status,
    walletScreeningReferenceHash: wallet.referenceHash,
    walletListSnapshotHash: wallet.listSnapshotHash,
    checkedAt: input.now,
    expiresAt: wallet.expiresAt,
  };
}
