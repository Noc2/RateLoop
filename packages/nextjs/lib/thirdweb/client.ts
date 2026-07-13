"use client";

import { createThirdwebClient } from "thirdweb";
import type { LoginPayload, VerifyLoginPayloadParams } from "thirdweb/auth";
import { createWallet, inAppWallet } from "thirdweb/wallets";

const clientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID?.trim();

export const thirdwebBrowserClient = clientId ? createThirdwebClient({ clientId }) : null;

export const rateLoopThirdwebWallets = [
  inAppWallet({
    auth: { options: ["email", "google", "apple", "passkey"] },
    metadata: {
      name: "RateLoop account",
      icon: "/rateloop-logo.svg",
    },
  }),
  createWallet("org.base.account"),
];

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const body = (await response.json()) as T & { error?: unknown };
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "RateLoop authentication failed.");
  return body;
}

export type BrowserSessionResponse = {
  authenticated: true;
  address: string;
  authProvider: string;
  email: string | null;
  displayName: string | null;
  expiresAt: string;
};

export async function getLoginPayload(input: { address: string; chainId: number }) {
  return jsonRequest<LoginPayload>("/api/auth/payload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function loginWithThirdweb(input: VerifyLoginPayloadParams) {
  return jsonRequest<BrowserSessionResponse>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function logoutBrowserSession() {
  await jsonRequest<{ ok: true }>("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function readBrowserSession(): Promise<BrowserSessionResponse | null> {
  const response = await jsonRequest<BrowserSessionResponse | { authenticated: false }>("/api/auth/session");
  return response.authenticated ? response : null;
}
