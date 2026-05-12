import { NextResponse } from "next/server";

const FOLLOW_CHALLENGE_DEPRECATED_ERROR =
  "Profile follows are public and on-chain, so signed follow challenges are no longer issued.";

export async function POST() {
  return NextResponse.json(
    {
      error: FOLLOW_CHALLENGE_DEPRECATED_ERROR,
    },
    { status: 410 },
  );
}
