import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { readApiJsonRequestBody, rethrowApiRequestBodyBoundaryError } from "~~/lib/tokenless/apiRequestBody";
import { type AssuranceCaseResponseInput, submitAssuranceResponses } from "~~/lib/tokenless/assuranceResponses";
import {
  isDirectPrivateReviewAssignmentId,
  submitDirectPrivateReviewResponse,
} from "~~/lib/tokenless/privateReviewResponses";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const MAX_ASSURANCE_RESPONSE_BATCH_BODY_BYTES = 4 * 1_024 * 1_024;

type Context = { params: Promise<{ assignmentId: string }> };

export const readAssuranceResponseBatchBody = (request: Pick<Request, "body" | "headers">) =>
  readApiJsonRequestBody(request, MAX_ASSURANCE_RESPONSE_BATCH_BODY_BYTES);

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { assignmentId } = await context.params;
    let body: { idempotencyKey?: string; responses?: AssuranceCaseResponseInput[] };
    try {
      body = (await readAssuranceResponseBatchBody(request)) as typeof body;
    } catch (requestBodyError) {
      rethrowApiRequestBodyBoundaryError(requestBodyError);
      throw new TokenlessServiceError("Response batch must be valid JSON.", 400, "invalid_assurance_response");
    }
    const result = isDirectPrivateReviewAssignmentId(assignmentId)
      ? await submitDirectPrivateReviewResponse({
          assignmentId,
          accountAddress: session.principalId,
          idempotencyKey: body.idempotencyKey ?? "",
          responses: body.responses ?? [],
        })
      : await submitAssuranceResponses({
          assignmentId,
          baseAccountAddress: session.principalId,
          idempotencyKey: body.idempotencyKey ?? "",
          responses: body.responses ?? [],
        });
    return NextResponse.json(result, {
      status: result.replay ? 200 : 201,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
