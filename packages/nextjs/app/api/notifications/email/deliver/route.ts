import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getNotificationDeliverySecret } from "~~/lib/env/server";
import { deliverNotificationEmails, getNotificationEmailDeliveryStatus } from "~~/lib/notifications/emailDelivery";
import { checkRateLimit } from "~~/utils/rateLimit";

const DELIVERY_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

function getDeliverySecrets() {
  return [getNotificationDeliverySecret(), process.env.CRON_SECRET?.trim()].filter((secret): secret is string =>
    Boolean(secret),
  );
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(request: NextRequest) {
  const secrets = getDeliverySecrets();
  if (secrets.length === 0) {
    return { ok: false as const, reason: "missing_secret" };
  }

  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!bearerToken || !secrets.some(secret => constantTimeEquals(bearerToken, secret))) {
    return { ok: false as const, reason: "unauthorized" };
  }

  return { ok: true as const };
}

async function handleDelivery(request: NextRequest) {
  const limited = await checkRateLimit(request, DELIVERY_RATE_LIMIT);
  if (limited) return limited;

  const auth = isAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.reason === "missing_secret" ? "Notification delivery is not configured" : "Unauthorized" },
      { status: auth.reason === "missing_secret" ? 503 : 401 },
    );
  }

  if (!getNotificationDeliverySecret()) {
    return NextResponse.json({ error: "Notification delivery is not configured" }, { status: 503 });
  }

  const deliveryStatus = await getNotificationEmailDeliveryStatus();
  if (!deliveryStatus.ok) {
    return NextResponse.json({ error: deliveryStatus.error }, { status: 503 });
  }

  try {
    const result = await deliverNotificationEmails();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Error delivering notification emails:", error);
    return NextResponse.json({ error: "Failed to deliver notification emails" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleDelivery(request);
}

export async function POST(request: NextRequest) {
  return handleDelivery(request);
}
