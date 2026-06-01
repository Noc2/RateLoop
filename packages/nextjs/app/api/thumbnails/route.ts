import { NextRequest, NextResponse } from "next/server";
import { resolveContentMetadataBatch } from "~~/lib/contentMetadata/server";
import { jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";
import { isSafeUrl } from "~~/utils/urlSafety";

const RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const MAX_URLS = 40;

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  const body = await parseJsonBody(request);
  if (body === null || typeof body === "symbol") {
    return jsonBodyErrorResponse(body, "Invalid JSON body");
  }

  const urls = Array.isArray((body as { urls?: unknown[] })?.urls)
    ? (body as { urls: unknown[] }).urls.filter((url): url is string => typeof url === "string").slice(0, MAX_URLS)
    : [];

  if (urls.length === 0) {
    return NextResponse.json({ error: "urls array required" }, { status: 400 });
  }

  // Filter out URLs that fail SSRF safety checks
  const safeChecks = await Promise.all(urls.map(url => isSafeUrl(url)));
  const safeUrls = urls.filter((_, i) => safeChecks[i]);

  if (safeUrls.length === 0) {
    return NextResponse.json({ error: "No valid URLs provided" }, { status: 400 });
  }

  const items = await resolveContentMetadataBatch(safeUrls);
  return NextResponse.json({ items });
}
