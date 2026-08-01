import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { readApiJsonRequestBody, rethrowApiRequestBodyBoundaryError } from "~~/lib/tokenless/apiRequestBody";
import { declareDsaContentSelfIdentificationGap } from "~~/lib/tokenless/dsaContentSelfIdentification";
import {
  adjudicateDsaNamedPanelDisagreement,
  assignDsaNamedPanelAdjudicator,
  declareDsaNamedPanelUnitGap,
  freezeDsaNamedPanelOutcome,
  issueDsaNamedPanelAdjudicationArtifactLease,
  registerDsaNamedPanelReferenceDefinition,
  registerDsaNamedPanelUnit,
} from "~~/lib/tokenless/dsaNamedReferencePanel";
import { freezeDsaReferenceLabelSet } from "~~/lib/tokenless/dsaReferenceLabelSets";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_BODY_BYTES = 256 * 1_024;
type Context = { params: Promise<{ workspaceId: string }> };

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TokenlessServiceError("Reference-panel action must be an object.", 400, "invalid_dsa_named_panel_action");
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new TokenlessServiceError(
      "Reference-panel action contains unsupported fields.",
      400,
      "invalid_dsa_named_panel_action",
    );
}

function requiredString(value: unknown) {
  if (typeof value !== "string")
    throw new TokenlessServiceError("Reference-panel field must be a string.", 400, "invalid_dsa_named_panel_action");
  return value;
}

function requiredNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new TokenlessServiceError("Reference-panel field must be an integer.", 400, "invalid_dsa_named_panel_action");
  return value;
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    let body: Record<string, unknown>;
    try {
      body = record(await readApiJsonRequestBody(request, MAX_BODY_BYTES));
    } catch (error) {
      rethrowApiRequestBodyBoundaryError(error);
      throw new TokenlessServiceError(
        "Reference-panel action must be valid JSON.",
        400,
        "invalid_dsa_named_panel_action",
      );
    }
    let result: unknown;
    if (body.action === "register_definition") {
      exact(body, [
        "action",
        "epochId",
        "projectId",
        "question",
        "standardHash",
        "standardId",
        "standardVersion",
        "version",
      ]);
      result = await registerDsaNamedPanelReferenceDefinition({
        accountAddress: session.principalId,
        workspaceId,
        projectId: requiredString(body.projectId),
        epochId: requiredString(body.epochId),
        version: requiredNumber(body.version),
        question: requiredString(body.question),
        standardId: requiredString(body.standardId),
        standardVersion: requiredString(body.standardVersion),
        standardHash: requiredString(body.standardHash),
      });
    } else if (body.action === "register_unit") {
      exact(body, [
        "action",
        "caseId",
        "epochId",
        "projectId",
        "requiredCefrLevel",
        "requiredReviewerCount",
        "runId",
        "unitId",
      ]);
      result = await registerDsaNamedPanelUnit({
        accountAddress: session.principalId,
        workspaceId,
        projectId: requiredString(body.projectId),
        epochId: requiredString(body.epochId),
        unitId: requiredString(body.unitId),
        runId: requiredString(body.runId),
        caseId: requiredString(body.caseId),
        requiredCefrLevel: body.requiredCefrLevel as "B2" | "C1" | "C2",
        requiredReviewerCount: requiredNumber(body.requiredReviewerCount),
      });
    } else if (body.action === "assign_adjudicator") {
      exact(body, ["action", "adjudicatorPrincipalId", "epochId", "unitId"]);
      result = await assignDsaNamedPanelAdjudicator({
        accountAddress: session.principalId,
        workspaceId,
        epochId: requiredString(body.epochId),
        unitId: requiredString(body.unitId),
        adjudicatorPrincipalId: requiredString(body.adjudicatorPrincipalId),
      });
    } else if (body.action === "open_adjudication_artifact") {
      exact(body, ["action", "epochId", "unitId"]);
      result = await issueDsaNamedPanelAdjudicationArtifactLease({
        accountAddress: session.principalId,
        workspaceId,
        epochId: requiredString(body.epochId),
        unitId: requiredString(body.unitId),
      });
    } else if (body.action === "adjudicate") {
      exact(body, ["action", "conflictDeclaration", "epochId", "rationale", "referenceLabel", "unitId"]);
      result = await adjudicateDsaNamedPanelDisagreement({
        accountAddress: session.principalId,
        workspaceId,
        epochId: requiredString(body.epochId),
        unitId: requiredString(body.unitId),
        referenceLabel: body.referenceLabel as "pass" | "fail" | "uncertain",
        rationale: requiredString(body.rationale),
        conflictDeclaration: body.conflictDeclaration as { hasConflict: boolean; relationships: readonly string[] },
      });
    } else if (body.action === "declare_gap") {
      exact(body, ["action", "epochId", "reason", "unitId"]);
      const reason = requiredString(body.reason);
      result =
        reason === "content_self_identification"
          ? await declareDsaContentSelfIdentificationGap({
              accountAddress: session.principalId,
              workspaceId,
              epochId: requiredString(body.epochId),
              unitId: requiredString(body.unitId),
              reason,
            })
          : await declareDsaNamedPanelUnitGap({
              accountAddress: session.principalId,
              workspaceId,
              epochId: requiredString(body.epochId),
              unitId: requiredString(body.unitId),
              reason: reason as "reviewer_nonresponse" | "adjudicator_nonresponse",
            });
    } else if (body.action === "freeze_outcome") {
      exact(body, ["action", "epochId", "unitId"]);
      result = await freezeDsaNamedPanelOutcome({
        accountAddress: session.principalId,
        workspaceId,
        epochId: requiredString(body.epochId),
        unitId: requiredString(body.unitId),
      });
    } else if (body.action === "freeze_label_set") {
      exact(body, ["action", "epochId"]);
      result = await freezeDsaReferenceLabelSet({
        accountAddress: session.principalId,
        workspaceId,
        epochId: requiredString(body.epochId),
      });
    } else {
      throw new TokenlessServiceError("Reference-panel action is unsupported.", 400, "invalid_dsa_named_panel_action");
    }
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
