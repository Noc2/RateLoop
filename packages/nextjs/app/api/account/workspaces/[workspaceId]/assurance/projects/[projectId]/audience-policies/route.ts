import { NextRequest, NextResponse } from "next/server";
import type { HumanAssuranceAudiencePolicy } from "@rateloop/sdk";
import { requireBrowserSession } from "~~/lib/auth/request";
import { createAssuranceAudiencePolicy, scopeAssuranceSessionToWorkspace } from "~~/lib/tokenless/humanAssurance";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string; workspaceId: string }> };
type AudiencePolicyDefinition = Omit<HumanAssuranceAudiencePolicy, "policyId" | "schemaVersion" | "version">;
const POLICY_KEYS = new Set([
  "reviewerSource",
  "integrity",
  "compensation",
  "cohorts",
  "selection",
  "fallbacks",
  "requiredQualifications",
  "assurance",
  "buyerPrivacy",
  "legalEligibilityRequired",
]);

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { projectId, workspaceId } = await context.params;
    const principal = await scopeAssuranceSessionToWorkspace({
      accountAddress: session.principalId,
      workspaceId,
    });
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TokenlessServiceError("Audience policy body is invalid.", 400, "invalid_human_assurance_input");
    }
    if (Object.keys(value).some(key => !POLICY_KEYS.has(key))) {
      throw new TokenlessServiceError("Audience policy body has unknown fields.", 400, "invalid_human_assurance_input");
    }
    const policy = await createAssuranceAudiencePolicy({
      principal,
      projectId,
      policy: value as AudiencePolicyDefinition,
    });
    return NextResponse.json(policy, {
      status: 201,
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
