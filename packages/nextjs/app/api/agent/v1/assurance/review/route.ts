import { NextRequest, NextResponse } from "next/server";
import { JsonRequestBodyError, readJsonRequestBody } from "~~/lib/mcp/requestBody";
import {
  type AdaptiveReviewDecisionRequest,
  type AdaptiveReviewIntegrationBinding,
  authenticateAdaptiveReviewPrincipal,
  evaluateAdaptiveReviewRequirement,
  getAdaptiveAssuranceState,
  resolveAdaptiveReviewIntegrationBinding,
} from "~~/lib/tokenless/adaptiveReviewService";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;

function mismatched(value: string | number | undefined | null, bound: string | number) {
  return value !== undefined && value !== null && value !== bound;
}

function requireBoundIdentity(body: AdaptiveReviewDecisionRequest, binding: AdaptiveReviewIntegrationBinding) {
  if (
    mismatched(body.agentId, binding.agentId) ||
    mismatched(body.agentVersionId, binding.agentVersionId) ||
    mismatched(body.policyId, binding.reviewPolicyId) ||
    mismatched(body.policyVersion, binding.reviewPolicyVersion)
  ) {
    throw new TokenlessServiceError(
      "The agent connection is not bound to this exact human-review configuration.",
      409,
      "human_review_integration_binding_mismatch",
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const principal = await authenticateAdaptiveReviewPrincipal(
      request.headers.get("authorization"),
      "evaluation:read",
    );
    const binding = await resolveAdaptiveReviewIntegrationBinding(principal);
    const scopeId = request.nextUrl.searchParams.get("scopeId")?.trim();
    if (!scopeId) throw new TokenlessServiceError("scopeId is required.", 400, "invalid_assurance_state_query");
    const state = await getAdaptiveAssuranceState({ principal, scopeId });
    if (
      state.agentId !== binding.agentId ||
      state.agentVersionId !== binding.agentVersionId ||
      state.policyId !== binding.reviewPolicyId ||
      state.policyVersion !== binding.reviewPolicyVersion
    ) {
      throw new TokenlessServiceError("Assurance state not found.", 404, "assurance_state_not_found");
    }
    return NextResponse.json(state, { headers: HEADERS });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: HEADERS, status: response.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await authenticateAdaptiveReviewPrincipal(request.headers.get("authorization"), "review:decide");
    const binding = await resolveAdaptiveReviewIntegrationBinding(principal);
    let body: AdaptiveReviewDecisionRequest;
    try {
      body = (await readJsonRequestBody(request)) as AdaptiveReviewDecisionRequest;
    } catch (error) {
      if (!(error instanceof JsonRequestBodyError)) throw error;
      throw new TokenlessServiceError("Review opportunity body must be valid JSON.", 400, "invalid_review_opportunity");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TokenlessServiceError("Review opportunity body must be valid JSON.", 400, "invalid_review_opportunity");
    }
    requireBoundIdentity(body, binding);
    if (
      typeof body.workflowKey === "string" &&
      binding.allowedWorkflowKeys.length > 0 &&
      !binding.allowedWorkflowKeys.includes(body.workflowKey)
    ) {
      throw new TokenlessServiceError("This workflow is not allowed for the integration.", 403, "workflow_not_allowed");
    }
    return NextResponse.json(
      await evaluateAdaptiveReviewRequirement({
        principal,
        integrationId: binding.integrationId,
        request: {
          ...body,
          agentId: binding.agentId,
          agentVersionId: binding.agentVersionId,
          policyId: binding.reviewPolicyId,
          policyVersion: binding.reviewPolicyVersion,
        },
      }),
      { headers: HEADERS, status: 201 },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: HEADERS, status: response.status });
  }
}
