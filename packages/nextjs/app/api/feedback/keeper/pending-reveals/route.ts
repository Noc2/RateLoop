import { NextRequest, NextResponse } from "next/server";
import { FEEDBACK_KEEPER_RATE_LIMIT, authorizeFeedbackKeeperRequest } from "../auth";
import { leaseContentFeedbackRevealCandidates } from "~~/lib/feedback/contentFeedback";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export async function POST(request: NextRequest) {
  const authFailure = authorizeFeedbackKeeperRequest(request);
  if (authFailure) return authFailure;

  const limited = await checkRateLimit(request, FEEDBACK_KEEPER_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    extraKeyParts: ["feedback-reveal-pending"],
  });
  if (limited) return limited;

  const limit = parsePositiveInt(request.nextUrl.searchParams.get("limit"), 25, 100);
  const leaseSeconds = parsePositiveInt(request.nextUrl.searchParams.get("leaseSeconds"), 120, 900);
  const chainId = Number.parseInt(request.nextUrl.searchParams.get("chainId") ?? "", 10);

  try {
    const items = await leaseContentFeedbackRevealCandidates({
      limit,
      leaseSeconds,
      chainId: Number.isSafeInteger(chainId) && chainId > 0 ? chainId : undefined,
    });

    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error("Error leasing feedback reveal jobs:", error);
    return NextResponse.json({ error: "Failed to lease feedback reveal jobs" }, { status: 500 });
  }
}
