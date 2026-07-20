import { NextRequest, NextResponse } from "next/server";
import type { HumanAssuranceAudiencePolicy } from "@rateloop/sdk";
import { requireBrowserSession } from "~~/lib/auth/request";
import { dbClient } from "~~/lib/db";
import { readEncryptedArtifact } from "~~/lib/tokenless/artifactPrivacy";
import {
  assertAssuranceAssignmentSettlementAvailable,
  assertMatchingPrivateGroupSnapshot,
} from "~~/lib/tokenless/audienceAssignments";
import {
  directPrivateArtifactAccess,
  isDirectPrivateReviewAssignmentId,
} from "~~/lib/tokenless/privateReviewResponses";
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
    const session = await requireBrowserSession(request);
    const { artifactId, assignmentId } = await context.params;
    const directAccess = isDirectPrivateReviewAssignmentId(assignmentId)
      ? await directPrivateArtifactAccess({
          accountAddress: session.principalId,
          assignmentId,
          artifactId,
        })
      : null;
    const result = directAccess
      ? null
      : await dbClient.execute({
          sql: `SELECT a.workspace_id, a.project_id, a.source, a.paid_assignment,
                   a.private_group_id, a.private_group_policy_version, a.private_group_policy_hash,
                   sp.private_group_id AS subpanel_private_group_id,
                   sp.private_group_policy_version AS subpanel_private_group_policy_version,
                   sp.private_group_policy_hash AS subpanel_private_group_policy_hash,
                   ap.policy_json
            FROM tokenless_assurance_assignments a
            JOIN tokenless_assurance_runs r ON r.run_id = a.run_id AND r.project_id = a.project_id
            JOIN tokenless_assurance_run_subpanels sp ON sp.subpanel_id = a.subpanel_id
            JOIN tokenless_assurance_audience_policies ap
              ON ap.policy_id = r.audience_policy_id AND ap.version = r.audience_policy_version
            WHERE a.assignment_id = ? AND a.reviewer_account_address = ? AND a.status = 'accepted'
              AND a.confidentiality_accepted_at IS NOT NULL AND a.assignment_expires_at > ? LIMIT 1`,
          args: [assignmentId, session.principalId.toLowerCase(), new Date()],
        });
    const assignment = result?.rows[0] as QueryRow | undefined;
    const workspaceId = directAccess?.workspaceId ?? rowString(assignment, "workspace_id");
    const projectId = directAccess?.projectId ?? rowString(assignment, "project_id");
    if (!workspaceId || !projectId) {
      throw new TokenlessServiceError("Artifact not found.", 404, "artifact_not_found");
    }
    if (!directAccess) {
      assertMatchingPrivateGroupSnapshot(assignment!);
      assertAssuranceAssignmentSettlementAvailable({
        paidAssignment: assignment?.paid_assignment === true,
        policy: JSON.parse(String(assignment?.policy_json)) as HumanAssuranceAudiencePolicy,
        source: rowString(assignment, "source") as "customer_invited" | "rateloop_network",
      });
    }
    const artifact = await readEncryptedArtifact({
      accountAddress: session.principalId,
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
