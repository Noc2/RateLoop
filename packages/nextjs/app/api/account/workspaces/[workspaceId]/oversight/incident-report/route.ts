import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { buildIncidentReportExport } from "~~/lib/tokenless/incidentReportExport";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

function optionalDate(value: unknown, field: string) {
  if (value === null || value === undefined) return undefined;
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new TokenlessServiceError(`${field} must be a valid timestamp.`, 400, "invalid_incident_report");
  }
  return parsed;
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    let body: { description?: unknown; from?: unknown; to?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      throw new TokenlessServiceError("Incident reports must be valid JSON.", 400, "invalid_incident_report");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TokenlessServiceError("Incident reports must be an object.", 400, "invalid_incident_report");
    }
    const unexpected = Object.keys(body).filter(key => !["description", "from", "to"].includes(key));
    if (unexpected.length > 0) {
      throw new TokenlessServiceError(
        "Incident reports accept only description, from, and to.",
        400,
        "invalid_incident_report",
      );
    }
    const { workspaceId } = await context.params;
    const exported = await buildIncidentReportExport({
      accountAddress: session.principalId,
      workspaceId,
      description: body.description,
      from: optionalDate(body.from, "from"),
      to: optionalDate(body.to, "to"),
    });
    return NextResponse.json(exported, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="rateloop-incident-report-draft-${workspaceId}.json"`,
      },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
