import "server-only";
import { getResendConfig } from "~~/lib/env/server";
import { buildRateLoopEmailHtml } from "~~/lib/notifications/emailTemplate";

interface ResendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const RESEND_NOT_CONFIGURED_ERROR = "Resend is not configured";
const RESEND_REQUEST_FAILED_PREFIX = "Resend request failed:";
const RESEND_FROM_ADDRESS_REGEX = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function normalizeResendFromEmail(fromEmail: string | undefined) {
  const value = fromEmail?.trim();
  if (!value) {
    return null;
  }

  const displayNameMatch = value.match(/^.+<([^<>]+)>$/);
  const senderAddress = (displayNameMatch?.[1] ?? value).trim();
  if (!RESEND_FROM_ADDRESS_REGEX.test(senderAddress)) {
    return null;
  }

  return value;
}

export function isResendConfigured() {
  const { apiKey, fromEmail } = getResendConfig();
  return Boolean(apiKey && normalizeResendFromEmail(fromEmail));
}

export function isResendDeliveryError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message === RESEND_NOT_CONFIGURED_ERROR || error.message.startsWith(RESEND_REQUEST_FAILED_PREFIX))
  );
}

export async function sendResendEmail(params: ResendEmailParams) {
  const { apiKey, fromEmail: configuredFromEmail } = getResendConfig();
  const fromEmail = normalizeResendFromEmail(configuredFromEmail);

  if (!apiKey || !fromEmail) {
    throw new Error(RESEND_NOT_CONFIGURED_ERROR);
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${RESEND_REQUEST_FAILED_PREFIX} ${response.status} ${body}`.trim());
  }
}

export async function sendNotificationVerificationEmail(params: { email: string; verifyUrl: string }) {
  await sendResendEmail({
    to: params.email,
    subject: "Verify your RateLoop notification email",
    text: `Verify your email for RateLoop notifications: ${params.verifyUrl}`,
    html: buildRateLoopEmailHtml({
      eyebrow: "Email verification",
      title: "Verify your email",
      body: "Confirm this email address to receive RateLoop notification emails for watched rounds and curators you follow.",
      ctaLabel: "Verify email",
      ctaHref: params.verifyUrl,
      footerNote: "This verification link was requested from RateLoop notification settings.",
    }),
  });
}
