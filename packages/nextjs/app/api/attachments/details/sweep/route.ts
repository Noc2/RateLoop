import { NextRequest, NextResponse } from "next/server";
import { sweepOrphanedQuestionDetails } from "~~/lib/attachments/questionDetails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const secret = process.env.RATELOOP_QUESTION_DETAILS_SWEEP_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";

  const bearer = request.headers.get("authorization")?.trim();
  const header = request.headers.get("x-rateloop-sweep-secret")?.trim();
  return bearer === `Bearer ${secret}` || header === secret;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await sweepOrphanedQuestionDetails();
  return NextResponse.json(result);
}
