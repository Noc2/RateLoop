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
const AUTH_SESSION_SOURCE =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `rateloop-${Math.random().toString(36).slice(2)}`;

type BrowserSessionValue = BrowserSessionResponse | null;
type BrowserSessionRead = { promise: Promise<BrowserSessionValue> };

let browserSessionRead: BrowserSessionRead | null = null;
const browserSessionListeners = new Set<() => void>();
let browserSessionChannel: BroadcastChannel | null = null;
let browserSessionEventsAttached = false;

function invalidateBrowserSessionRead() {
  browserSessionRead = null;
}

function notifyBrowserSessionListeners() {
  invalidateBrowserSessionRead();
  for (const listener of [...browserSessionListeners]) listener();
}

function onBrowserSessionVisibilityChange() {
  if (document.visibilityState === "visible") notifyBrowserSessionListeners();
}

function onBrowserSessionChannelMessage(event: MessageEvent<unknown>) {
  const message = event.data;
  if (
    message &&
    typeof message === "object" &&
    "source" in message &&
    (message as { source?: unknown }).source === AUTH_SESSION_SOURCE
  ) {
    return;
  }
  notifyBrowserSessionListeners();
}

function attachBrowserSessionEvents() {
  if (browserSessionEventsAttached) return;
  browserSessionEventsAttached = true;
  window.addEventListener("focus", notifyBrowserSessionListeners);
  window.addEventListener(AUTH_SESSION_EVENT, notifyBrowserSessionListeners);
  document.addEventListener("visibilitychange", onBrowserSessionVisibilityChange);
  if (typeof BroadcastChannel !== "undefined") {
    browserSessionChannel = new BroadcastChannel(AUTH_SESSION_CHANNEL);
    browserSessionChannel.addEventListener("message", onBrowserSessionChannelMessage);
  }
}

function detachBrowserSessionEvents() {
  if (!browserSessionEventsAttached) return;
  browserSessionEventsAttached = false;
  window.removeEventListener("focus", notifyBrowserSessionListeners);
  window.removeEventListener(AUTH_SESSION_EVENT, notifyBrowserSessionListeners);
  document.removeEventListener("visibilitychange", onBrowserSessionVisibilityChange);
  browserSessionChannel?.removeEventListener("message", onBrowserSessionChannelMessage);
  browserSessionChannel?.close();
  browserSessionChannel = null;
}

export function notifyBrowserAuthSessionChanged() {
  invalidateBrowserSessionRead();
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(AUTH_SESSION_CHANNEL);
    channel.postMessage({ source: AUTH_SESSION_SOURCE, type: "changed" });
    channel.close();
  }
}

export function subscribeToBrowserAuthSessionChanges(listener: () => void) {
  browserSessionListeners.add(listener);
  attachBrowserSessionEvents();
  return () => {
    browserSessionListeners.delete(listener);
    if (browserSessionListeners.size === 0) detachBrowserSessionEvents();
  };
}

async function jsonRequest<T>(url: string, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(url, { credentials: "same-origin", cache: "no-store", ...init });
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

function requestBrowserSession(fetcher: typeof fetch): Promise<BrowserSessionValue> {
  return jsonRequest<BrowserSessionResponse | { authenticated: false }>("/api/auth/session", undefined, fetcher).then(
    response => (response.authenticated ? response : null),
  );
}

function isolateBrowserSessionAbort<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  if (signal.aborted)
    return Promise.reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    request.then(
      value => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function sharedBrowserSessionRead() {
  if (browserSessionRead) return browserSessionRead.promise;
  const read: BrowserSessionRead = { promise: requestBrowserSession(fetch) };
  browserSessionRead = read;
  void read.promise.then(
    () => {
      if (browserSessionRead === read) browserSessionRead = null;
    },
    () => {
      if (browserSessionRead === read) browserSessionRead = null;
    },
  );
  return read.promise;
}

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

export function readBrowserSession(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<BrowserSessionValue> {
  const request = fetcher === fetch ? sharedBrowserSessionRead() : requestBrowserSession(fetcher);
  return isolateBrowserSessionAbort(request, signal);
}

export function __resetBrowserSessionReadForTests() {
  invalidateBrowserSessionRead();
}
