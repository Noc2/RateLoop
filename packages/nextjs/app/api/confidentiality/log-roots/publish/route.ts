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

function readBodyRequireAnchor(value: unknown, fallback: boolean) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalChainId(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function GET() {
  return NextResponse.json(
    { error: "Method not allowed. Use POST to publish confidentiality log roots." },
    { headers: { Allow: "POST" }, status: 405 },
  );
}

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(request, RATE_LIMIT, {
    extraKeyParts: ["preauth"],
  });
  if (limited) return limited;

  const unauthorized = requireConfidentialityJobAuth(request);
  if (unauthorized) return unauthorized;

  const body = await parseJsonBody(request).catch(() => ({}));
  if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);
  const epoch = readEpoch(typeof body.epoch === "string" ? body.epoch : null);
  const artifactUrl =
    typeof body.artifactUrl === "string" && body.artifactUrl.trim() ? body.artifactUrl.trim() : undefined;
  const anchor = body.anchor === false ? false : undefined;
  const chainId = readOptionalChainId(body.chainId);
  const contentRegistryAddress = readOptionalString(body.contentRegistryAddress);
  const deploymentKey = readOptionalString(body.deploymentKey);
  const requireAnchor = anchor === false ? false : readBodyRequireAnchor(body.requireAnchor, true);

  try {
    return NextResponse.json({
      ok: true,
      ...(await publishConfidentialityLogRoot({
        anchor,
        artifactUrl,
        chainId,
        contentRegistryAddress,
        deploymentKey,
        epoch,
        requireAnchor,
      })),
    });
  } catch (error) {
    console.error("Error publishing confidentiality log root:", error);
    return NextResponse.json({ error: "Failed to publish confidentiality log root" }, { status: 500 });
  }
}
