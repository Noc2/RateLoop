import { NextRequest, NextResponse } from "next/server";
import { lookupLegacyClaim } from "../../../../lib/legacy-claim/lookup";

export async function GET(_request: NextRequest, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params;
  const result = lookupLegacyClaim(address);

  if (!result) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
