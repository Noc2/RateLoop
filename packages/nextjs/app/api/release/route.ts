import { NextResponse } from "next/server";
import { tokenlessReleaseIdentity } from "~~/lib/tokenless/releaseIdentity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEADERS = {
  "Cache-Control": "public, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const;

type ReleaseEnvironment = Record<string, string | undefined>;

export function releaseIdentityResponse(env: ReleaseEnvironment = process.env) {
  try {
    return NextResponse.json(tokenlessReleaseIdentity(env), { headers: HEADERS });
  } catch {
    return NextResponse.json(
      {
        schemaVersion: "rateloop.release-identity.v1",
        deploymentLine: "tokenless",
        status: "unavailable",
      },
      { headers: HEADERS, status: 503 },
    );
  }
}

export function GET() {
  return releaseIdentityResponse();
}
