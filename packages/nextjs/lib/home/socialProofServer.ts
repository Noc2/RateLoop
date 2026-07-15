import { type LandingSocialProofItem, buildLandingPageSocialProofItems } from "./socialProof";
import "server-only";
import { dbClient } from "~~/lib/db";

const LANDING_STATS_REVALIDATE_SECONDS = 300;

type QueryRow = Record<string, unknown>;

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function nonNegativeBigInt(value: unknown) {
  try {
    const parsed = BigInt(String(value ?? 0));
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

function configuredPonderUrl() {
  const value = (process.env.TOKENLESS_PONDER_URL ?? process.env.NEXT_PUBLIC_PONDER_URL)?.trim();
  if (!value) throw new Error("TOKENLESS_PONDER_URL is not configured.");

  const url = new URL(value);
  if (url.username || url.password || url.hash || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("TOKENLESS_PONDER_URL is invalid.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("TOKENLESS_PONDER_URL must use HTTPS in production.");
  }
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/stats`;
  url.search = "";
  return url;
}

async function loadApplicationStats() {
  const result = await dbClient.execute({
    sql: `SELECT
            (SELECT COUNT(DISTINCT a.rater_id)
             FROM tokenless_assurance_assertions a
             JOIN tokenless_provider_subject_bindings b ON b.binding_id = a.binding_id
             WHERE a.status = 'active' AND b.status = 'active'
               AND a.capabilities_json LIKE '%"unique_human"%') AS total_verified_humans,
            ((SELECT COUNT(*) FROM tokenless_assurance_responses
              WHERE validity = 'valid' AND reviewer_source <> 'sandbox') +
             (SELECT COUNT(*) FROM tokenless_public_rater_responses
              WHERE hash_verified_at IS NOT NULL AND moderation_status <> 'rejected')) AS total_ratings,
            (SELECT COALESCE(SUM(bonus_atomic), 0)
             FROM tokenless_surprise_bounty_entitlements WHERE state = 'paid') AS total_bonus_paid_atomic`,
  });
  const row = result.rows[0] as QueryRow | undefined;
  return {
    totalVerifiedHumans: rowString(row, "total_verified_humans") ?? "0",
    totalRatings: rowString(row, "total_ratings") ?? "0",
    totalBonusPaidAtomic: nonNegativeBigInt(rowString(row, "total_bonus_paid_atomic")),
  };
}

async function loadClaimedUsdc() {
  const response = await fetch(configuredPonderUrl(), {
    headers: { accept: "application/json" },
    next: { revalidate: LANDING_STATS_REVALIDATE_SECONDS },
  });
  if (!response.ok) throw new Error(`Ponder stats returned ${response.status}.`);

  const payload = (await response.json()) as { totalClaimedAtomic?: unknown };
  if (payload.totalClaimedAtomic === undefined) throw new Error("Ponder stats omitted totalClaimedAtomic.");
  return nonNegativeBigInt(payload.totalClaimedAtomic);
}

export async function getLandingPageSocialProofItems(): Promise<LandingSocialProofItem[]> {
  try {
    const [applicationStats, totalClaimedAtomic] = await Promise.all([loadApplicationStats(), loadClaimedUsdc()]);
    return buildLandingPageSocialProofItems({
      totalVerifiedHumans: applicationStats.totalVerifiedHumans,
      totalRatings: applicationStats.totalRatings,
      totalPaidAtomic: totalClaimedAtomic + applicationStats.totalBonusPaidAtomic,
    });
  } catch (error) {
    console.warn("[landing-social-proof] Live totals are unavailable; hiding landing stats.", {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
