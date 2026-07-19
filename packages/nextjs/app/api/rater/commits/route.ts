import { NextRequest, NextResponse } from "next/server";
import { type RaterCommitRequest, relayPaidRaterCommit } from "~~/lib/tokenless/raterService";
import { requireRaterSession } from "~~/lib/tokenless/raterSession";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const MAX_RATER_COMMIT_BODY_BYTES = 64 * 1_024;

async function readCommitBody(request: NextRequest) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_RATER_COMMIT_BODY_BYTES) {
      throw new TokenlessServiceError("Commit request is too large.", 413, "commit_request_too_large");
    }
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_RATER_COMMIT_BODY_BYTES) {
    throw new TokenlessServiceError("Commit request is too large.", 413, "commit_request_too_large");
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as Partial<RaterCommitRequest>;
  } catch {
    throw new TokenlessServiceError("Commit request must be valid JSON.", 400, "invalid_commit_request");
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireRaterSession(request, true);
    const body = await readCommitBody(request);
    const idempotencyKey = request.headers.get("idempotency-key") ?? body.idempotencyKey;
    if (!idempotencyKey || !body.voucherId || !body.authorization || !body.response) {
      throw new TokenlessServiceError("Commit request is incomplete.", 400, "invalid_commit_request");
    }
    return NextResponse.json(
      await relayPaidRaterCommit({
        principalId: session.principalId,
        request: {
          idempotencyKey,
          voucherId: body.voucherId,
          authorization: body.authorization,
          response: body.response,
        },
      }),
      { status: 202 },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
