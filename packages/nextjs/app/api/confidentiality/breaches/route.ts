import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME, verifySignedReadSession } from "~~/lib/auth/signedReadSessions";
import { db } from "~~/lib/db";
import { confidentialityBreachReports } from "~~/lib/db/schema";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { isValidWalletAddress, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const CONTENT_ID_PATTERN = /^[0-9]{1,78}$/;

function readOptionalEvidenceUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const contentId = request.nextUrl.searchParams.get("contentId")?.trim();
  if (!contentId || !CONTENT_ID_PATTERN.test(contentId)) {
    return NextResponse.json({ error: "Invalid content id" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(confidentialityBreachReports)
    .where(eq(confidentialityBreachReports.contentId, contentId))
    .limit(50);

  return NextResponse.json({
    reports: rows.map(row => ({
      accusedIdentityKey: row.accusedIdentityKey,
      contentId: row.contentId,
      createdAt: row.createdAt.toISOString(),
      evidenceHash: row.evidenceHash,
      evidenceUrl: row.evidenceUrl,
      id: row.id,
      reporter: row.reporter,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  const body = await parseJsonBody(request);
  if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

  const reporter =
    typeof body.reporter === "string" && isValidWalletAddress(body.reporter)
      ? normalizeWalletAddress(body.reporter)
      : null;
  const contentId = typeof body.contentId === "string" ? body.contentId.trim() : "";
  const accusedIdentityKey =
    typeof body.accusedIdentityKey === "string" ? body.accusedIdentityKey.trim().toLowerCase() : "";
  const evidenceHash = typeof body.evidenceHash === "string" ? body.evidenceHash.trim().toLowerCase() : "";

  if (
    !reporter ||
    !CONTENT_ID_PATTERN.test(contentId) ||
    !BYTES32_PATTERN.test(accusedIdentityKey) ||
    !BYTES32_PATTERN.test(evidenceHash)
  ) {
    return NextResponse.json({ error: "Missing or invalid breach report fields" }, { status: 400 });
  }

  const hasSession = await verifySignedReadSession(
    request.cookies.get(GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME)?.value,
    reporter,
    "gated_context",
  );
  if (!hasSession) {
    return NextResponse.json({ error: "Signed reporter session required" }, { status: 401 });
  }

  const now = new Date();
  const [created] = await db
    .insert(confidentialityBreachReports)
    .values({
      accessLogId:
        typeof body.accessLogId === "number" && Number.isSafeInteger(body.accessLogId) ? body.accessLogId : null,
      accusedIdentityKey,
      contentId,
      createdAt: now,
      epoch: typeof body.epoch === "string" ? body.epoch.trim() || null : null,
      evidenceHash,
      evidenceUrl: readOptionalEvidenceUrl(body.evidenceUrl),
      proof: typeof body.proof === "string" ? body.proof.trim() || null : null,
      reporter,
      status: "reported",
      updatedAt: now,
    })
    .returning({ id: confidentialityBreachReports.id });

  return NextResponse.json({ id: created?.id, ok: true }, { status: 201 });
}
