import { NextRequest, NextResponse } from "next/server";
import { publishConfidentialityLogRoot } from "~~/lib/confidentiality/context";
import { requireConfidentialityJobAuth } from "~~/lib/confidentiality/routeAuth";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const EPOCH_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: NextRequest) {
  const unauthorized = requireConfidentialityJobAuth(request);
  if (unauthorized) return unauthorized;

  const limited = await checkRateLimit(request, RATE_LIMIT, { allowOnStoreUnavailable: true });
  if (limited) return limited;

  const body = await parseJsonBody(request).catch(() => ({}));
  if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);
  const epoch = typeof body.epoch === "string" && EPOCH_PATTERN.test(body.epoch) ? body.epoch : undefined;

  try {
    return NextResponse.json({
      ok: true,
      ...(await publishConfidentialityLogRoot({ epoch })),
    });
  } catch (error) {
    console.error("Error publishing confidentiality log root:", error);
    return NextResponse.json({ error: "Failed to publish confidentiality log root" }, { status: 500 });
  }
}
