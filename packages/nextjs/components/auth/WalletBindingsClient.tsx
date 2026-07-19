"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { baseSepolia } from "thirdweb/chains";
import { ConnectButton, ThirdwebProvider, useActiveAccount, useConnect } from "thirdweb/react";
import { readBrowserSession, subscribeToBrowserAuthSessionChanges } from "~~/lib/auth/client";
import type { WalletBindingPurpose } from "~~/lib/auth/walletBindings";
import { rateLoopThirdwebManagedWallet, rateLoopThirdwebWallets, thirdwebBrowserClient } from "~~/lib/thirdweb/client";

type Binding = {
  bindingId: string;
  purpose: WalletBindingPurpose;
  source: "self_custodial" | "thirdweb";
  walletAddress: string;
};

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const body = (await response.json()) as T & { error?: unknown };
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Wallet request failed.");
  return body;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function WalletBindingControls({ managedWalletEnabled }: { managedWalletEnabled: boolean }) {
  const account = useActiveAccount();
  const { connect, isConnecting } = useConnect();
  const [purpose, setPurpose] = useState<WalletBindingPurpose>("payout");
  const [thirdwebJti, setThirdwebJti] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const principalRef = useRef<string | null>(null);
  const principalEpochRef = useRef(0);
  const sessionReadRef = useRef(0);

  const refresh = useCallback(async () => {
    const epoch = principalEpochRef.current;
    const result = await jsonRequest<{ bindings: Binding[] }>("/api/account/wallets");
    if (epoch === principalEpochRef.current) setBindings(result.bindings);
  }, []);

  useEffect(() => {
    const refreshSession = async () => {
      const sessionRead = ++sessionReadRef.current;
      try {
        const session = await readBrowserSession();
        if (sessionRead !== sessionReadRef.current) return;
        const nextPrincipal = session?.principalId ?? null;
        if (principalRef.current !== nextPrincipal) {
          principalRef.current = nextPrincipal;
          principalEpochRef.current += 1;
          setBindings([]);
          setThirdwebJti(null);
          setBusy(false);
          setError(null);
        }
        if (nextPrincipal) await refresh();
      } catch (cause) {
        if (sessionRead === sessionReadRef.current) {
          setError(cause instanceof Error ? cause.message : "Unable to load wallet bindings.");
        }
      }
    };
    void refreshSession();
    return subscribeToBrowserAuthSessionChanges(() => void refreshSession());
  }, [refresh]);

  async function createThirdwebWallet() {
    const client = thirdwebBrowserClient;
    if (!client) return;
    const epoch = principalEpochRef.current;
    setBusy(true);
    setError(null);
    try {
      const issued = await jsonRequest<{ jwt: string; jti: string }>("/api/account/wallets/thirdweb-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (epoch !== principalEpochRef.current) return;
      await connect(async () => {
        await rateLoopThirdwebManagedWallet.connect({ client, strategy: "jwt", jwt: issued.jwt });
        return rateLoopThirdwebManagedWallet;
      });
      if (epoch === principalEpochRef.current) setThirdwebJti(issued.jti);
    } catch (cause) {
      if (epoch === principalEpochRef.current) {
        setError(cause instanceof Error ? cause.message : "Unable to create the optional thirdweb wallet.");
      }
    } finally {
      if (epoch === principalEpochRef.current) setBusy(false);
    }
  }

  async function bindActiveWallet() {
    if (!account) return;
    const epoch = principalEpochRef.current;
    setBusy(true);
    setError(null);
    try {
      const source = thirdwebJti ? "thirdweb" : "self_custodial";
      const challenge = await jsonRequest<{ challengeId: string; message: string }>("/api/account/wallets/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: account.address,
          purpose,
          source,
          ...(thirdwebJti ? { thirdwebJti } : {}),
        }),
      });
      if (epoch !== principalEpochRef.current) return;
      const signature = await account.signMessage({ message: challenge.message });
      if (epoch !== principalEpochRef.current) return;
      await jsonRequest("/api/account/wallets/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...challenge, signature }),
      });
      if (epoch !== principalEpochRef.current) return;
      setThirdwebJti(null);
      await refresh();
    } catch (cause) {
      if (epoch === principalEpochRef.current) {
        setError(cause instanceof Error ? cause.message : "Unable to bind this wallet.");
      }
    } finally {
      if (epoch === principalEpochRef.current) setBusy(false);
    }
  }

  async function revoke(bindingId: string) {
    const epoch = principalEpochRef.current;
    setBusy(true);
    setError(null);
    try {
      await jsonRequest(`/api/account/wallets/${encodeURIComponent(bindingId)}`, { method: "DELETE" });
      if (epoch !== principalEpochRef.current) return;
      await refresh();
    } catch (cause) {
      if (epoch === principalEpochRef.current) {
        setError(cause instanceof Error ? cause.message : "Unable to revoke this wallet binding.");
      }
    } finally {
      if (epoch === principalEpochRef.current) setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-base-content/10 bg-base-content/[0.03] p-5">
        <h2 className="text-xl font-semibold">Choose the purpose first</h2>
        <p className="mt-2 text-sm leading-6 text-base-content/60">
          A wallet never grants access to your RateLoop account. Each proof is limited to one revocable purpose.
        </p>
        <label className="mt-5 block text-sm font-medium" htmlFor="wallet-purpose">
          Wallet purpose
        </label>
        <select
          id="wallet-purpose"
          className="select select-bordered mt-2 w-full"
          value={purpose}
          onChange={event => setPurpose(event.target.value as WalletBindingPurpose)}
        >
          <option value="funding">Funding public USDC asks</option>
          <option value="payout">Receiving public USDC payouts</option>
          <option value="recovery">Account recovery proof</option>
        </select>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-base-content/10 p-5">
          <h2 className="font-semibold">Use your existing wallet</h2>
          <p className="mb-4 mt-2 text-sm leading-6 text-base-content/60">
            Connect MetaMask, Coinbase Wallet, or Base Account. RateLoop never receives your private key.
          </p>
          <ConnectButton
            client={thirdwebBrowserClient!}
            chain={baseSepolia}
            chains={[baseSepolia]}
            wallets={rateLoopThirdwebWallets}
            connectButton={{ label: "Connect existing wallet" }}
            connectModal={{ showThirdwebBranding: false, size: "compact", title: "Connect an existing wallet" }}
          />
        </section>
        {managedWalletEnabled ? (
          <section className="rounded-xl border border-base-content/10 p-5">
            <h2 className="font-semibold">Create an app-scoped wallet</h2>
            <p className="mb-4 mt-2 text-sm leading-6 text-base-content/60">
              Only after you click below, RateLoop issues a five-minute, one-time, PII-free JWT for thirdweb.
            </p>
            <button
              className="btn btn-outline w-full"
              disabled={busy || isConnecting}
              onClick={() => void createThirdwebWallet()}
            >
              Create wallet with thirdweb
            </button>
          </section>
        ) : (
          <section className="rounded-xl border border-base-content/10 p-5">
            <h2 className="font-semibold">App-scoped wallet creation is off</h2>
            <p className="mt-2 text-sm leading-6 text-base-content/60">
              This deployment accepts existing wallets but does not send account tokens to thirdweb.
            </p>
          </section>
        )}
      </div>

      {account ? (
        <section className="rounded-xl border border-[var(--rateloop-blue)]/30 bg-[var(--rateloop-blue)]/5 p-5">
          <p className="text-sm text-base-content/65">Connected wallet: {shortAddress(account.address)}</p>
          <button
            className="rateloop-gradient-action mt-4 min-h-11 px-5"
            disabled={busy}
            onClick={() => void bindActiveWallet()}
          >
            Sign and bind for {purpose}
          </button>
        </section>
      ) : null}

      <section>
        <h2 className="text-xl font-semibold">Active wallet bindings</h2>
        {bindings.length ? (
          <ul className="mt-4 space-y-3">
            {bindings.map(binding => (
              <li
                key={binding.bindingId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-base-content/10 p-4"
              >
                <div>
                  <p className="font-medium capitalize">{binding.purpose}</p>
                  <p className="font-mono text-xs text-base-content/50">
                    {shortAddress(binding.walletAddress)} ·{" "}
                    {binding.source === "thirdweb" ? "thirdweb" : "self-custodial"}
                  </p>
                </div>
                <button
                  className="btn btn-ghost btn-sm text-error"
                  disabled={busy}
                  onClick={() => void revoke(binding.bindingId)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-base-content/55">No wallet is attached to this account.</p>
        )}
      </section>

      <p className="text-xs leading-5 text-base-content/45">
        Funding and payout addresses are public on Base. Reusing an address can link paid activity across rounds. A
        thirdweb wallet remains subject to thirdweb recovery and export capabilities; review those terms before use.
      </p>
      {error ? (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function WalletBindingsClient({ managedWalletEnabled }: { managedWalletEnabled: boolean }) {
  if (!thirdwebBrowserClient) {
    return (
      <p className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm leading-6 text-base-content/70">
        Wallet connections are not configured for this deployment. Your RateLoop account still works without one.
      </p>
    );
  }
  return (
    <ThirdwebProvider>
      <WalletBindingControls managedWalletEnabled={managedWalletEnabled} />
    </ThirdwebProvider>
  );
}
