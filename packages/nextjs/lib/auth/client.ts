"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const betterAuthClient = createAuthClient({
  basePath: "/api/auth/better",
  plugins: [emailOTPClient(), passkeyClient(), ssoClient({ domainVerification: { enabled: true } })],
});

const AUTH_SESSION_EVENT = "rateloop:auth-session-changed";
const AUTH_SESSION_CHANNEL = "rateloop-auth-session-v1";

export function notifyBrowserAuthSessionChanged() {
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(AUTH_SESSION_CHANNEL);
    channel.postMessage({ type: "changed" });
    channel.close();
  }
}

export function subscribeToBrowserAuthSessionChanges(listener: () => void) {
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") listener();
  };
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(AUTH_SESSION_CHANNEL);
  const onChannelMessage = () => listener();
  window.addEventListener("focus", listener);
  window.addEventListener(AUTH_SESSION_EVENT, listener);
  document.addEventListener("visibilitychange", onVisibilityChange);
  channel?.addEventListener("message", onChannelMessage);
  return () => {
    window.removeEventListener("focus", listener);
    window.removeEventListener(AUTH_SESSION_EVENT, listener);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    channel?.removeEventListener("message", onChannelMessage);
    channel?.close();
  };
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const body = (await response.json()) as T & { error?: unknown };
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "RateLoop authentication failed.");
  return body;
}

export type BrowserSessionResponse = {
  authenticated: true;
  principalId: string;
  authProvider: string;
  displayName: string | null;
  expiresAt: string;
  wallets: { funding: string | null; payout: string | null; recovery: string | null };
};

export type BrowserAuthConfiguration = {
  configured: boolean;
  methods: { apple: boolean; emailOtp: boolean; google: boolean; passkey: boolean; sso: boolean };
};

export async function readBrowserAuthConfiguration() {
  return jsonRequest<BrowserAuthConfiguration>("/api/auth/config");
}

export async function exchangeBetterAuthSession() {
  const session = await jsonRequest<BrowserSessionResponse>("/api/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  notifyBrowserAuthSessionChanged();
  return session;
}

export async function issueAccountDeletionProof() {
  return jsonRequest<{ expiresAt: string; proof: string }>("/api/account/deletion/recent-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function logoutBrowserSession() {
  await jsonRequest<{ ok: true }>("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  await betterAuthClient.signOut().catch(() => undefined);
  notifyBrowserAuthSessionChanged();
}

export async function readBrowserSession(signal?: AbortSignal): Promise<BrowserSessionResponse | null> {
  const response = await jsonRequest<BrowserSessionResponse | { authenticated: false }>("/api/auth/session", {
    signal,
  });
  return response.authenticated ? response : null;
}
