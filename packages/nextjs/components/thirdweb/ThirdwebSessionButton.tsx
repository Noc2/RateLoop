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

export function ThirdwebSessionButton({ compact = false }: { compact?: boolean }) {
  const [session, setSession] = useState<BrowserSessionResponse | null>(null);
  const [configurationError, setConfigurationError] = useState(false);

  useEffect(() => {
    let active = true;
    void readBrowserSession()
      .then(value => {
        if (active) setSession(value);
      })
      .catch(() => {
        if (active) setSession(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const isLoggedIn = useCallback(async (address: string) => {
    const current = await readBrowserSession();
    setSession(current);
    return current?.address.toLowerCase() === address.toLowerCase();
  }, []);

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

  if (!thirdwebBrowserClient) {
    return (
      <div className={compact ? "w-full" : undefined}>
        <button
          type="button"
          className={`rateloop-gradient-action w-full px-3 opacity-70 ${compact ? "min-h-10 text-base" : "min-h-11 text-sm"}`}
          onClick={() => setConfigurationError(true)}
        >
          Sign in
        </button>
        {configurationError ? (
          <p className="mt-2 max-w-56 text-center text-[11px] leading-4 text-error">
            Sign-in is not configured for this RateLoop deployment.
          </p>
        ) : null}
      </div>
    );
  }

  const buttonClass = `rateloop-gradient-action px-3 ${compact ? "!min-h-10 !w-full !text-base" : "!min-h-11 !text-sm"}`;
  const buttonStyle = {
    border: 0,
    borderRadius: "999px",
    color: "white",
    minWidth: compact ? "100%" : "8.5rem",
  } as const;

  return (
    <ThirdwebProvider>
      <div className={compact ? "w-full" : undefined}>
        <ConnectButton
          client={thirdwebBrowserClient}
          chain={baseSepolia}
          chains={[baseSepolia]}
          wallets={rateLoopThirdwebWallets}
          autoConnect={{ timeout: 5_000 }}
          appMetadata={{
            name: "RateLoop",
            description: "Enterprise human assurance for AI-enabled workflows",
            logoUrl: "/rateloop-logo.svg",
          }}
          auth={{
            getLoginPayload,
            doLogin: async input => {
              setSession(await loginWithThirdweb(input));
            },
            doLogout: async () => {
              await logoutBrowserSession();
              setSession(null);
            },
            isLoggedIn,
          }}
          theme={theme}
          connectButton={{
            label: compact ? "Continue with work account" : "Sign in",
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
