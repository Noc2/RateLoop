import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  type AgentPublishingPolicyInput,
  createAgentPublishingPolicy,
  listAgentPublishingPolicies,
} from "~~/lib/tokenless/productCore";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

function stringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw new TokenlessServiceError(`${field} must be an array of strings.`, 400, "invalid_policy");
  }
  return value as string[];
}

function optionalStringArray(value: unknown, field: string) {
  return value === undefined ? undefined : stringArray(value, field);
}

function optionalDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new TokenlessServiceError(`${field} must be an ISO date.`, 400, "invalid_policy");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TokenlessServiceError(`${field} must be an ISO date.`, 400, "invalid_policy");
  }
  return date;
}

function policyBody(value: unknown): AgentPublishingPolicyInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("Publishing policy body must be an object.", 400, "invalid_policy");
  }
  const body = value as Record<string, unknown>;
  if (typeof body.name !== "string") {
    throw new TokenlessServiceError("Policy name is required.", 400, "invalid_policy");
  }
  const paymentModes = stringArray(body.allowedPaymentModes, "allowedPaymentModes");
  if (paymentModes.some(mode => mode !== "prepaid" && mode !== "x402")) {
    throw new TokenlessServiceError("allowedPaymentModes contains an unsupported mode.", 400, "invalid_policy");
  }
  const atomicFields = [
    "maxPanelAtomic",
    "maxDailyAtomic",
    "maxMonthlyAtomic",
    "maxBountyAtomic",
    "maxAttemptReserveAtomic",
  ] as const;
  for (const field of atomicFields) {
    if (typeof body[field] !== "string") {
      throw new TokenlessServiceError(`${field} is required.`, 400, "invalid_policy");
    }
  }
  if (typeof body.maxPanelSize !== "number" || typeof body.maxFeeBps !== "number") {
    throw new TokenlessServiceError("Panel size and fee cap must be numbers.", 400, "invalid_policy");
  }
  if (body.payerAddress !== undefined && body.payerAddress !== null && typeof body.payerAddress !== "string") {
    throw new TokenlessServiceError("payerAddress must be a wallet address.", 400, "invalid_policy");
  }
  if (body.onPolicyMiss !== undefined && body.onPolicyMiss !== "handoff" && body.onPolicyMiss !== "deny") {
    throw new TokenlessServiceError("onPolicyMiss must be handoff or deny.", 400, "invalid_policy");
  }
  if (body.allowPublicUrls !== undefined && typeof body.allowPublicUrls !== "boolean") {
    throw new TokenlessServiceError("allowPublicUrls must be boolean.", 400, "invalid_policy");
  }
  if (
    body.maxRetentionDays !== undefined &&
    body.maxRetentionDays !== null &&
    typeof body.maxRetentionDays !== "number"
  ) {
    throw new TokenlessServiceError("maxRetentionDays must be a number.", 400, "invalid_policy");
  }
  return {
    name: body.name,
    version: typeof body.version === "number" ? body.version : undefined,
    effectiveAt: optionalDate(body.effectiveAt, "effectiveAt") ?? undefined,
    expiresAt: optionalDate(body.expiresAt, "expiresAt"),
    allowedPaymentModes: paymentModes as AgentPublishingPolicyInput["allowedPaymentModes"],
    payerAddress: (body.payerAddress as string | null | undefined) ?? null,
    maxPanelAtomic: body.maxPanelAtomic as string,
    maxDailyAtomic: body.maxDailyAtomic as string,
    maxMonthlyAtomic: body.maxMonthlyAtomic as string,
    maxPanelSize: body.maxPanelSize,
    maxBountyAtomic: body.maxBountyAtomic as string,
    maxFeeBps: body.maxFeeBps,
    maxAttemptReserveAtomic: body.maxAttemptReserveAtomic as string,
    allowedProjectIds: optionalStringArray(body.allowedProjectIds, "allowedProjectIds"),
    allowedReviewerSources: stringArray(body.allowedReviewerSources, "allowedReviewerSources"),
    allowedAdmissionPolicyHashes: stringArray(body.allowedAdmissionPolicyHashes, "allowedAdmissionPolicyHashes"),
    allowedDataClassifications: optionalStringArray(body.allowedDataClassifications, "allowedDataClassifications"),
    maxRetentionDays: (body.maxRetentionDays as number | null | undefined) ?? null,
    allowPublicUrls: body.allowPublicUrls as boolean | undefined,
    allowedWebhookEndpointIds: optionalStringArray(body.allowedWebhookEndpointIds, "allowedWebhookEndpointIds"),
    allowedPromptTemplates: optionalStringArray(body.allowedPromptTemplates, "allowedPromptTemplates"),
    onPolicyMiss: body.onPolicyMiss as "handoff" | "deny" | undefined,
  };
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(
      { policies: await listAgentPublishingPolicies({ accountAddress: session.principalId, workspaceId }) },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const policy = await createAgentPublishingPolicy({
      accountAddress: session.principalId,
      workspaceId,
      policy: policyBody(await request.json()),
    });
    return NextResponse.json({ policy }, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
