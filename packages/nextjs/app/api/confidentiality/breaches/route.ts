import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME, verifySignedReadSession } from "~~/lib/auth/signedReadSessions";
import {
  assertConfidentialityFrontendScopeSchemaReady,
  confidentialityEpochForDate,
  resolveConfidentialityFrontendAddress,
  resolveCurrentConfidentialityDeploymentScope,
} from "~~/lib/confidentiality/context";
import { db } from "~~/lib/db";
import { confidentialContextAccessLogs, confidentialityBreachReports, confidentialityLogRoots } from "~~/lib/db/schema";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { isValidWalletAddress, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const WRITE_RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const CONTENT_ID_PATTERN = /^[0-9]{1,78}$/;
const VIEW_TOKEN_PATTERN = /^[0-9a-fA-F]{64}$/;
const BREACH_EVIDENCE_SCHEMA_VERSION = "rateloop.confidentiality-breach-evidence.v1";

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

function readOptionalBytes32(value: unknown) {
  if (value === undefined || value === null || value === "") return { ok: true as const, value: null };
  if (typeof value !== "string") return { ok: false as const };
  const normalized = value.trim().toLowerCase();
  return BYTES32_PATTERN.test(normalized) ? { ok: true as const, value: normalized } : { ok: false as const };
}

function readOptionalDeploymentKey(value: unknown) {
  if (value === undefined || value === null || value === "") return { ok: true as const, value: null };
  if (typeof value !== "string") return { ok: false as const };
  const deploymentKey = value.trim().toLowerCase();
  return deploymentKey ? { ok: true as const, value: deploymentKey } : { ok: false as const };
}

function readOptionalFrontendAddress(value: unknown) {
  if (value === undefined || value === null || value === "") return { ok: true as const, value: null };
  return typeof value === "string" && isValidWalletAddress(value)
    ? { ok: true as const, value: normalizeWalletAddress(value) }
    : { ok: false as const };
}

function hashEvidenceArtifactJson(artifactJson: string) {
  return `0x${createHash("sha256").update(artifactJson).digest("hex")}`;
}

function accessLogLeafHash(params: {
  chainId: number | null;
  contentId: string;
  contentRegistryAddress: string | null;
  deploymentKey: string;
  frontendAddress: string;
  identityKey: string;
  resourceId: string;
  resourceKind: string;
  viewedAt: Date;
  viewToken: string;
  walletAddress: string;
}) {
  return `0x${createHash("sha256")
    .update(
      JSON.stringify([
        "access",
        params.deploymentKey,
        params.frontendAddress,
        params.chainId,
        params.contentRegistryAddress,
        params.walletAddress,
        params.identityKey,
        params.contentId,
        params.resourceKind,
        params.resourceId,
        params.viewToken,
        params.viewedAt.toISOString(),
      ]),
    )
    .digest("hex")}`;
}

function breachEvidenceArtifactUrl(request: NextRequest, reportId: number) {
  return new URL(`/api/confidentiality/breaches/${reportId}/artifact`, request.url).toString();
}

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, READ_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    routeKey: "/api/confidentiality/breaches",
  });
  if (limited) return limited;

  const contentId = request.nextUrl.searchParams.get("contentId")?.trim();
  if (!contentId || !CONTENT_ID_PATTERN.test(contentId)) {
    return NextResponse.json({ error: "Invalid content id" }, { status: 400 });
  }

  const requestedDeploymentKey = readOptionalDeploymentKey(request.nextUrl.searchParams.get("deploymentKey"));
  const requestedFrontendAddress = readOptionalFrontendAddress(request.nextUrl.searchParams.get("frontendAddress"));
  if (!requestedDeploymentKey.ok || !requestedFrontendAddress.ok) {
    return NextResponse.json({ error: "Invalid confidentiality deployment scope" }, { status: 400 });
  }

  const currentDeploymentScope = requestedDeploymentKey.value ? null : resolveCurrentConfidentialityDeploymentScope();
  const deploymentKey = requestedDeploymentKey.value ?? currentDeploymentScope?.deploymentKey ?? null;
  const frontendAddress = requestedFrontendAddress.value ?? resolveConfidentialityFrontendAddress();
  if (!deploymentKey || !frontendAddress) {
    return NextResponse.json({ error: "Confidentiality deployment is not configured" }, { status: 503 });
  }

  await assertConfidentialityFrontendScopeSchemaReady(frontendAddress);
  const rows = await db
    .select()
    .from(confidentialityBreachReports)
    .where(
      and(
        eq(confidentialityBreachReports.deploymentKey, deploymentKey),
        eq(confidentialityBreachReports.frontendAddress, frontendAddress),
        eq(confidentialityBreachReports.contentId, contentId),
      ),
    )
    .limit(50);

  return NextResponse.json({
    reports: rows.map(row => ({
      accusedIdentityKey: row.accusedIdentityKey,
      contentId: row.contentId,
      createdAt: row.createdAt.toISOString(),
      evidenceHash: row.evidenceHash,
      evidenceArtifactUrl:
        row.proof && hashEvidenceArtifactJson(row.proof) === row.evidenceHash
          ? breachEvidenceArtifactUrl(request, row.id)
          : null,
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
  const limited = await checkRateLimit(request, WRITE_RATE_LIMIT);
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
  const expectedEvidenceHash = readOptionalBytes32(body.evidenceHash);
  const externalEvidenceHash = readOptionalBytes32(body.externalEvidenceHash);
  const evidenceUrl = readOptionalEvidenceUrl(body.evidenceUrl);
  const requestedDeploymentKey = readOptionalDeploymentKey(body.deploymentKey);
  const requestedFrontendAddress = readOptionalFrontendAddress(body.frontendAddress);

  if (
    !reporter ||
    !CONTENT_ID_PATTERN.test(contentId) ||
    !BYTES32_PATTERN.test(accusedIdentityKey) ||
    !expectedEvidenceHash.ok ||
    !externalEvidenceHash.ok ||
    !requestedDeploymentKey.ok ||
    !requestedFrontendAddress.ok
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

  if (!viewTokenResult.viewToken) {
    return NextResponse.json({ error: "A matching view token is required to file breach evidence" }, { status: 400 });
  }

  const currentDeploymentScope = requestedDeploymentKey.value ? null : resolveCurrentConfidentialityDeploymentScope();
  const deploymentKey = requestedDeploymentKey.value ?? currentDeploymentScope?.deploymentKey ?? null;
  const frontendAddress = requestedFrontendAddress.value ?? resolveConfidentialityFrontendAddress();
  if (!deploymentKey || !frontendAddress) {
    return NextResponse.json({ error: "Confidentiality deployment is not configured" }, { status: 503 });
  }

  const [accessLog] = await db
    .select({
      contentId: confidentialContextAccessLogs.contentId,
      chainId: confidentialContextAccessLogs.chainId,
      contentRegistryAddress: confidentialContextAccessLogs.contentRegistryAddress,
      deploymentKey: confidentialContextAccessLogs.deploymentKey,
      frontendAddress: confidentialContextAccessLogs.frontendAddress,
      id: confidentialContextAccessLogs.id,
      identityKey: confidentialContextAccessLogs.identityKey,
      resourceId: confidentialContextAccessLogs.resourceId,
      resourceKind: confidentialContextAccessLogs.resourceKind,
      viewedAt: confidentialContextAccessLogs.viewedAt,
      walletAddress: confidentialContextAccessLogs.walletAddress,
    })
    .from(confidentialContextAccessLogs)
    .where(
      and(
        eq(confidentialContextAccessLogs.viewToken, viewTokenResult.viewToken),
        eq(confidentialContextAccessLogs.deploymentKey, deploymentKey),
        eq(confidentialContextAccessLogs.frontendAddress, frontendAddress),
        eq(confidentialContextAccessLogs.contentId, contentId),
        eq(confidentialContextAccessLogs.identityKey, accusedIdentityKey),
      ),
    )
    .limit(1);

  if (!accessLog) {
    return NextResponse.json({ error: "View token does not match a confidential access log" }, { status: 400 });
  }

  const accessIdentityKey = accessLog.identityKey ?? accusedIdentityKey;
  const accessDeploymentKey = accessLog.deploymentKey;
  if (!accessDeploymentKey) {
    return NextResponse.json(
      { error: "View token does not match a current confidentiality deployment" },
      { status: 400 },
    );
  }
  const accessFrontendAddress = accessLog.frontendAddress;
  await assertConfidentialityFrontendScopeSchemaReady(accessFrontendAddress);
  const epoch = confidentialityEpochForDate(accessLog.viewedAt);
  const [root] = await db
    .select({
      anchorChainId: confidentialityLogRoots.anchorChainId,
      anchorContract: confidentialityLogRoots.anchorContract,
      anchorPublishedAt: confidentialityLogRoots.anchorPublishedAt,
      anchorTxHash: confidentialityLogRoots.anchorTxHash,
      artifactHash: confidentialityLogRoots.artifactHash,
      artifactUrl: confidentialityLogRoots.artifactUrl,
      chainId: confidentialityLogRoots.chainId,
      contentRegistryAddress: confidentialityLogRoots.contentRegistryAddress,
      deploymentKey: confidentialityLogRoots.deploymentKey,
      frontendAddress: confidentialityLogRoots.frontendAddress,
      merkleRoot: confidentialityLogRoots.merkleRoot,
      publishedAt: confidentialityLogRoots.publishedAt,
    })
    .from(confidentialityLogRoots)
    .where(
      and(
        eq(confidentialityLogRoots.deploymentKey, accessDeploymentKey),
        eq(confidentialityLogRoots.frontendAddress, accessFrontendAddress),
        eq(confidentialityLogRoots.epoch, epoch),
      ),
    )
    .limit(1);

  if (!root?.anchorTxHash) {
    return NextResponse.json(
      { error: "An anchored confidentiality log root is required before filing breach evidence" },
      { status: 409 },
    );
  }

  const now = new Date();
  const evidenceArtifact = {
    schemaVersion: BREACH_EVIDENCE_SCHEMA_VERSION,
    contentId,
    deploymentKey: accessDeploymentKey,
    frontendAddress: accessFrontendAddress,
    accusedIdentityKey,
    reporter,
    createdAt: now.toISOString(),
    externalEvidence: {
      hash: externalEvidenceHash.value,
      url: evidenceUrl,
    },
    accessLog: {
      chainId: accessLog.chainId,
      contentId: accessLog.contentId,
      contentRegistryAddress: accessLog.contentRegistryAddress,
      deploymentKey: accessDeploymentKey,
      frontendAddress: accessFrontendAddress,
      id: accessLog.id,
      identityKey: accessIdentityKey,
      resourceId: accessLog.resourceId,
      resourceKind: accessLog.resourceKind,
      viewedAt: accessLog.viewedAt.toISOString(),
      viewToken: viewTokenResult.viewToken,
      walletAddress: accessLog.walletAddress,
      leafHash: accessLogLeafHash({
        chainId: accessLog.chainId,
        contentId: accessLog.contentId,
        contentRegistryAddress: accessLog.contentRegistryAddress,
        deploymentKey: accessDeploymentKey,
        frontendAddress: accessFrontendAddress,
        identityKey: accessIdentityKey,
        resourceId: accessLog.resourceId,
        resourceKind: accessLog.resourceKind,
        viewedAt: accessLog.viewedAt,
        viewToken: viewTokenResult.viewToken,
        walletAddress: accessLog.walletAddress,
      }),
    },
    logRoot: {
      anchor: {
        chainId: root.anchorChainId,
        contract: root.anchorContract,
        publishedAt: root.anchorPublishedAt?.toISOString() ?? null,
        txHash: root.anchorTxHash,
      },
      artifactHash: root.artifactHash,
      artifactUrl: root.artifactUrl,
      chainId: root.chainId,
      contentRegistryAddress: root.contentRegistryAddress,
      deploymentKey: root.deploymentKey,
      frontendAddress: root.frontendAddress,
      epoch,
      merkleRoot: root.merkleRoot,
      publishedAt: root.publishedAt.toISOString(),
    },
  };
  const proof = JSON.stringify(evidenceArtifact);
  const evidenceHash = hashEvidenceArtifactJson(proof);

  if (expectedEvidenceHash.value && expectedEvidenceHash.value !== evidenceHash) {
    return NextResponse.json({ error: "evidenceHash must match the breach evidence artifact" }, { status: 400 });
  }

  const [created] = await db
    .insert(confidentialityBreachReports)
    .values({
      accessLogId: accessLog.id,
      accusedIdentityKey,
      chainId: accessLog.chainId,
      contentId,
      contentRegistryAddress: accessLog.contentRegistryAddress,
      deploymentKey: accessDeploymentKey,
      createdAt: now,
      epoch,
      evidenceHash,
      evidenceUrl,
      frontendAddress: accessFrontendAddress,
      proof,
      reporter,
      status: "evidence_artifact_published",
      updatedAt: now,
    })
    .returning({ id: confidentialityBreachReports.id });

  return NextResponse.json(
    {
      evidenceArtifactUrl: created?.id ? breachEvidenceArtifactUrl(request, created.id) : null,
      evidenceHash,
      id: created?.id,
      ok: true,
    },
    { status: 201 },
  );
}
