import { NextRequest } from "next/server";
import { readApiRequestText } from "~~/lib/tokenless/apiRequestBody";
import { privateNoStoreJson } from "~~/lib/tokenless/privateHttpResponse";
import { type RaterCommitRequest, relayPaidRaterCommit } from "~~/lib/tokenless/raterService";
import { requireRaterSession } from "~~/lib/tokenless/raterSession";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const MAX_RATER_COMMIT_BODY_BYTES = 64 * 1_024;

export async function readRaterCommitBody(request: Pick<Request, "body" | "headers">) {
  const body = await readApiRequestText(request, MAX_RATER_COMMIT_BODY_BYTES);
  try {
    return JSON.parse(body) as Partial<RaterCommitRequest>;
  } catch {
    throw new TokenlessServiceError("Commit request must be valid JSON.", 400, "invalid_commit_request");
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireRaterSession(request, true);
    const body = await readRaterCommitBody(request);
    const idempotencyKey = request.headers.get("idempotency-key") ?? body.idempotencyKey;
    if (!idempotencyKey || !body.voucherId || !body.authorization || !body.response) {
      throw new TokenlessServiceError("Commit request is incomplete.", 400, "invalid_commit_request");
    }
    return privateNoStoreJson(
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
    return privateNoStoreJson(response.body, { status: response.status });
  }
}
