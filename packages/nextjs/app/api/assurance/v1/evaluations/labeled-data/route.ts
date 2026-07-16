import { NextRequest, NextResponse } from "next/server";
import {
  authenticateAutomatedEvalPrincipal,
  exportAutomatedEvalLabeledData,
} from "~~/lib/tokenless/automatedEvalReceipts";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } as const;

function boundary(request: NextRequest, name: "from" | "to") {
  const values = request.nextUrl.searchParams.getAll(name);
  if (values.length > 1) {
    throw new TokenlessServiceError(`${name} may be supplied only once.`, 400, "invalid_labeled_data_window");
  }
  return values[0] === undefined ? undefined : new Date(values[0]);
}

export async function GET(request: NextRequest) {
  try {
    if ([...request.nextUrl.searchParams.keys()].some(key => key !== "from" && key !== "to")) {
      throw new TokenlessServiceError(
        "Labeled-data exports accept only from and to boundaries.",
        400,
        "invalid_labeled_data_window",
      );
    }
    const principal = await authenticateAutomatedEvalPrincipal(request.headers.get("authorization"), "evaluation:read");
    const exported = await exportAutomatedEvalLabeledData({
      principal,
      from: boundary(request, "from"),
      to: boundary(request, "to"),
    });
    return NextResponse.json(exported, {
      headers: {
        ...HEADERS,
        "Content-Disposition": 'attachment; filename="rateloop-automated-eval-labeled-data.json"',
      },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: HEADERS, status: response.status });
  }
}
