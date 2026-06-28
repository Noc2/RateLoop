import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sweepOrphanedQuestionDetails } from "~~/lib/attachments/questionDetails";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SWEEP_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

function isAuthorizedSweepSecret(candidate: string, secret: string) {
  const candidateBuffer = Buffer.from(candidate);
  const secretBuffer = Buffer.from(secret);
  return candidateBuffer.length === secretBuffer.length && timingSafeEqual(candidateBuffer, secretBuffer);
}

export async function POST(request: NextRequest) {
  const secret = process.env.RATELOOP_QUESTION_DETAILS_SWEEP_SECRET?.trim() ?? "";
  if (!secret) {
    return NextResponse.json({ error: "Question details sweep is not configured." }, { status: 503 });
  }

  const limited = await checkRateLimit(request, SWEEP_RATE_LIMIT, { allowOnStoreUnavailable: true });
  if (limited) return limited;

  const token = request.headers.get("x-rateloop-sweep-secret")?.trim() || readBearerToken(request);
  if (!isAuthorizedSweepSecret(token, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await sweepOrphanedQuestionDetails();
  return NextResponse.json(result);
}
