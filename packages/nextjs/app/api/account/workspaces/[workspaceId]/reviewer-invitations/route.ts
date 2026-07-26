import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { getHumanReviewConfigurationForOwner } from "~~/lib/tokenless/humanReviewConfiguration";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import {
  createWorkspaceReviewerInvitation,
  listWorkspaceReviewerInvitations,
} from "~~/lib/tokenless/workspaceReviewers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };
const noStore = { "Cache-Control": "private, no-store, max-age=0" };
const invitationKeys = new Set([
  "accessExpiresAt",
  "agentId",
  "expiresAt",
  "intendedAccountAddress",
  "intendedEmail",
  "intendedEmailDomain",
  "maximumRedemptions",
  "maxPrivateSensitivity",
  "paidAdulthoodAttested",
  "privateGroupId",
  "projectIds",
]);

function optionalDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new TokenlessServiceError(`${field} must be an ISO date string.`, 400, "invalid_workspace_reviewer");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TokenlessServiceError(`${field} must be an ISO date string.`, 400, "invalid_workspace_reviewer");
  }
  return parsed;
}

async function invitationBody(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !invitationKeys.has(key))) {
    throw new TokenlessServiceError("Reviewer invitation body is invalid.", 400, "invalid_workspace_reviewer");
  }
  if (typeof body.maxPrivateSensitivity !== "string") {
    throw new TokenlessServiceError(
      "Choose the maximum private-material sensitivity.",
      400,
      "invalid_workspace_reviewer",
      false,
      "maxPrivateSensitivity",
    );
  }
  return body;
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    const invitations = await listWorkspaceReviewerInvitations({
      accountAddress: session.principalId,
      workspaceId,
    });
    return NextResponse.json({ invitations }, { headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const body = await invitationBody(request);
    if (
      (typeof body.agentId !== "string" || !body.agentId.trim()) &&
      (typeof body.privateGroupId !== "string" || !body.privateGroupId.trim())
    ) {
      throw new TokenlessServiceError(
        "Choose the agent whose reviewer group should receive this invitation.",
        400,
        "invalid_workspace_reviewer",
        false,
        "agentId",
      );
    }
    const ownerView =
      typeof body.agentId === "string"
        ? await getHumanReviewConfigurationForOwner({
            accountAddress: session.principalId,
            workspaceId,
            agentId: body.agentId,
          })
        : null;
    const requestProfile = ownerView?.configuration?.requestProfile.value;
    const audience = requestProfile?.audience;
    const privateGroupId = ownerView
      ? audience === "private_invited" || audience === "hybrid"
        ? requestProfile?.privateGroupId
        : null
      : body.privateGroupId;
    if (typeof privateGroupId !== "string" || !privateGroupId) {
      throw new TokenlessServiceError(
        "This agent does not have an active invited-reviewer group.",
        409,
        "private_group_not_found",
      );
    }
    const invitation = await createWorkspaceReviewerInvitation({
      accountAddress: session.principalId,
      workspaceId,
      privateGroupId,
      projectIds: body.projectIds as string[] | undefined,
      maxPrivateSensitivity: body.maxPrivateSensitivity as "internal" | "confidential" | "restricted" | "regulated",
      intendedAccountAddress: body.intendedAccountAddress as string | null | undefined,
      intendedEmail: body.intendedEmail as string | null | undefined,
      intendedEmailDomain: body.intendedEmailDomain as string | null | undefined,
      accessExpiresAt: optionalDate(body.accessExpiresAt, "accessExpiresAt"),
      expiresAt: optionalDate(body.expiresAt, "expiresAt"),
      maximumRedemptions: body.maximumRedemptions as number | undefined,
      paidAdulthoodAttested: body.paidAdulthoodAttested === true,
    });
    return NextResponse.json({ invitation }, { status: 201, headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
