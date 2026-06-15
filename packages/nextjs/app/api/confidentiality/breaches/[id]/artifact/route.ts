import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "~~/lib/db";
import { confidentialityBreachReports } from "~~/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPORT_ID_PATTERN = /^[0-9]{1,15}$/;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!REPORT_ID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid breach report id" }, { status: 400 });
  }

  const reportId = Number(id);
  if (!Number.isSafeInteger(reportId)) {
    return NextResponse.json({ error: "Invalid breach report id" }, { status: 400 });
  }

  const [row] = await db
    .select({
      evidenceHash: confidentialityBreachReports.evidenceHash,
      proof: confidentialityBreachReports.proof,
    })
    .from(confidentialityBreachReports)
    .where(eq(confidentialityBreachReports.id, reportId))
    .limit(1);

  if (!row?.proof) {
    return NextResponse.json({ error: "Breach evidence artifact not found" }, { status: 404 });
  }

  return new NextResponse(row.proof, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": "application/json; charset=utf-8",
      "x-rateloop-evidence-hash": row.evidenceHash,
    },
  });
}
