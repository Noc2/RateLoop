import { NextRequest, NextResponse } from "next/server";
import { lookupLegacyClaim } from "../../../../lib/legacy-claim/lookup";
import { checkRateLimit } from "../../../../utils/rateLimit";

// CLAIM-2 (2026-05-21 testnet-readiness audit): rate-limit the lookup so an attacker can't
// enumerate the legacy-contributor set by brute-forcing addresses. Both eligible and
// not-eligible responses are 200s today; only the body differs. 20 req/min/IP is loose enough
// for legitimate UI use (a connected wallet hits this once per page load) and tight enough that
// crawling the address space is impractical (~28K queries/day vs ~2^160 addresses).
const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export async function GET(request: NextRequest, context: { params: Promise<{ address: string }> }) {
  const limited = await checkRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  const { address } = await context.params;
  const result = lookupLegacyClaim(address);

  if (!result) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
