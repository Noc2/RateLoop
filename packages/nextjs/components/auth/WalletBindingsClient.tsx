"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { baseSepolia } from "thirdweb/chains";
import { ConnectButton, ThirdwebProvider, useActiveAccount, useConnect } from "thirdweb/react";
import { Button } from "~~/components/tokenless/ui/Button";
import { readBrowserSession, subscribeToBrowserAuthSessionChanges } from "~~/lib/auth/client";
import type { WalletBindingPurpose } from "~~/lib/auth/walletBindings";
import { rateLoopThirdwebManagedWallet, rateLoopThirdwebWallets, thirdwebBrowserClient } from "~~/lib/thirdweb/client";

export type Binding = {
  bindingId: string;
  purpose: WalletBindingPurpose;
  source: "self_custodial" | "thirdweb";
  walletAddress: string;
};

type SelectableWalletPurpose = Extract<WalletBindingPurpose, "funding" | "payout">;

const PURPOSES: SelectableWalletPurpose[] = ["funding", "payout"];

type WalletBindingLoadState = "loading" | "ready" | "error";

export function WalletPurposeChooser({
  purpose,
  onSelect,
}: {
  purpose: SelectableWalletPurpose;
  onSelect: (purpose: SelectableWalletPurpose) => void;
}) {
  const t = useTranslations("account.walletBinding");
  return (
    <fieldset>
      <legend className="text-xl font-semibold">{t("chooserTitle")}</legend>
      <p className="mt-2 text-sm leading-6 text-base-content/60">{t("chooserDescription")}</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {PURPOSES.map(option => (
          <button
            key={option}
            type="button"
            aria-pressed={purpose === option}
            className={`rounded-xl border p-4 text-left transition ${
              purpose === option
                ? "border-[var(--rateloop-blue)] bg-[var(--rateloop-blue)]/10"
                : "border-base-content/10 hover:border-base-content/25"
            }`}
            onClick={() => onSelect(option)}
          >
            <span className="block font-semibold">{t(`purpose.${option}.title`)}</span>
            <span className="mt-2 block text-sm leading-5 text-base-content/60">
              {t(`purpose.${option}.description`)}
            </span>
            <span className="mt-3 block text-sm font-semibold text-[var(--rateloop-blue)]">
              {t(`purpose.${option}.action`)}
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

async function jsonRequest<T>(url: string, fallbackMessage: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const body = (await response.json()) as T & { error?: unknown };
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : fallbackMessage);
  return body;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletBindingList({
  bindings,
  busy,
  loadState,
  onRevoke,
}: {
  bindings: Binding[];
  busy: boolean;
  loadState: WalletBindingLoadState;
  onRevoke: (bindingId: string) => void;
}) {
  const t = useTranslations("account.walletBinding");
  if (loadState === "loading") {
    return (
      <p className="mt-3 text-sm text-base-content/55" role="status">
        {t("loading")}
      </p>
    );
  }
  if (loadState === "error") return null;
  if (!bindings.length) return <p className="mt-3 text-sm text-base-content/55">{t("empty")}</p>;
  return (
    <ul className="mt-4 space-y-3">
      {bindings.map(binding => {
        const purposeLabel =
          binding.purpose === "funding" || binding.purpose === "payout"
            ? t(`purpose.${binding.purpose}.title`)
            : t("purpose.connection");
        const address = shortAddress(binding.walletAddress);
        return (
          <li
            key={binding.bindingId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-base-content/10 p-4"
          >
            <div>
              <p className="font-medium">{purposeLabel}</p>
              <p className="font-mono text-xs text-base-content/50">
                {address} · {binding.source === "thirdweb" ? t("appWallet") : t("yourWallet")}
              </p>
            </div>
            <button
              aria-label={t("removeWallet", { address, purpose: purposeLabel })}
              className="btn btn-ghost btn-sm text-error"
              disabled={busy}
              onClick={() => onRevoke(binding.bindingId)}
              type="button"
            >
              {t("remove")}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function WalletBindingControls({
  initialPurpose,
  managedWalletEnabled,
}: {
  initialPurpose: SelectableWalletPurpose;
  managedWalletEnabled: boolean;
}) {
  const t = useTranslations("account.walletBinding");
  const account = useActiveAccount();
  const { connect, isConnecting } = useConnect();
  const [purpose, setPurpose] = useState<SelectableWalletPurpose>(initialPurpose);
  const [thirdwebJti, setThirdwebJti] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [loadState, setLoadState] = useState<WalletBindingLoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const principalRef = useRef<string | null>(null);
  const principalEpochRef = useRef(0);
  const sessionReadRef = useRef(0);

  const refresh = useCallback(async () => {
    const epoch = principalEpochRef.current;
    const result = await jsonRequest<{ bindings: Binding[] }>("/api/account/wallets", t("requestFailed"));
    if (epoch === principalEpochRef.current) setBindings(result.bindings);
  }, [t]);

  useEffect(() => {
    const refreshSession = async () => {
      const sessionRead = ++sessionReadRef.current;
      setLoadState("loading");
      setError(null);
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
          setNotice(null);
        }
        if (nextPrincipal) await refresh();
        if (sessionRead === sessionReadRef.current) setLoadState("ready");
      } catch {
        if (sessionRead === sessionReadRef.current) {
          setError(t("loadFailed"));
          setLoadState("error");
        }
      }
    };
    void refreshSession();
    return subscribeToBrowserAuthSessionChanges(() => void refreshSession());
  }, [refresh, t]);

  async function createThirdwebWallet() {
    const client = thirdwebBrowserClient;
    if (!client) return;
    const epoch = principalEpochRef.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const issued = await jsonRequest<{ jwt: string; jti: string }>(
        "/api/account/wallets/thirdweb-token",
        t("requestFailed"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (epoch !== principalEpochRef.current) return;
      await connect(async () => {
        await rateLoopThirdwebManagedWallet.connect({ client, strategy: "jwt", jwt: issued.jwt });
        return rateLoopThirdwebManagedWallet;
      });
      if (epoch === principalEpochRef.current) setThirdwebJti(issued.jti);
    } catch {
      if (epoch === principalEpochRef.current) {
        setError(t("createFailed"));
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
      const challenge = await jsonRequest<{ challengeId: string; message: string }>(
        "/api/account/wallets/challenge",
        t("requestFailed"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: account.address,
            purpose,
            source,
            ...(thirdwebJti ? { thirdwebJti } : {}),
          }),
        },
      );
      if (epoch !== principalEpochRef.current) return;
      const signature = await account.signMessage({ message: challenge.message });
      if (epoch !== principalEpochRef.current) return;
      await jsonRequest("/api/account/wallets/bind", t("requestFailed"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...challenge, signature }),
      });
      if (epoch !== principalEpochRef.current) return;
      setThirdwebJti(null);
      await refresh();
      setNotice(t(`purpose.${purpose}.saved`));
    } catch {
      if (epoch === principalEpochRef.current) {
        setError(t("bindFailed"));
      }
    } finally {
      if (epoch === principalEpochRef.current) setBusy(false);
    }
  }

  async function revoke(bindingId: string) {
    const epoch = principalEpochRef.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await jsonRequest(`/api/account/wallets/${encodeURIComponent(bindingId)}`, t("requestFailed"), {
        method: "DELETE",
      });
      if (epoch !== principalEpochRef.current) return;
      await refresh();
      setNotice(t("removed"));
    } catch {
      if (epoch === principalEpochRef.current) {
        setError(t("revokeFailed"));
      }
    } finally {
      if (epoch === principalEpochRef.current) setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-base-content/10 bg-base-content/[0.03] p-5">
        <WalletPurposeChooser purpose={purpose} onSelect={setPurpose} />
      </section>

      <div className={`grid gap-4 ${managedWalletEnabled ? "md:grid-cols-2" : "max-w-xl"}`}>
        <section className="rounded-xl border border-base-content/10 p-5">
          <h2 className="font-semibold">{t("existingTitle")}</h2>
          <p className="mb-4 mt-2 text-sm leading-6 text-base-content/60">{t("existingDescription")}</p>
          <ConnectButton
            client={thirdwebBrowserClient!}
            chain={baseSepolia}
            chains={[baseSepolia]}
            wallets={rateLoopThirdwebWallets}
            connectButton={{ label: t("connect") }}
            connectModal={{ showThirdwebBranding: false, size: "compact", title: t("connectModal") }}
          />
        </section>
        {managedWalletEnabled ? (
          <section className="rounded-xl border border-base-content/10 p-5">
            <h2 className="font-semibold">{t("createTitle")}</h2>
            <p className="mb-4 mt-2 text-sm leading-6 text-base-content/60">{t("createDescription")}</p>
            <button
              className="btn btn-outline w-full"
              disabled={busy || isConnecting}
              onClick={() => void createThirdwebWallet()}
            >
              {t("create")}
            </button>
          </section>
        ) : null}
      </div>

      {account ? (
        <section className="rounded-xl border border-[var(--rateloop-blue)]/30 bg-[var(--rateloop-blue)]/5 p-5">
          <p className="text-sm text-base-content/65">{t("connected", { address: shortAddress(account.address) })}</p>
          <Button
            variant="primary"
            className="mt-4 px-5"
            type="button"
            disabled={busy}
            onClick={() => void bindActiveWallet()}
          >
            {t(`purpose.${purpose}.confirmation`)}
          </Button>
        </section>
      ) : null}

      <section>
        <h2 className="text-xl font-semibold">{t("yourWallets")}</h2>
        <WalletBindingList
          bindings={bindings}
          busy={busy}
          loadState={loadState}
          onRevoke={bindingId => void revoke(bindingId)}
        />
      </section>

      <p className="text-xs leading-5 text-base-content/45">{t("privacy")}</p>
      {notice ? (
        <p className="text-sm text-success" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function WalletBindingsClient({
  initialPurpose = "payout",
  managedWalletEnabled,
}: {
  initialPurpose?: SelectableWalletPurpose;
  managedWalletEnabled: boolean;
}) {
  const t = useTranslations("account.walletBinding");
  if (!thirdwebBrowserClient) {
    return (
      <p className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm leading-6 text-base-content/70">
        {t("unavailable")}
      </p>
    );
  }
  return (
    <ThirdwebProvider>
      <WalletBindingControls initialPurpose={initialPurpose} managedWalletEnabled={managedWalletEnabled} />
    </ThirdwebProvider>
  );
}
