import { NextRequest, NextResponse } from "next/server";
import {
  ASSURANCE_API_RESPONSE_HEADERS,
  authenticateAssuranceApiPrincipal,
  createAssuranceApiProject,
  listAssuranceApiProjects,
  parseAssuranceApiProjectRequest,
} from "~~/lib/tokenless/assuranceIntegrations";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const principal = await authenticateAssuranceApiPrincipal(request.headers.get("authorization"));
    return NextResponse.json(await listAssuranceApiProjects(principal), { headers: ASSURANCE_API_RESPONSE_HEADERS });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: ASSURANCE_API_RESPONSE_HEADERS, status: response.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await authenticateAssuranceApiPrincipal(request.headers.get("authorization"));
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new TokenlessServiceError("Project body must be valid JSON.", 400, "invalid_human_assurance_input");
    }
    const project = await createAssuranceApiProject({
      principal,
      request: parseAssuranceApiProjectRequest(body),
    });
    return NextResponse.json(project, { headers: ASSURANCE_API_RESPONSE_HEADERS, status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: ASSURANCE_API_RESPONSE_HEADERS, status: response.status });
  }
}
