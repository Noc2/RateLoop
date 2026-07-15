import { NextRequest, NextResponse } from "next/server";
import { type RaterCommitRequest, relayPaidRaterCommit } from "~~/lib/tokenless/raterService";
import { requireRaterSession } from "~~/lib/tokenless/raterSession";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await requireRaterSession(request, true);
    const body = (await request.json()) as Partial<RaterCommitRequest>;
    const idempotencyKey = request.headers.get("idempotency-key") ?? body.idempotencyKey;
    if (!idempotencyKey || !body.voucherId || !body.authorization) {
      throw new TokenlessServiceError("Commit request is incomplete.", 400, "invalid_commit_request");
    }
    return NextResponse.json(
      await relayPaidRaterCommit({
        accountAddress: session.payoutAddress,
        request: { idempotencyKey, voucherId: body.voucherId, authorization: body.authorization },
      }),
      { status: 202 },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
