import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sweepOrphanedImageAttachments } from "~~/lib/attachments/imageAttachments";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SWEEP_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

function isAuthorizedSweepRequest(token: string, secret: string) {
  const tokenBuffer = Buffer.from(token);
  const secretBuffer = Buffer.from(secret);
  return tokenBuffer.length === secretBuffer.length && timingSafeEqual(tokenBuffer, secretBuffer);
}

function parseLimit(request: NextRequest) {
  const value = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 500) : 100;
}

export async function POST(request: NextRequest) {
  const secret = process.env.RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET?.trim() ?? "";
  if (!secret) {
    return NextResponse.json({ error: "Image attachment sweep is not configured." }, { status: 503 });
  }

  const limited = await checkRateLimit(request, SWEEP_RATE_LIMIT, { allowOnStoreUnavailable: false });
  if (limited) return limited;

  const token = request.headers.get("x-rateloop-image-attachment-sweep-secret")?.trim() || readBearerToken(request);
  if (!isAuthorizedSweepRequest(token, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json(await sweepOrphanedImageAttachments({ limit: parseLimit(request) }));
}
