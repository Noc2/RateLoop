import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "~~/lib/db";
import { confidentialityLogRoots } from "~~/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EPOCH_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function readDeploymentKey(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("deploymentKey")?.trim().toLowerCase();
  return value || null;
}

function readFrontendAddress(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("frontendAddress")?.trim();
  return value || null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ epoch: string }> }) {
  const { epoch } = await params;
  if (!EPOCH_PATTERN.test(epoch)) {
    return NextResponse.json({ error: "Invalid epoch" }, { status: 400 });
  }

  const deploymentKey = readDeploymentKey(request);
  const frontendAddress = readFrontendAddress(request);
  const rows = await db
    .select({
      artifactHash: confidentialityLogRoots.artifactHash,
      artifactJson: confidentialityLogRoots.artifactJson,
      deploymentKey: confidentialityLogRoots.deploymentKey,
      frontendAddress: confidentialityLogRoots.frontendAddress,
      merkleRoot: confidentialityLogRoots.merkleRoot,
    })
    .from(confidentialityLogRoots)
    .where(
      deploymentKey
        ? and(
            eq(confidentialityLogRoots.deploymentKey, deploymentKey),
            ...(frontendAddress ? [eq(confidentialityLogRoots.frontendAddress, frontendAddress)] : []),
            eq(confidentialityLogRoots.epoch, epoch),
          )
        : eq(confidentialityLogRoots.epoch, epoch),
    )
    .limit(deploymentKey && frontendAddress ? 1 : 2);
  if ((!deploymentKey || !frontendAddress) && rows.length > 1) {
    return NextResponse.json(
      { error: "deploymentKey and frontendAddress are required for this epoch" },
      { status: 400 },
    );
  }
  const [row] = rows;

  if (!row?.artifactJson) {
    return NextResponse.json({ error: "Confidentiality log-root artifact not found" }, { status: 404 });
  }

  return new NextResponse(row.artifactJson, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": "application/json; charset=utf-8",
      "x-rateloop-artifact-hash": row.artifactHash ?? "",
      "x-rateloop-deployment-key": row.deploymentKey,
      "x-rateloop-frontend-address": row.frontendAddress,
      "x-rateloop-merkle-root": row.merkleRoot,
    },
  });
}
