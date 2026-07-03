import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sweepOrphanedImageAttachments } from "~~/lib/attachments/imageAttachments";
import { isBlankQueryNumber, parseStrictPositiveQueryNumber } from "~~/lib/http/queryNumbers";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SWEEP_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

type LimitParseResult = { limit: number; ok: true } | { ok: false; response: NextResponse };

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

function isAuthorizedSweepRequest(token: string, secret: string) {
  const tokenBuffer = Buffer.from(token);
  const secretBuffer = Buffer.from(secret);
  return tokenBuffer.length === secretBuffer.length && timingSafeEqual(tokenBuffer, secretBuffer);
}

function getSweepSecrets() {
  return [process.env.RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET?.trim(), process.env.CRON_SECRET?.trim()].filter(
    (secret): secret is string => Boolean(secret),
  );
}

function parseLimit(request: NextRequest): LimitParseResult {
  const value = request.nextUrl.searchParams.get("limit");
  if (isBlankQueryNumber(value)) return { limit: 100, ok: true };
  const parsed = parseStrictPositiveQueryNumber(value);
  if (parsed === null) {
    return {
      ok: false,
      response: NextResponse.json({ error: "limit must be a positive integer." }, { status: 400 }),
    };
  }
  return { limit: Math.min(parsed, 500), ok: true };
}

async function handleSweep(request: NextRequest) {
  const secrets = getSweepSecrets();
  if (secrets.length === 0) {
    return NextResponse.json({ error: "Image attachment sweep is not configured." }, { status: 503 });
  }

  const limited = await checkRateLimit(request, SWEEP_RATE_LIMIT, { allowOnStoreUnavailable: false });
  if (limited) return limited;

  const token = request.headers.get("x-rateloop-image-attachment-sweep-secret")?.trim() || readBearerToken(request);
  if (!secrets.some(secret => isAuthorizedSweepRequest(token, secret))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const parsedLimit = parseLimit(request);
  if (!parsedLimit.ok) return parsedLimit.response;

  return NextResponse.json(await sweepOrphanedImageAttachments({ limit: parsedLimit.limit }));
}

export async function GET(request: NextRequest) {
  return handleSweep(request);
}

export async function POST(request: NextRequest) {
  return handleSweep(request);
}
