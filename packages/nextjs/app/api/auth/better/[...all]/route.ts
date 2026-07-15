import { NextResponse } from "next/server";
import { getBetterAuth } from "~~/lib/auth/betterAuth";

export const runtime = "nodejs";

async function handler(request: Request) {
  try {
    return await getBetterAuth().handler(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Better Auth is not configured.";
    return NextResponse.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
