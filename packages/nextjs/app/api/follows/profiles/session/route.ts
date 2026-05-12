import { NextRequest, NextResponse } from "next/server";

const FOLLOW_SESSION_DEPRECATED_ERROR = "Profile follows are public and no longer use signed read or write sessions.";

export async function GET(request: NextRequest) {
  void request;
  return NextResponse.json(
    {
      error: FOLLOW_SESSION_DEPRECATED_ERROR,
      hasSession: false,
      hasReadSession: false,
      hasWriteSession: false,
    },
    { status: 410 },
  );
}
