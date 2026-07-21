import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
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
  "expiresAt",
  "intendedAccountAddress",
  "intendedEmail",
  "intendedEmailDomain",
  "maximumRedemptions",
  "maxPrivateSensitivity",
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
    const invitation = await createWorkspaceReviewerInvitation({
      accountAddress: session.principalId,
      workspaceId,
      projectIds: body.projectIds as string[] | undefined,
      maxPrivateSensitivity: body.maxPrivateSensitivity as "internal" | "confidential" | "restricted" | "regulated",
      intendedAccountAddress: body.intendedAccountAddress as string | null | undefined,
      intendedEmail: body.intendedEmail as string | null | undefined,
      intendedEmailDomain: body.intendedEmailDomain as string | null | undefined,
      accessExpiresAt: optionalDate(body.accessExpiresAt, "accessExpiresAt"),
      expiresAt: optionalDate(body.expiresAt, "expiresAt"),
      maximumRedemptions: body.maximumRedemptions as number | undefined,
    });
    return NextResponse.json({ invitation }, { status: 201, headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
