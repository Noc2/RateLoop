"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { type BrowserSessionResponse, logoutBrowserSession, readBrowserSession } from "~~/lib/auth/client";

export const RATELOOP_SIGN_IN_LABEL = "Sign In";
export const RATELOOP_THIRDWEB_AUTO_CONNECT = false;

export function rateLoopConnectButtonStyle(compact: boolean) {
  return {
    background: "linear-gradient(#121212, #121212) padding-box, var(--rateloop-spectrum-gradient) border-box",
    border: compact ? "1.25px solid transparent" : "1px solid transparent",
    borderRadius: "0.5rem",
    boxShadow: "0 18px 36px rgb(0 0 0 / 0.32)",
    color: "var(--rateloop-warm-white)",
    ...(compact
      ? {
          fontSize: "1rem",
          fontWeight: 700,
          height: "2.5rem",
          lineHeight: 1,
          minHeight: "2.5rem",
          minWidth: "max-content",
          padding: "0.56rem 0.9rem",
        }
      : { minWidth: "8.5rem" }),
    whiteSpace: "nowrap",
  } as const;
}

export function sessionLabel(session: BrowserSessionResponse | null) {
  if (!session) return null;
  if (session.displayName) return session.displayName;
  return `Account ${session.principalId.slice(-6)}`;
}

export function AuthenticatedSessionControl({
  compact = false,
  onSignOut,
  session,
}: {
  compact?: boolean;
  onSignOut: () => Promise<void> | void;
  session: BrowserSessionResponse;
}) {
  const label = sessionLabel(session) ?? "RateLoop account";
  return (
    <div
      className={`flex w-full items-center justify-between gap-2 rounded-lg border border-base-content/15 bg-base-content/[0.06] ${
        compact ? "px-2.5 py-2" : "px-3 py-2.5"
      }`}
    >
      <div className="min-w-0">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-base-content/50">Signed in</span>
        <span className="block truncate text-sm font-semibold text-base-content" title={label}>
          {label}
        </span>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-xs shrink-0 px-2 text-base-content/70 hover:text-base-content"
        aria-label={`Sign out ${label}`}
        onClick={() => void onSignOut()}
      >
        Sign Out
      </button>
    </div>
  );
}

// The compatibility export name keeps older layout imports stable. Browser identity is now Better Auth, not thirdweb.
export function ThirdwebSessionButton({
  compact = false,
  onSessionChange,
}: {
  compact?: boolean;
  onSessionChange?: (authenticated: boolean) => void;
}) {
  const [session, setSession] = useState<BrowserSessionResponse | null>(null);

  useEffect(() => {
    let active = true;
    void readBrowserSession()
      .then(value => {
        if (!active) return;
        setSession(value);
        onSessionChange?.(value !== null);
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        onSessionChange?.(false);
      });
    return () => {
      active = false;
    };
  }, [onSessionChange]);

  async function signOutRateLoopSession() {
    await logoutBrowserSession();
    setSession(null);
    onSessionChange?.(false);
    window.location.assign("/");
  }

  if (session) {
    return <AuthenticatedSessionControl compact={compact} session={session} onSignOut={signOutRateLoopSession} />;
  }

  return (
    <Link
      href="/sign-in"
      className={`rateloop-gradient-action inline-flex items-center justify-center px-3 ${
        compact ? "h-10 min-h-10 w-auto min-w-0 text-base font-bold leading-none" : "min-h-11 w-full text-sm"
      }`}
      style={rateLoopConnectButtonStyle(compact)}
    >
      {RATELOOP_SIGN_IN_LABEL}
    </Link>
  );
}
