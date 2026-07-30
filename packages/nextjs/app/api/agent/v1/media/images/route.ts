import { NextRequest, NextResponse } from "next/server";
import { multipartFormBodyLimit, readApiFormDataRequestBody } from "~~/lib/tokenless/apiRequestBody";
import { authenticateProductPrincipal, requireProductPrincipalScope } from "~~/lib/tokenless/productCore";
import {
  PUBLIC_QUESTION_IMAGE_MAX_BYTES,
  authorizePublicQuestionMediaOwner,
  stagePublicQuestionImage,
  sweepExpiredPublicQuestionMedia,
} from "~~/lib/tokenless/publicQuestionMedia";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const AGENT_IMAGE_UPLOAD_FORM_BODY_MAX_BYTES = multipartFormBodyLimit(PUBLIC_QUESTION_IMAGE_MAX_BYTES);
export const readAgentImageUploadForm = (request: Pick<Request, "body" | "headers">) =>
  readApiFormDataRequestBody(request, AGENT_IMAGE_UPLOAD_FORM_BODY_MAX_BYTES);

export async function POST(request: NextRequest) {
  try {
    const principal = await authenticateProductPrincipal({
      authorization: request.headers.get("authorization"),
      sessionToken: undefined,
    });
    if (principal.kind !== "api_key") {
      throw new TokenlessServiceError("A workspace API key is required.", 401, "api_key_required");
    }
    // Staged images exist only to be published to a panel, so they need the publishing capability.
    requireProductPrincipalScope(principal, "panel:publish");
    await authorizePublicQuestionMediaOwner({ apiKeyId: principal.apiKeyId, workspaceId: principal.workspaceId });
    await sweepExpiredPublicQuestionMedia({ limit: 20 });
    const form = await readAgentImageUploadForm(request);
    const file = form.get("file");
    const clientRequestId = form.get("clientRequestId");
    if (!(file instanceof File) || typeof clientRequestId !== "string") {
      throw new TokenlessServiceError("file and clientRequestId are required.", 400, "invalid_public_media_request");
    }
    const staged = await stagePublicQuestionImage({
      apiKeyId: principal.apiKeyId,
      bytes: new Uint8Array(await file.arrayBuffer()),
      clientRequestId,
      filename: file.name,
      workspaceId: principal.workspaceId,
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
