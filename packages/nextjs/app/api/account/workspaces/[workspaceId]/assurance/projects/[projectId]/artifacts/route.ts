import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import { storeEncryptedArtifact } from "~~/lib/tokenless/artifactPrivacy";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string; workspaceId: string }> };

const ROLES = new Set(["baseline", "candidate", "context", "reference"]);
const REDACTION_STATUSES = new Set(["not_required", "pending", "approved", "rejected"]);
const RENDERER_POLICIES = new Set(["plain_text", "sanitized_html", "image", "download"]);

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request, { mutation: true });
    const { projectId, workspaceId } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    const role = String(form.get("role") ?? "");
    const label = String(form.get("label") ?? "");
    const redactionStatus = String(form.get("redactionStatus") ?? "pending");
    const rendererPolicy = String(form.get("rendererPolicy") ?? "plain_text");
    if (
      !(file instanceof File) ||
      !ROLES.has(role) ||
      !REDACTION_STATUSES.has(redactionStatus) ||
      !RENDERER_POLICIES.has(rendererPolicy)
    ) {
      throw new TokenlessServiceError("The artifact upload is invalid.", 400, "invalid_artifact_upload");
    }
    const artifact = await storeEncryptedArtifact({
      accountAddress: session.address,
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || "application/octet-stream",
      label: label || file.name,
      projectId,
      redactionStatus: redactionStatus as "not_required" | "pending" | "approved" | "rejected",
      rendererPolicy: rendererPolicy as "plain_text" | "sanitized_html" | "image" | "download",
      role: role as "baseline" | "candidate" | "context" | "reference",
      workspaceId,
    });
    return NextResponse.json(artifact, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
