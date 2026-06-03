import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const FEEDBACK_KEEPER_RATE_LIMIT = { limit: 120, windowMs: 60_000 };

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

function isAuthorizedKeeperRequest(token: string, secret: string) {
  const tokenBuffer = Buffer.from(token);
  const secretBuffer = Buffer.from(secret);
  return tokenBuffer.length === secretBuffer.length && timingSafeEqual(tokenBuffer, secretBuffer);
}

export function authorizeFeedbackKeeperRequest(request: Request): NextResponse | null {
  const secret = process.env.RATELOOP_FEEDBACK_REVEAL_SECRET?.trim() ?? "";
  if (!secret) {
    return NextResponse.json({ error: "Feedback reveal keeper is not configured." }, { status: 503 });
  }

  const token = request.headers.get("x-rateloop-feedback-reveal-secret")?.trim() || readBearerToken(request);
  if (!isAuthorizedKeeperRequest(token, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}
