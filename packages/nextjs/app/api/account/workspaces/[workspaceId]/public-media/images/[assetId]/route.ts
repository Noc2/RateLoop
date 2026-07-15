import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { deleteStagedPublicQuestionImage } from "~~/lib/tokenless/publicQuestionMedia";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ assetId: string; workspaceId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { assetId, workspaceId } = await context.params;
    return NextResponse.json(
      await deleteStagedPublicQuestionImage({ accountAddress: session.principalId, assetId, workspaceId }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      headers: { "Cache-Control": "private, no-store" },
      status: response.status,
    });
  }
}
