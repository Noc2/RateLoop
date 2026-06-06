import { NextResponse } from "next/server";
import { isPonderAvailable } from "~~/services/ponder/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const available = await isPonderAvailable();

  return NextResponse.json(
    { available },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
