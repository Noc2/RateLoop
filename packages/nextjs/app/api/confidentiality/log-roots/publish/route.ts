import { NextRequest, NextResponse } from "next/server";
import { publishConfidentialityLogRoot } from "~~/lib/confidentiality/context";
import { requireConfidentialityJobAuth } from "~~/lib/confidentiality/routeAuth";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const EPOCH_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function readEpoch(value: string | null) {
  return value && EPOCH_PATTERN.test(value) ? value : undefined;
}

function readArtifactUrl(value: string | null) {
  return value?.trim() || undefined;
}

function readAnchor(value: string | null) {
  return value === "false" ? false : undefined;
}

export async function GET(request: NextRequest) {
  const unauthorized = requireConfidentialityJobAuth(request);
  if (unauthorized) return unauthorized;

  const limited = await checkRateLimit(request, RATE_LIMIT, { allowOnStoreUnavailable: true });
  if (limited) return limited;

  try {
    return NextResponse.json({
      ok: true,
      ...(await publishConfidentialityLogRoot({
        anchor: readAnchor(request.nextUrl.searchParams.get("anchor")),
        artifactUrl: readArtifactUrl(request.nextUrl.searchParams.get("artifactUrl")),
        epoch: readEpoch(request.nextUrl.searchParams.get("epoch")),
      })),
    });
  } catch (error) {
    console.error("Error publishing confidentiality log root:", error);
    return NextResponse.json({ error: "Failed to publish confidentiality log root" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = requireConfidentialityJobAuth(request);
  if (unauthorized) return unauthorized;

  const limited = await checkRateLimit(request, RATE_LIMIT, { allowOnStoreUnavailable: true });
  if (limited) return limited;

  const body = await parseJsonBody(request).catch(() => ({}));
  if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);
  const epoch = readEpoch(typeof body.epoch === "string" ? body.epoch : null);
  const artifactUrl =
    typeof body.artifactUrl === "string" && body.artifactUrl.trim() ? body.artifactUrl.trim() : undefined;
  const anchor = body.anchor === false ? false : undefined;

  try {
    return NextResponse.json({
      ok: true,
      ...(await publishConfidentialityLogRoot({ anchor, artifactUrl, epoch })),
    });
  } catch (error) {
    console.error("Error publishing confidentiality log root:", error);
    return NextResponse.json({ error: "Failed to publish confidentiality log root" }, { status: 500 });
  }
}
