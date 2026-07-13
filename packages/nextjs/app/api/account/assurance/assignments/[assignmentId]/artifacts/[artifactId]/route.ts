import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import { dbClient } from "~~/lib/db";
import { readEncryptedArtifact } from "~~/lib/tokenless/artifactPrivacy";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ artifactId: string; assignmentId: string }> };
type QueryRow = Record<string, unknown>;

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request);
    const { artifactId, assignmentId } = await context.params;
    const result = await dbClient.execute({
      sql: `SELECT workspace_id, project_id FROM tokenless_assurance_assignments
            WHERE assignment_id = ? AND reviewer_account_address = ? AND status = 'accepted'
              AND confidentiality_accepted_at IS NOT NULL AND assignment_expires_at > ? LIMIT 1`,
      args: [assignmentId, session.address.toLowerCase(), new Date()],
    });
    const assignment = result.rows[0] as QueryRow | undefined;
    const workspaceId = rowString(assignment, "workspace_id");
    const projectId = rowString(assignment, "project_id");
    if (!workspaceId || !projectId) {
      throw new TokenlessServiceError("Artifact not found.", 404, "artifact_not_found");
    }
    const artifact = await readEncryptedArtifact({
      accountAddress: session.address,
      artifactId,
      leaseId: request.nextUrl.searchParams.get("leaseId") ?? undefined,
      projectId,
      purpose: "preview",
      requestReference: request.headers.get("x-request-id") ?? undefined,
      workspaceId,
    });
    return new NextResponse(Buffer.from(artifact.bytes), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Length": String(artifact.sizeBytes),
        "Content-Type": artifact.contentType,
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
