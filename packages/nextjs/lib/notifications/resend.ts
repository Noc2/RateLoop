import "server-only";
import { getOptionalAppUrl, getResendConfig } from "~~/lib/env/server";

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

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

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export async function sendTokenlessVerificationEmail(params: { email: string; verifyUrl: string }) {
  const { apiKey, fromEmail: configuredFromEmail } = getResendConfig();
  const fromEmail = normalizeResendFromEmail(configuredFromEmail);
  if (!apiKey || !fromEmail) throw new Error("Resend is not configured");

  const safeUrl = escapeHtml(params.verifyUrl);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [params.email],
      subject: "Verify your RateLoop notification email",
      text: `Verify your RateLoop notification email: ${params.verifyUrl}`,
      html: `<!doctype html><html><body style="font-family:ui-sans-serif,system-ui;color:#171717;line-height:1.6"><h1>Verify your RateLoop email</h1><p>Confirm this address to receive RateLoop account and assurance notifications.</p><p><a href="${safeUrl}" style="display:inline-block;background:#171717;color:#fff;border-radius:8px;padding:12px 18px;text-decoration:none;font-weight:600">Verify email</a></p><p style="color:#666;font-size:13px">If you did not request this, you can ignore this email.</p></body></html>`,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend request failed: ${response.status} ${body}`.trim());
  }
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
  const url = new URL("/human", appUrl);
  url.searchParams.set("tab", "settings");
  if (status) url.searchParams.set("email", status);
  url.hash = "notifications";
  return url;
}
