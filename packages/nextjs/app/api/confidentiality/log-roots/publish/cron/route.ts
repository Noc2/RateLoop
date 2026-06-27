import { NextRequest } from "next/server";
import { POST as publishLogRoot } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");

  return publishLogRoot(
    new NextRequest(new URL("/api/confidentiality/log-roots/publish", request.nextUrl.origin), {
      body: "{}",
      headers,
      method: "POST",
    }),
  );
}
