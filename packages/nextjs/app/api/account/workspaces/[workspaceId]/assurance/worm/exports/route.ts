import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  WORM_ARTIFACT_TYPES,
  type WormArtifactType,
  buildAssuranceSupervisionReport,
  enqueueAssuranceWormExport,
  listAssuranceWormExports,
  processAssuranceWormExportJob,
} from "~~/lib/tokenless/assuranceWormExports";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ workspaceId: string }> };

function isoDate(value: unknown, field: string) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TokenlessServiceError(`${field} must be an ISO timestamp.`, 400, "invalid_worm_export");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TokenlessServiceError(`${field} must be an ISO timestamp.`, 400, "invalid_worm_export");
  }
  return parsed;
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(await listAssuranceWormExports({ accountAddress: session.principalId, workspaceId }), {
      headers: NO_STORE,
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TokenlessServiceError("Export request is invalid.", 400, "invalid_worm_export");
    }
    const body = raw as Record<string, unknown>;
    const allowed = new Set([
      "artifactType",
      "sourceId",
      "artifact",
      "claimsMoneyOrSettlement",
      "settlementReceipt",
      "from",
      "to",
    ]);
    if (
      Object.keys(body).some(key => !allowed.has(key)) ||
      !WORM_ARTIFACT_TYPES.includes(body.artifactType as WormArtifactType) ||
      (body.claimsMoneyOrSettlement !== undefined && typeof body.claimsMoneyOrSettlement !== "boolean")
    ) {
      throw new TokenlessServiceError("Export request is invalid.", 400, "invalid_worm_export");
    }
    const artifactType = body.artifactType as WormArtifactType;
    if (
      (artifactType === "supervision_report" && body.artifact !== undefined) ||
      (artifactType !== "supervision_report" && (body.from !== undefined || body.to !== undefined))
    ) {
      throw new TokenlessServiceError(
        "Export request fields do not match the artifact type.",
        400,
        "invalid_worm_export",
      );
    }
    const artifact =
      artifactType === "supervision_report"
        ? await buildAssuranceSupervisionReport({
            accountAddress: session.principalId,
            workspaceId,
            from: isoDate(body.from, "from"),
            to: isoDate(body.to, "to"),
          })
        : body.artifact;
    const sourceId =
      artifactType === "supervision_report" && typeof body.sourceId !== "string"
        ? `supervision:${(artifact as { period: { startInclusive: string; endExclusive: string } }).period.startInclusive}:${
            (artifact as { period: { startInclusive: string; endExclusive: string } }).period.endExclusive
          }`
        : body.sourceId;
    let settlementReceipt: { reference: string; hash: string } | null = null;
    if (body.settlementReceipt !== undefined) {
      if (
        !body.settlementReceipt ||
        typeof body.settlementReceipt !== "object" ||
        Array.isArray(body.settlementReceipt)
      ) {
        throw new TokenlessServiceError("Settlement receipt is invalid.", 400, "invalid_worm_export");
      }
      const candidate = body.settlementReceipt as Record<string, unknown>;
      if (
        Object.keys(candidate).some(key => key !== "reference" && key !== "hash") ||
        typeof candidate.reference !== "string" ||
        typeof candidate.hash !== "string"
      ) {
        throw new TokenlessServiceError("Settlement receipt is invalid.", 400, "invalid_worm_export");
      }
      settlementReceipt = { reference: candidate.reference, hash: candidate.hash };
    }
    const queued = await enqueueAssuranceWormExport({
      accountAddress: session.principalId,
      workspaceId,
      artifactType,
      sourceId: typeof sourceId === "string" ? sourceId : "",
      artifact,
      claimsMoneyOrSettlement: body.claimsMoneyOrSettlement === true,
      settlementReceipt,
    });
    const job = queued.state === "delivered" ? queued : await processAssuranceWormExportJob({ jobId: queued.jobId });
    return NextResponse.json(job, { status: job.state === "delivered" ? 201 : 202, headers: NO_STORE });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}
