import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { readApiJsonRequestBody, rethrowApiRequestBodyBoundaryError } from "~~/lib/tokenless/apiRequestBody";
import { type AssuranceCaseResponseInput, submitAssuranceResponses } from "~~/lib/tokenless/assuranceResponses";
import { submitDsaContentSelfIdentificationReportIfExists } from "~~/lib/tokenless/dsaContentSelfIdentification";
import { submitDsaNamedPanelResponseIfExists } from "~~/lib/tokenless/dsaNamedReferencePanel";
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
    let body: {
      idempotencyKey?: string;
      responses?: AssuranceCaseResponseInput[];
      dsaResponse?: { choice: "policy_matches" | "policy_does_not_match"; rationale: string };
      dsaGapReport?: { reason: "content_self_identification" };
    };
    try {
      body = (await readAssuranceResponseBatchBody(request)) as typeof body;
    } catch (requestBodyError) {
      rethrowApiRequestBodyBoundaryError(requestBodyError);
      throw new TokenlessServiceError("Response batch must be valid JSON.", 400, "invalid_assurance_response");
    }
    let result;
    if (isDirectPrivateReviewAssignmentId(assignmentId)) {
      result = await submitDirectPrivateReviewResponse({
        assignmentId,
        accountAddress: session.principalId,
        idempotencyKey: body.idempotencyKey ?? "",
        responses: body.responses ?? [],
      });
    } else if (body.dsaGapReport !== undefined) {
      const bodyKeys = Object.keys(body).sort();
      const reportKeys =
        body.dsaGapReport && typeof body.dsaGapReport === "object" && !Array.isArray(body.dsaGapReport)
          ? Object.keys(body.dsaGapReport).sort()
          : [];
      if (
        bodyKeys.length !== 1 ||
        bodyKeys[0] !== "dsaGapReport" ||
        reportKeys.length !== 1 ||
        reportKeys[0] !== "reason"
      )
        throw new TokenlessServiceError(
          "Content self-identification report contains unsupported fields.",
          400,
          "invalid_dsa_named_panel_content_self_identification_report",
        );
      result = await submitDsaContentSelfIdentificationReportIfExists({
        assignmentId,
        accountAddress: session.principalId,
        reason: body.dsaGapReport.reason,
      });
      if (!result)
        throw new TokenlessServiceError(
          "DSA reference-panel assignment not found.",
          404,
          "dsa_named_panel_assignment_not_found",
        );
    } else {
      result =
        (await submitDsaNamedPanelResponseIfExists({
          assignmentId,
          accountAddress: session.principalId,
          idempotencyKey: body.idempotencyKey ?? "",
          response: body.dsaResponse,
        })) ??
        (await submitAssuranceResponses({
          assignmentId,
          baseAccountAddress: session.principalId,
          idempotencyKey: body.idempotencyKey ?? "",
          responses: body.responses ?? [],
        }));
    }
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
