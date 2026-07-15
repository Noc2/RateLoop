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
  return "Your account";
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
      className={`flex w-full items-center gap-2 rounded-lg border border-base-content/15 bg-base-content/[0.06] ${
        compact ? "p-2" : "p-2.5"
      }`}
    >
      <Link
        href="/human?tab=profile"
        className="group flex min-w-0 flex-1 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rateloop-blue)]"
        aria-label={`Open profile for ${label}`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-base-content/15 bg-base-content/[0.07] text-base-content/70 transition-colors group-hover:text-base-content">
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M20 21a8 8 0 0 0-16 0" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-base-content" title={label}>
            {label}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-base-content/55">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Signed in
          </span>
        </span>
      </Link>
      <button
        type="button"
        className="btn btn-ghost btn-sm h-8 min-h-8 w-8 shrink-0 px-0 text-base-content/55 hover:text-base-content"
        aria-label={`Sign out ${label}`}
        title="Sign out"
        onClick={() => void onSignOut()}
      >
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M10 17l5-5-5-5M15 12H3" />
          <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
        </svg>
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
