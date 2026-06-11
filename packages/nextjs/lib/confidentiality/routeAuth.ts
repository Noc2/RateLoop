import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getNotificationDeliverySecret } from "~~/lib/env/server";

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readBearerToken(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  return authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

export function requireConfidentialityJobAuth(request: NextRequest) {
  const secret = getNotificationDeliverySecret();
  if (!secret) {
    return NextResponse.json({ error: "Confidentiality jobs are not configured" }, { status: 503 });
  }

  const token = request.headers.get("x-rateloop-confidentiality-secret")?.trim() || readBearerToken(request);
  if (!token || !constantTimeEquals(token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
