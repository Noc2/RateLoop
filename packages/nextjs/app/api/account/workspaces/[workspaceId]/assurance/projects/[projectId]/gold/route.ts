import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  configureProjectGoldInjection,
  createOwnerGoldItem,
  getProjectGoldQuality,
  retireOwnerGoldItem,
} from "~~/lib/tokenless/goldQuality";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; projectId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId, projectId } = await context.params;
    return NextResponse.json(
      await getProjectGoldQuality({ accountAddress: session.principalId, workspaceId, projectId }),
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, projectId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const item = await createOwnerGoldItem({
      accountAddress: session.principalId,
      workspaceId,
      projectId,
      caseId: String(body.caseId ?? ""),
      expectedChoice: body.expectedChoice as "baseline" | "candidate",
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, projectId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const result =
      body.action === "retire"
        ? await retireOwnerGoldItem({
            accountAddress: session.principalId,
            workspaceId,
            projectId,
            goldItemId: String(body.goldItemId ?? ""),
          })
        : await configureProjectGoldInjection({
            accountAddress: session.principalId,
            workspaceId,
            projectId,
            invitedInjectionEnabled: body.invitedInjectionEnabled as boolean,
            injectionRateBps: Number(body.injectionRateBps),
            maximumItemsPerRun: Number(body.maximumItemsPerRun),
          });
    return NextResponse.json(result);
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
