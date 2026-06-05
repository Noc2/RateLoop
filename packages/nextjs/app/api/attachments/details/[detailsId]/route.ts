import { NextRequest, NextResponse } from "next/server";
import { getQuestionDetails, isQuestionDetailsId } from "~~/lib/attachments/questionDetails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DETAILS_RESPONSE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "X-RateLoop-Details-Hash",
  "Cache-Control": "public, max-age=31536000, immutable",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      ...DETAILS_RESPONSE_HEADERS,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ detailsId: string }> }) {
  const { detailsId } = await params;
  if (!isQuestionDetailsId(detailsId)) {
    return NextResponse.json({ error: "Invalid details id." }, { headers: DETAILS_RESPONSE_HEADERS, status: 400 });
  }

  const details = await getQuestionDetails(detailsId);
  if (!details || details.status !== "approved" || !details.normalizedText) {
    return NextResponse.json(
      { error: "Question details not found." },
      { headers: DETAILS_RESPONSE_HEADERS, status: 404 },
    );
  }

  return new NextResponse(details.normalizedText, {
    headers: {
      ...DETAILS_RESPONSE_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "X-RateLoop-Details-Hash": `0x${details.sha256}`,
    },
  });
}
