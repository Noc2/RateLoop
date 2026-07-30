import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { readApiJsonRequestBody } from "~~/lib/tokenless/apiRequestBody";
import {
  createAssuranceProject,
  listAssuranceProjects,
  scopeAssuranceSessionToWorkspace,
} from "~~/lib/tokenless/humanAssurance";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };
const CREATE_KEYS = new Set([
  "name",
  "description",
  "dataClassification",
  "visibility",
  "publicMaterialKind",
  "confirmedNoSensitiveData",
  "retentionDays",
]);

async function principal(request: NextRequest, context: Context, mutation = false) {
  const session = await requireBrowserSession(request, mutation ? { mutation: true } : undefined);
  const { workspaceId } = await context.params;
  return scopeAssuranceSessionToWorkspace({ accountAddress: session.principalId, workspaceId });
}

export async function GET(request: NextRequest, context: Context) {
  try {
    return NextResponse.json(
      { projects: await listAssuranceProjects(await principal(request, context)) },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const scopedPrincipal = await principal(request, context, true);
    const value = await readApiJsonRequestBody(request);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TokenlessServiceError("Project body is invalid.", 400, "invalid_human_assurance_input");
    }
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some(key => !CREATE_KEYS.has(key))) {
      throw new TokenlessServiceError("Project body has unknown fields.", 400, "invalid_human_assurance_input");
    }
    if (
      typeof body.name !== "string" ||
      (body.description !== undefined && typeof body.description !== "string") ||
      (body.retentionDays !== undefined && typeof body.retentionDays !== "number") ||
      (body.confirmedNoSensitiveData !== undefined && typeof body.confirmedNoSensitiveData !== "boolean") ||
      !["private", "public"].includes(String(body.visibility ?? "private"))
    ) {
      throw new TokenlessServiceError("Project name is required.", 400, "invalid_human_assurance_input");
    }
    const visibility = (body.visibility ?? "private") as "private" | "public";
    const dataClassification = body.dataClassification ?? (visibility === "public" ? "public" : "internal");
    const publicMaterialKind = body.publicMaterialKind;
    if (
      (visibility === "public" &&
        (dataClassification !== "public" ||
          !["public", "synthetic", "redacted"].includes(String(publicMaterialKind)))) ||
      (visibility === "private" &&
        (!["internal", "confidential", "restricted", "regulated"].includes(String(dataClassification)) ||
          publicMaterialKind !== undefined))
    ) {
      throw new TokenlessServiceError(
        "Project visibility, classification, and material kind do not match.",
        400,
        "invalid_human_assurance_input",
      );
    }
    const project = await createAssuranceProject({
      principal: scopedPrincipal,
      name: body.name,
      description: typeof body.description === "string" ? body.description : undefined,
      dataClassification: dataClassification as "public" | "internal" | "confidential" | "restricted" | "regulated",
      visibility,
      publicMaterialKind: publicMaterialKind as "public" | "synthetic" | "redacted" | undefined,
      confirmedNoSensitiveData: body.confirmedNoSensitiveData as boolean | undefined,
      retentionDays: typeof body.retentionDays === "number" ? body.retentionDays : 30,
    });
    return NextResponse.json(project, {
      status: 201,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
