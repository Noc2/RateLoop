import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { getAccountProfile, updateAccountProfile } from "~~/lib/tokenless/accountProfile";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request);
    return NextResponse.json(
      await getAccountProfile({ principalAddress: session.principalId, providerDisplayName: session.displayName }),
      { headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await request.json()) as { displayName?: unknown };
    return NextResponse.json(
      await updateAccountProfile({
        principalAddress: session.principalId,
        providerDisplayName: session.displayName,
        displayName: body.displayName,
      }),
      { headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
