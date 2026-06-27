import { NextRequest, NextResponse } from "next/server";
import { reconcileConfidentialDisclosure, reconcileDueConfidentialDisclosure } from "~~/lib/confidentiality/context";
import { requireConfidentialityJobAuth } from "~~/lib/confidentiality/routeAuth";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

function readContentIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => (typeof item === "string" || typeof item === "number" || typeof item === "bigint" ? String(item) : ""))
    .map(item => item.trim())
    .filter(item => /^[0-9]{1,78}$/.test(item));
}

function readLimit(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, RATE_LIMIT, {
    extraKeyParts: ["preauth"],
  });
  if (limited) return limited;

  const unauthorized = requireConfidentialityJobAuth(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json({
    ok: true,
    ...(await reconcileDueConfidentialDisclosure({
      limit: readLimit(request.nextUrl.searchParams.get("limit")),
      scanLimit: readLimit(request.nextUrl.searchParams.get("scanLimit")),
    })),
  });
}

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(request, RATE_LIMIT, {
    extraKeyParts: ["preauth"],
  });
  if (limited) return limited;

  const unauthorized = requireConfidentialityJobAuth(request);
  if (unauthorized) return unauthorized;

  const body = await parseJsonBody(request);
  if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

  const contentIds = readContentIds(body.contentIds);
  if (contentIds.length === 0) {
    return NextResponse.json({ error: "contentIds is required" }, { status: 400 });
  }

  const settledAt = typeof body.settledAt === "string" ? new Date(body.settledAt) : undefined;
  if (settledAt && Number.isNaN(settledAt.getTime())) {
    return NextResponse.json({ error: "Invalid settledAt" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    ...(await reconcileConfidentialDisclosure({ settledAt, settledContentIds: contentIds })),
  });
}
