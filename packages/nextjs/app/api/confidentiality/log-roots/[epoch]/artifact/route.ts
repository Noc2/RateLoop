import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "~~/lib/db";
import { confidentialityLogRoots } from "~~/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EPOCH_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ epoch: string }> }) {
  const { epoch } = await params;
  if (!EPOCH_PATTERN.test(epoch)) {
    return NextResponse.json({ error: "Invalid epoch" }, { status: 400 });
  }

  const [row] = await db
    .select({
      artifactHash: confidentialityLogRoots.artifactHash,
      artifactJson: confidentialityLogRoots.artifactJson,
      merkleRoot: confidentialityLogRoots.merkleRoot,
    })
    .from(confidentialityLogRoots)
    .where(eq(confidentialityLogRoots.epoch, epoch))
    .limit(1);

  if (!row?.artifactJson) {
    return NextResponse.json({ error: "Confidentiality log-root artifact not found" }, { status: 404 });
  }

  return new NextResponse(row.artifactJson, {
    headers: {
      "cache-control": "public, max-age=300, s-maxage=86400",
      "content-type": "application/json; charset=utf-8",
      "x-rateloop-artifact-hash": row.artifactHash ?? "",
      "x-rateloop-merkle-root": row.merkleRoot,
    },
  });
}
