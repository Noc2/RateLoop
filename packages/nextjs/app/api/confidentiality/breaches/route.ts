import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME, verifySignedReadSession } from "~~/lib/auth/signedReadSessions";
import { confidentialityEpochForDate } from "~~/lib/confidentiality/context";
import { db } from "~~/lib/db";
import { confidentialContextAccessLogs, confidentialityBreachReports, confidentialityLogRoots } from "~~/lib/db/schema";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { isValidWalletAddress, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const CONTENT_ID_PATTERN = /^[0-9]{1,78}$/;
const VIEW_TOKEN_PATTERN = /^[0-9a-fA-F]{64}$/;

function readOptionalEvidenceUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function readOptionalViewToken(value: unknown) {
  if (value === undefined || value === null || value === "") return { ok: true as const, viewToken: null };
  if (typeof value !== "string") return { ok: false as const };
  const viewToken = value.trim().toLowerCase();
  return VIEW_TOKEN_PATTERN.test(viewToken) ? { ok: true as const, viewToken } : { ok: false as const };
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
      accessLogId: row.accessLogId,
      epoch: row.epoch,
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

  const viewTokenResult = readOptionalViewToken(body.viewToken);
  if (!viewTokenResult.ok) {
    return NextResponse.json({ error: "Invalid view token" }, { status: 400 });
  }

  let verifiedAccess: {
    accessLogId: number;
    epoch: string;
    proof: string;
    status: "access_rooted" | "access_verified";
  } | null = null;

  if (viewTokenResult.viewToken) {
    const [accessLog] = await db
      .select({
        contentId: confidentialContextAccessLogs.contentId,
        id: confidentialContextAccessLogs.id,
        identityKey: confidentialContextAccessLogs.identityKey,
        resourceId: confidentialContextAccessLogs.resourceId,
        resourceKind: confidentialContextAccessLogs.resourceKind,
        viewedAt: confidentialContextAccessLogs.viewedAt,
      })
      .from(confidentialContextAccessLogs)
      .where(
        and(
          eq(confidentialContextAccessLogs.viewToken, viewTokenResult.viewToken),
          eq(confidentialContextAccessLogs.contentId, contentId),
          eq(confidentialContextAccessLogs.identityKey, accusedIdentityKey),
        ),
      )
      .limit(1);

    if (!accessLog) {
      return NextResponse.json({ error: "View token does not match a confidential access log" }, { status: 400 });
    }

    const epoch = confidentialityEpochForDate(accessLog.viewedAt);
    const [root] = await db
      .select({
        artifactHash: confidentialityLogRoots.artifactHash,
        artifactUrl: confidentialityLogRoots.artifactUrl,
        merkleRoot: confidentialityLogRoots.merkleRoot,
        publishedAt: confidentialityLogRoots.publishedAt,
      })
      .from(confidentialityLogRoots)
      .where(eq(confidentialityLogRoots.epoch, epoch))
      .limit(1);

    verifiedAccess = {
      accessLogId: accessLog.id,
      epoch,
      proof: JSON.stringify({
        accessLog: {
          contentId: accessLog.contentId,
          id: accessLog.id,
          identityKey: accessLog.identityKey,
          resourceId: accessLog.resourceId,
          resourceKind: accessLog.resourceKind,
          viewedAt: accessLog.viewedAt.toISOString(),
        },
        logRoot: root
          ? {
              artifactHash: root.artifactHash,
              artifactUrl: root.artifactUrl,
              epoch,
              merkleRoot: root.merkleRoot,
              publishedAt: root.publishedAt.toISOString(),
            }
          : null,
        schemaVersion: "rateloop.confidentiality-breach-proof.v1",
        viewToken: viewTokenResult.viewToken,
      }),
      status: root ? "access_rooted" : "access_verified",
    };
  }

  const now = new Date();
  const [created] = await db
    .insert(confidentialityBreachReports)
    .values({
      accessLogId:
        verifiedAccess?.accessLogId ??
        (typeof body.accessLogId === "number" && Number.isSafeInteger(body.accessLogId) ? body.accessLogId : null),
      accusedIdentityKey,
      contentId,
      createdAt: now,
      epoch: verifiedAccess?.epoch ?? (typeof body.epoch === "string" ? body.epoch.trim() || null : null),
      evidenceHash,
      evidenceUrl: readOptionalEvidenceUrl(body.evidenceUrl),
      proof: verifiedAccess?.proof ?? (typeof body.proof === "string" ? body.proof.trim() || null : null),
      reporter,
      status: verifiedAccess?.status ?? "reported",
      updatedAt: now,
    })
    .returning({ id: confidentialityBreachReports.id });

  return NextResponse.json({ id: created?.id, ok: true }, { status: 201 });
}
