import { NextRequest, NextResponse } from "next/server";
import { resolveContentMetadataBatch } from "~~/lib/contentMetadata/server";
import { jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";
import { isSafeUrl } from "~~/utils/urlSafety";

export const runtime = "nodejs";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const MAX_URLS = 20;
const MAX_HOSTS = 8;
const MAX_URLS_PER_HOST = 5;

function normalizeThumbnailUrls(value: unknown): { ok: true; urls: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "urls array required" };
  }

  const rawUrls = value
    .filter((url): url is string => typeof url === "string")
    .map(url => url.trim())
    .filter(Boolean);
  if (rawUrls.length === 0) {
    return { ok: false, error: "urls array required" };
  }
  if (rawUrls.length > MAX_URLS) {
    return { ok: false, error: `At most ${MAX_URLS} URLs are allowed per request` };
  }

  const urls = [...new Set(rawUrls)];
  const hostCounts = new Map<string, number>();
  for (const url of urls) {
    let hostname: string;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    hostCounts.set(hostname, (hostCounts.get(hostname) ?? 0) + 1);
  }
  if (hostCounts.size > MAX_HOSTS) {
    return { ok: false, error: `At most ${MAX_HOSTS} URL hosts are allowed per request` };
  }
  if ([...hostCounts.values()].some(count => count > MAX_URLS_PER_HOST)) {
    return { ok: false, error: `At most ${MAX_URLS_PER_HOST} URLs are allowed per host` };
  }

  return { ok: true, urls };
}

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  const body = await parseJsonBody(request);
  if (body === null || typeof body === "symbol") {
    return jsonBodyErrorResponse(body, "Invalid JSON body");
  }

  const parsedUrls = normalizeThumbnailUrls((body as { urls?: unknown })?.urls);
  if (!parsedUrls.ok) {
    return NextResponse.json({ error: parsedUrls.error }, { status: 400 });
  }

  // Filter out URLs that fail SSRF safety checks
  const safeChecks = await Promise.all(parsedUrls.urls.map(url => isSafeUrl(url)));
  const safeUrls = parsedUrls.urls.filter((_, i) => safeChecks[i]);

  if (safeUrls.length === 0) {
    return NextResponse.json({ error: "No valid URLs provided" }, { status: 400 });
  }

  const items = await resolveContentMetadataBatch(safeUrls);
  return NextResponse.json({ items });
}
