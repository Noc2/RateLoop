"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { baseSepolia } from "thirdweb/chains";
import { ConnectButton, ThirdwebProvider, darkTheme } from "thirdweb/react";
import {
  type BrowserSessionResponse,
  getLoginPayload,
  loginWithThirdweb,
  logoutBrowserSession,
  rateLoopThirdwebWallets,
  readBrowserSession,
  thirdwebBrowserClient,
} from "~~/lib/thirdweb/client";

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

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function sessionLabel(session: BrowserSessionResponse | null) {
  if (!session) return null;
  if (session.displayName) return session.displayName;
  if (session.email) {
    const [local, domain] = session.email.split("@");
    if (local && domain) return `${local.slice(0, 1)}•••@${domain}`;
  }
  return shortAddress(session.address);
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

export function ThirdwebSessionButton({
  compact = false,
  onSessionChange,
}: {
  compact?: boolean;
  onSessionChange?: (authenticated: boolean) => void;
}) {
  const [session, setSession] = useState<BrowserSessionResponse | null>(null);
  const [configurationError, setConfigurationError] = useState(false);

  useEffect(() => {
    let active = true;
    void readBrowserSession()
      .then(value => {
        if (active) {
          setSession(value);
          onSessionChange?.(value !== null);
        }
      })
      .catch(() => {
        if (active) {
          setSession(null);
          onSessionChange?.(false);
        }
      });
    return () => {
      active = false;
    };
  }, [onSessionChange]);

  const isLoggedIn = useCallback(
    async (address: string) => {
      const current = await readBrowserSession();
      setSession(current);
      onSessionChange?.(current !== null);
      return current?.address.toLowerCase() === address.toLowerCase();
    },
    [onSessionChange],
  );

  const theme = useMemo(
    () =>
      darkTheme({
        colors: {
          accentButtonBg: "#4f46e5",
          accentText: "#a5b4fc",
          borderColor: "rgba(255,255,255,0.14)",
          modalBg: "#0a0a0c",
          primaryButtonBg: "#4f46e5",
          primaryButtonText: "#ffffff",
          primaryText: "#ffffff",
          secondaryText: "rgba(255,255,255,0.68)",
        },
      }),
    [],
  );

  async function signOutRateLoopSession() {
    await logoutBrowserSession();
    setSession(null);
    onSessionChange?.(false);
    window.location.assign("/");
  }

  if (session) {
    return <AuthenticatedSessionControl compact={compact} session={session} onSignOut={signOutRateLoopSession} />;
  }

  if (!thirdwebBrowserClient) {
    return (
      <div className={compact ? "flex w-full justify-start" : undefined}>
        <button
          type="button"
          className={`rateloop-gradient-action px-3 opacity-70 ${
            compact
              ? "h-10 min-h-10 w-auto min-w-0 px-[0.9rem] text-base font-bold leading-none"
              : "min-h-11 w-full text-sm"
          }`}
          style={rateLoopConnectButtonStyle(compact)}
          onClick={() => setConfigurationError(true)}
        >
          {RATELOOP_SIGN_IN_LABEL}
        </button>
        {configurationError ? (
          <p className="mt-2 max-w-56 text-center text-[11px] leading-4 text-error">
            Sign-in is not configured for this RateLoop deployment.
          </p>
        ) : null}
      </div>
    );
  }

  const buttonClass = `rateloop-gradient-action px-3 ${
    compact ? "!h-10 !min-h-10 !w-auto !min-w-0 !px-[0.9rem] !text-base !font-bold !leading-none" : "!min-h-11 !text-sm"
  }`;
  const buttonStyle = rateLoopConnectButtonStyle(compact);

  return (
    <ThirdwebProvider>
      <div className={compact ? "flex w-full justify-start" : undefined}>
        <ConnectButton
          client={thirdwebBrowserClient}
          chain={baseSepolia}
          chains={[baseSepolia]}
          wallets={rateLoopThirdwebWallets}
          autoConnect={RATELOOP_THIRDWEB_AUTO_CONNECT}
          appMetadata={{
            name: "RateLoop",
            description: "Enterprise human assurance for AI-enabled workflows",
            logoUrl: "/rateloop-logo.svg",
          }}
          auth={{
            getLoginPayload,
            doLogin: async input => {
              setSession(await loginWithThirdweb(input));
              onSessionChange?.(true);
            },
            doLogout: async () => {
              await logoutBrowserSession();
              setSession(null);
              onSessionChange?.(false);
            },
            isLoggedIn,
          }}
          theme={theme}
          connectButton={{
            label: RATELOOP_SIGN_IN_LABEL,
            className: buttonClass,
            style: buttonStyle,
          }}
          signInButton={{ label: "Finish secure sign-in", className: buttonClass, style: buttonStyle }}
          switchButton={{ label: "Use Base Sepolia", className: buttonClass, style: buttonStyle }}
          detailsButton={{
            connectedAccountName: sessionLabel(session),
            className: buttonClass,
            style: buttonStyle,
          }}
          connectModal={{
            title: "Sign in to RateLoop",
            titleIcon: "/rateloop-logo.svg",
            size: "compact",
            privacyPolicyUrl: "/legal/privacy",
            termsOfServiceUrl: "/legal/terms",
            showThirdwebBranding: false,
          }}
          detailsModal={{
            showTestnetFaucet: false,
            manageWallet: { allowLinkingProfiles: true },
          }}
        />
      </div>
    </ThirdwebProvider>
  );
}
