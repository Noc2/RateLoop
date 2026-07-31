"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DEFAULT_LOCALE, isLocale } from "~~/i18n/config";
import { Link } from "~~/i18n/navigation";
import {
  type BrowserSessionResponse,
  logoutBrowserSession,
  readBrowserSession,
  subscribeToBrowserAuthSessionChanges,
} from "~~/lib/auth/client";

export const RATELOOP_SIGN_IN_LABEL = "Sign In";
export const RATELOOP_THIRDWEB_AUTO_CONNECT = false;
export const RATELOOP_SIGN_IN_ACTION_CLASS =
  "rateloop-gradient-action rateloop-sign-in-action px-[0.9rem] text-base font-bold leading-none whitespace-nowrap";

export function localizedSignInReturnTo(returnTo: string | undefined, requestedLocale: string) {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//") || !isLocale(requestedLocale)) {
    return returnTo;
  }
  if (
    requestedLocale === DEFAULT_LOCALE ||
    returnTo === `/${requestedLocale}` ||
    returnTo.startsWith(`/${requestedLocale}/`)
  ) {
    return returnTo;
  }
  return `/${requestedLocale}${returnTo}`;
}

export function RateLoopSignInAction({ fill = false, returnTo }: { fill?: boolean; returnTo?: string }) {
  const locale = useLocale();
  const t = useTranslations("auth.session");
  const localizedReturnTo = localizedSignInReturnTo(returnTo, locale);
  const href = localizedReturnTo ? `/sign-in?returnTo=${encodeURIComponent(localizedReturnTo)}` : "/sign-in";
  return (
    <Link href={href} className={`${RATELOOP_SIGN_IN_ACTION_CLASS} ${fill ? "w-full" : "w-auto min-w-max"}`}>
      {t("signIn")}
    </Link>
  );
}

export function sessionLabel(session: BrowserSessionResponse | null, fallback = "Your account") {
  if (!session) return null;
  if (session.displayName) return session.displayName;
  return fallback;
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
  const t = useTranslations("auth.session");
  const label = sessionLabel(session, t("yourAccount")) ?? t("rateLoopAccount");
  return (
    <div
      className={`flex w-full items-center gap-2 rounded-lg border border-base-content/15 bg-base-content/[0.06] ${
        compact ? "p-2" : "p-2.5"
      }`}
    >
      <Link
        href="/human/profile"
        className="group flex min-w-0 flex-1 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rateloop-blue)]"
        aria-label={t("openProfile", { account: label })}
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
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
            {t("signedIn")}
          </span>
        </span>
      </Link>
      <button
        type="button"
        className="btn btn-ghost btn-sm h-8 min-h-8 w-8 shrink-0 px-0 text-base-content/55 hover:text-base-content"
        aria-label={t("signOutAccount", { account: label })}
        title={t("signOut")}
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
  returnTo,
}: {
  compact?: boolean;
  onSessionChange?: (authenticated: boolean) => void;
  returnTo?: string;
}) {
  const locale = useLocale();
  const [session, setSession] = useState<BrowserSessionResponse | null>(null);
  const sessionGenerationRef = useRef(0);

  const refreshSession = useCallback(() => {
    const generation = ++sessionGenerationRef.current;
    void readBrowserSession()
      .then(value => {
        if (generation !== sessionGenerationRef.current) return;
        setSession(value);
        onSessionChange?.(value !== null);
      })
      .catch(() => {
        if (generation !== sessionGenerationRef.current) return;
        setSession(null);
        onSessionChange?.(false);
      });
  }, [onSessionChange]);

  useEffect(() => {
    refreshSession();
    return subscribeToBrowserAuthSessionChanges(refreshSession);
  }, [refreshSession]);

  async function signOutRateLoopSession() {
    await logoutBrowserSession();
    setSession(null);
    onSessionChange?.(false);
    window.location.assign(locale === DEFAULT_LOCALE ? "/" : `/${locale}`);
  }

  if (session) {
    return <AuthenticatedSessionControl compact={compact} session={session} onSignOut={signOutRateLoopSession} />;
  }

  return <RateLoopSignInAction fill={!compact} returnTo={returnTo} />;
}
