import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  authorizePublicQuestionMediaOwner,
  stagePublicQuestionImage,
  sweepExpiredPublicQuestionMedia,
} from "~~/lib/tokenless/publicQuestionMedia";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    await authorizePublicQuestionMediaOwner({ accountAddress: session.address, workspaceId });
    await sweepExpiredPublicQuestionMedia({ limit: 20 });
    const form = await request.formData();
    const file = form.get("file");
    const clientRequestId = form.get("clientRequestId");
    if (!(file instanceof File) || typeof clientRequestId !== "string") {
      throw new TokenlessServiceError("file and clientRequestId are required.", 400, "invalid_public_media_request");
    }
    const staged = await stagePublicQuestionImage({
      accountAddress: session.address,
      bytes: new Uint8Array(await file.arrayBuffer()),
      clientRequestId,
      filename: file.name,
      workspaceId,
    });
    return NextResponse.json(staged, { headers: { "Cache-Control": "private, no-store" }, status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      headers: { "Cache-Control": "private, no-store" },
      status: response.status,
    });
  }
}
