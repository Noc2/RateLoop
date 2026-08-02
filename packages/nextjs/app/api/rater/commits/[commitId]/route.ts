import { NextRequest } from "next/server";
import { privateNoStoreJson } from "~~/lib/tokenless/privateHttpResponse";
import { getPaidRaterCommit } from "~~/lib/tokenless/raterService";
import { requireRaterSession } from "~~/lib/tokenless/raterSession";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ commitId: string }> }) {
  try {
    const session = await requireRaterSession(request, false);
    const { commitId } = await context.params;
    return privateNoStoreJson(await getPaidRaterCommit({ principalId: session.principalId, commitId }));
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return privateNoStoreJson(response.body, { status: response.status });
  }
}
