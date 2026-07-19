import { type NextRequest, NextResponse } from "next/server";
import { type VoucherRequest, issuePaidVoucher } from "~~/lib/tokenless/paidEligibility";
import { requireRaterSession } from "~~/lib/tokenless/raterSession";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await requireRaterSession(request, true);
    let body: Partial<VoucherRequest>;
    try {
      body = (await request.json()) as Partial<VoucherRequest>;
    } catch {
      throw new TokenlessServiceError("Voucher request must be valid JSON.", 400, "invalid_voucher_request");
    }
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || body.idempotencyKey;
    if (
      !idempotencyKey ||
      !body.roundId ||
      !body.contentId ||
      !body.voteKey ||
      !["customer_invited", "rateloop_network"].includes(body.reviewerSource ?? "")
    ) {
      throw new TokenlessServiceError("Voucher request fields are incomplete.", 400, "invalid_voucher_request");
    }
    const result = await issuePaidVoucher({
      principalId: session.principalId,
      request: {
        idempotencyKey,
        roundId: body.roundId,
        contentId: body.contentId,
        voteKey: body.voteKey,
        reviewerSource: body.reviewerSource!,
      },
    });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }
}
