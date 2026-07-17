"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const betterAuthClient = createAuthClient({
  basePath: "/api/auth/better",
  plugins: [emailOTPClient(), passkeyClient(), ssoClient({ domainVerification: { enabled: true } })],
});

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
  return jsonRequest<BrowserSessionResponse>("/api/auth/exchange", {
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
}

export async function readBrowserSession(): Promise<BrowserSessionResponse | null> {
  const response = await jsonRequest<BrowserSessionResponse | { authenticated: false }>("/api/auth/session");
  return response.authenticated ? response : null;
}
