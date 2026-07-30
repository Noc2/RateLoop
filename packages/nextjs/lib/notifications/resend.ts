import "server-only";
import { getOptionalAppUrl, getResendConfig } from "~~/lib/env/server";
import { buildRateLoopEmailHtml } from "~~/lib/notifications/emailTemplate";
import { maintenanceRequestSignal, throwIfMaintenanceCancelled } from "~~/lib/tokenless/maintenanceCancellation";

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const RESEND_REQUEST_TIMEOUT_MS = 10_000;

function resendRequestSignal(signal?: AbortSignal) {
  return maintenanceRequestSignal(signal, RESEND_REQUEST_TIMEOUT_MS);
}

export function normalizeResendFromEmail(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const address = (trimmed.match(/^.+<([^<>]+)>$/)?.[1] ?? trimmed).trim();
  return EMAIL_PATTERN.test(address) ? trimmed : null;
}

export function isResendConfigured() {
  const { apiKey, fromEmail } = getResendConfig();
  return Boolean(apiKey && normalizeResendFromEmail(fromEmail));
}

export async function sendTokenlessVerificationEmail(params: { email: string; verifyUrl: string }) {
  const { apiKey, fromEmail: configuredFromEmail } = getResendConfig();
  const fromEmail = normalizeResendFromEmail(configuredFromEmail);
  if (!apiKey || !fromEmail) throw new Error("Resend is not configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: resendRequestSignal(),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [params.email],
      subject: "Verify your RateLoop notification email",
      text: `Verify your RateLoop notification email: ${params.verifyUrl}`,
      html: buildRateLoopEmailHtml({
        kind: "action",
        eyebrow: "Email verification",
        title: "Verify your email",
        body: "Confirm this address to receive RateLoop account and human-assurance notifications.",
        ctaLabel: "Verify email",
        ctaHref: params.verifyUrl,
        preheader: "Confirm your RateLoop notification email.",
        footerNote: "This verification link was requested from your RateLoop notification settings.",
      }),
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend request failed: ${response.status} ${body}`.trim());
  }
}

export async function sendTokenlessLoginOtpEmail(params: { email: string; otp: string }) {
  const { apiKey, fromEmail: configuredFromEmail } = getResendConfig();
  const fromEmail = normalizeResendFromEmail(configuredFromEmail);
  if (!apiKey || !fromEmail) throw new Error("Resend is not configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: resendRequestSignal(),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [params.email],
      subject: "Your RateLoop sign-in code",
      text: `Sign in to RateLoop\n\nYour one-time code: ${params.otp}\n\nThe code expires in five minutes. If you did not request it, you can ignore this email.`,
      html: buildRateLoopEmailHtml({
        kind: "code",
        eyebrow: "Secure sign-in",
        title: "Sign in to RateLoop",
        body: "Enter this code in the RateLoop sign-in screen.",
        code: params.otp,
        codeLabel: "One-time code",
        codeNote: "This code expires in five minutes.",
        preheader: "Use this one-time code to finish signing in. It expires in five minutes.",
        footerNote: "If you did not request this code, you can ignore this email.",
      }),
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend request failed: ${response.status} ${body}`.trim());
  }
}

export async function sendTokenlessNotificationEmail(
  params: {
    actionUrl: string;
    body: string;
    email: string;
    idempotencyKey: string;
    title: string;
    unsubscribeUrl: string;
  },
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  throwIfMaintenanceCancelled(signal);
  const { apiKey, fromEmail: configuredFromEmail } = getResendConfig();
  const fromEmail = normalizeResendFromEmail(configuredFromEmail);
  if (!apiKey || !fromEmail) throw new Error("Resend is not configured");

  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    signal: resendRequestSignal(signal),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": params.idempotencyKey,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [params.email],
      subject: params.title,
      text: `${params.title}\n\n${params.body}\n\nOpen RateLoop: ${params.actionUrl}\n\nUnsubscribe: ${params.unsubscribeUrl}`,
      html: buildRateLoopEmailHtml({
        kind: "action",
        eyebrow: "RateLoop notification",
        title: params.title,
        body: params.body,
        ctaLabel: "Open RateLoop",
        ctaHref: params.actionUrl,
        preheader: params.body,
        footerNote: "This message intentionally omits question, answer, payment, and workspace details.",
        footerLinkLabel: "Unsubscribe from RateLoop email notifications",
        footerLinkHref: params.unsubscribeUrl,
      }),
      headers: {
        "List-Unsubscribe": `<${params.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend request failed: ${response.status} ${body}`.trim());
  }
  const result = (await response.json().catch(() => null)) as { id?: unknown } | null;
  return { id: typeof result?.id === "string" ? result.id : null };
}

export async function sendWorkspaceReviewerInvitationEmail(
  params: { destinationUrl: string; email: string; invitationId: string },
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  throwIfMaintenanceCancelled(signal);
  const { apiKey, fromEmail: configuredFromEmail } = getResendConfig();
  const fromEmail = normalizeResendFromEmail(configuredFromEmail);
  if (!apiKey || !fromEmail) throw new Error("Resend is not configured");
  const destination = new URL(params.destinationUrl);
  if (!["http:", "https:"].includes(destination.protocol)) {
    throw new Error("Reviewer invitation destination must be an absolute HTTP URL.");
  }
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    signal: resendRequestSignal(signal),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `workspace-reviewer-invitation:${params.invitationId}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [params.email],
      subject: "You’re invited to review with RateLoop",
      text: `You have been invited to review assigned private work with RateLoop.\n\nAccept invitation: ${params.destinationUrl}\n\nThis link is personal and may expire. Do not forward it.`,
      html: buildRateLoopEmailHtml({
        kind: "action",
        eyebrow: "Reviewer invitation",
        title: "Review with RateLoop",
        body: "You have been invited to review assigned private work without joining the sender’s workspace.",
        ctaLabel: "Review invitation",
        ctaHref: params.destinationUrl,
        preheader: "Open your private RateLoop reviewer invitation.",
        footerNote: "This personal invitation may expire. Do not forward it.",
      }),
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend request failed: ${response.status} ${body}`.trim());
  }
  const result = (await response.json().catch(() => null)) as { id?: unknown } | null;
  return { id: typeof result?.id === "string" ? result.id : null };
}

export function buildTokenlessVerificationUrl(token: string) {
  const appUrl = getOptionalAppUrl();
  if (!appUrl) throw new Error("APP_URL is required for email verification links");
  const url = new URL("/api/notifications/email/verify", appUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function buildTokenlessNotificationSettingsUrl(status?: string) {
  const appUrl = getOptionalAppUrl();
  if (!appUrl) return null;
  const url = new URL("/human/settings", appUrl);
  if (status) url.searchParams.set("email", status);
  url.hash = "notifications";
  return url;
}
