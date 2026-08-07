import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { getOptionalAppUrl } from "~~/lib/env/server";
import {
  buildTokenlessVerificationUrl,
  isResendConfigured,
  sendTokenlessVerificationEmail,
} from "~~/lib/notifications/resend";
import {
  getTokenlessEmailNotificationSettings,
  getTokenlessEmailNotificationSubscription,
  normalizeNotificationEmail,
  normalizeNotificationPreferences,
  upsertTokenlessEmailNotificationSettings,
} from "~~/lib/notifications/tokenless";
import { logRedactedError } from "~~/lib/security/redactedErrorLog";
import { readApiJsonRequestBody } from "~~/lib/tokenless/apiRequestBody";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request);
    return NextResponse.json(await getTokenlessEmailNotificationSettings(session.principalId, isResendConfigured()), {
      headers: noStore,
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await readApiJsonRequestBody(request)) as { email?: unknown; preferences?: unknown };
    const email = normalizeNotificationEmail(body.email);
    const preferences = normalizeNotificationPreferences(body.preferences ?? body);
    const existing = await getTokenlessEmailNotificationSubscription(session.principalId);
    const requiresVerification =
      Boolean(email) && (!existing || String(existing.email) !== email || !existing.verified_at);

    if (requiresVerification && (!isResendConfigured() || !getOptionalAppUrl())) {
      return NextResponse.json(
        { field: "email", message: "Email notifications are not configured on this deployment." },
        { status: 503, headers: noStore },
      );
    }

    const result = await upsertTokenlessEmailNotificationSettings(session.principalId, email, preferences);
    if (result.verificationToken && email) {
      try {
        await sendTokenlessVerificationEmail({
          email,
          verifyUrl: buildTokenlessVerificationUrl(result.verificationToken),
        });
      } catch (error) {
        logRedactedError("tokenless_notification_verification_email_failed", error);
        return NextResponse.json(
          { field: "email", message: "Email notifications are not configured on this deployment." },
          { status: 503, headers: noStore },
        );
      }
    }

    return NextResponse.json(
      {
        ok: true,
        settings: { ...result.settings, deliveryConfigured: isResendConfigured() },
        verificationSent: Boolean(result.verificationToken),
      },
      { headers: noStore },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_IN_USE") {
      return NextResponse.json(
        { field: "email", message: "That email address cannot be used." },
        { status: 409, headers: noStore },
      );
    }
    if (error instanceof Error && ["Email must be text.", "Enter a valid email address."].includes(error.message)) {
      return NextResponse.json({ field: "email", message: error.message }, { status: 400, headers: noStore });
    }
    const response = tokenlessErrorResponse(error);
    const status = response.status === 500 && error instanceof Error ? 400 : response.status;
    return NextResponse.json(response.body, { status, headers: noStore });
  }
}
