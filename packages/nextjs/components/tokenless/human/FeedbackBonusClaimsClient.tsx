"use client";

import { useEffect, useState } from "react";
import { eth_getTransactionByHash, getRpcClient, prepareTransaction, sendTransaction, waitForReceipt } from "thirdweb";
import { baseSepolia } from "thirdweb/chains";
import { ConnectButton, ThirdwebProvider, useActiveAccount } from "thirdweb/react";
import { readBrowserSession } from "~~/lib/auth/client";
import { rateLoopThirdwebWallets, thirdwebBrowserClient } from "~~/lib/thirdweb/client";
import type { PublicFeedbackBonusEntitlement } from "~~/lib/tokenless/feedbackBonusRecipientClaims";
import { listDeviceRecoveries, parseDeviceRecoveryBackup } from "~~/lib/tokenless/rater/deviceRecovery";
import {
  assertFeedbackBonusEntitlementForRecovery,
  buildFeedbackBonusClaimAuthorization,
  verifyFeedbackBonusClaimEvidence,
} from "~~/lib/tokenless/rater/feedbackBonusClaim";
import { importTokenlessRecoveryPackage } from "~~/lib/tokenless/rater/recovery";
import type { TokenlessRaterRoundSecrets } from "~~/lib/tokenless/rater/types";

type RecoverySource = { id: string; label: string; recoveryPackage: string; recoverySecret: string | null };

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

function usdc(atomic: string) {
  const value = BigInt(atomic);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ""} USDC`;
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function FeedbackBonusClaimsControls() {
  const account = useActiveAccount();
  const [sources, setSources] = useState<RecoverySource[]>([]);
  const [selectedSource, setSelectedSource] = useState("");
  const [uploadedSource, setUploadedSource] = useState<RecoverySource | null>(null);
  const [recoverySecret, setRecoverySecret] = useState("");
  const [principalId, setPrincipalId] = useState<string | null>(null);
  const [secrets, setSecrets] = useState<TokenlessRaterRoundSecrets | null>(null);
  const [items, setItems] = useState<PublicFeedbackBonusEntitlement[]>([]);
  const [busy, setBusy] = useState(false);
  const [claimingPoolId, setClaimingPoolId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function refreshPrincipalRecoveries() {
      try {
        const session = await readBrowserSession();
        if (!active) return;
        const nextPrincipalId = session?.principalId ?? null;
        const found: RecoverySource[] = nextPrincipalId
          ? listDeviceRecoveries(nextPrincipalId).map(record => ({
              id: `device:${record.voteKey.toLowerCase()}`,
              label: `Round ${record.roundId} · this device`,
              recoveryPackage: record.recoveryPackage,
              recoverySecret: null,
            }))
          : [];
        found.sort((left, right) => right.id.localeCompare(left.id));
        setPrincipalId(nextPrincipalId);
        setSources(found);
        setSelectedSource(found[0]?.id ?? "");
        setUploadedSource(null);
        setRecoverySecret("");
        setSecrets(null);
        setItems([]);
        setError(null);
        setStatus(null);
      } catch {
        if (!active) return;
        setPrincipalId(null);
        setSources([]);
        setSelectedSource("");
        setSecrets(null);
        setItems([]);
        setStatus(null);
        setError("Sign in again to load recovery material for this account.");
      }
    }
    void refreshPrincipalRecoveries();
    window.addEventListener("focus", refreshPrincipalRecoveries);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshPrincipalRecoveries);
    };
  }, []);

  function resetEvidence() {
    setSecrets(null);
    setItems([]);
    setError(null);
    setStatus(null);
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    resetEvidence();
    try {
      const session = await readBrowserSession();
      if (!session || session.principalId !== principalId) {
        throw new Error("The active account changed. Reload recovery material for this account.");
      }
      const serialized = await file.text();
      const backup = parseDeviceRecoveryBackup(serialized);
      if (backup && backup.record.principalId !== session.principalId) {
        throw new Error("This recovery backup belongs to another RateLoop account.");
      }
      const source: RecoverySource = {
        id: "uploaded",
        label: file.name,
        recoveryPackage: backup?.record.recoveryPackage ?? serialized,
        recoverySecret: backup?.recoverySecret ?? null,
      };
      setUploadedSource(source);
      setSelectedSource(source.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The recovery package could not be read.");
    }
  }

  async function checkEntitlements() {
    const source =
      selectedSource === uploadedSource?.id ? uploadedSource : sources.find(value => value.id === selectedSource);
    if (!source) {
      setError("Choose a saved review or import a backup first.");
      return;
    }
    const secret = source.recoverySecret ?? recoverySecret;
    if (secret.length < 12) {
      setError("Enter the recovery secret for this saved review.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("Opening the saved review on this device…");
    try {
      const session = await readBrowserSession();
      if (!session || session.principalId !== principalId) {
        throw new Error("The active account changed. Reload recovery material for this account.");
      }
      const recovered = await importTokenlessRecoveryPackage(source.recoveryPackage, secret);
      const response = await readJson(
        await fetch(
          `/api/rater/feedback-bonus-entitlements?roundId=${encodeURIComponent(
            recovered.reveal.roundId.toString(10),
          )}&voteKey=${encodeURIComponent(recovered.reveal.voteKey)}`,
          { cache: "no-store", credentials: "same-origin" },
        ),
      );
      const entitlements = (Array.isArray(response.items) ? response.items : []) as PublicFeedbackBonusEntitlement[];
      for (const entitlement of entitlements) assertFeedbackBonusEntitlementForRecovery(entitlement, recovered);
      setSecrets(recovered);
      setItems(entitlements);
      setStatus(
        entitlements.length
          ? "Feedback Bonus evidence matches this saved review."
          : "No Feedback Bonus is registered for this public response yet.",
      );
    } catch (cause) {
      setSecrets(null);
      setItems([]);
      setStatus(null);
      setError(cause instanceof Error ? cause.message : "Unable to check Feedback Bonuses.");
    } finally {
      setBusy(false);
    }
  }

  async function claim(entitlement: PublicFeedbackBonusEntitlement) {
    if (!secrets || !account || !thirdwebBrowserClient) {
      setError("Connect a wallet to relay this claim.");
      return;
    }
    setClaimingPoolId(entitlement.poolId);
    setError(null);
    setStatus("Waiting for the connected wallet to relay the claim…");
    try {
      const session = await readBrowserSession();
      if (!session || session.principalId !== principalId) {
        throw new Error("The active account changed. Reload recovery material for this account.");
      }
      const authorization = buildFeedbackBonusClaimAuthorization({
        entitlement,
        secrets,
        relayerAddress: account.address,
      });
      const result = await sendTransaction({
        account,
        transaction: prepareTransaction({
          client: thirdwebBrowserClient,
          chain: baseSepolia,
          to: authorization.contractAddress,
          data: authorization.transactionData,
        }),
      });
      setStatus("Claim submitted · checking the exact on-chain event…");
      const [receipt, transaction] = await Promise.all([
        waitForReceipt({ client: thirdwebBrowserClient, chain: baseSepolia, transactionHash: result.transactionHash }),
        eth_getTransactionByHash(getRpcClient({ client: thirdwebBrowserClient, chain: baseSepolia }), {
          hash: result.transactionHash,
        }),
      ]);
      verifyFeedbackBonusClaimEvidence({
        authorization,
        evidence: {
          transactionHash: result.transactionHash,
          transactionFrom: transaction.from,
          transactionTo: transaction.to,
          transactionData: transaction.input,
          receiptStatus: receipt.status,
          logs: receipt.logs,
        },
      });
      setItems(current =>
        current.map(item => (item.poolId === entitlement.poolId ? { ...item, claimed: true } : item)),
      );
      setStatus(`${usdc(entitlement.awardAmountAtomic)} claimed to the saved payout address.`);
    } catch (cause) {
      setStatus(null);
      setError(cause instanceof Error ? cause.message : "Unable to claim this Feedback Bonus.");
    } finally {
      setClaimingPoolId(null);
    }
  }

  const allSources = uploadedSource ? [...sources, uploadedSource] : sources;
  const activeSource = allSources.find(source => source.id === selectedSource);
  const needsRecoverySecret = Boolean(activeSource && !activeSource.recoverySecret);
  const claimable = items.some(item => item.awarded && !item.claimed);

  return (
    <section className="surface-card rounded-2xl p-5" aria-labelledby="feedback-bonus-claims-title">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Optional award</p>
      <h2 id="feedback-bonus-claims-title" className="mt-2 text-xl font-semibold">
        Claim a Feedback Bonus
      </h2>
      <p className="mt-2 text-sm leading-6 text-base-content/60">
        RateLoop checks this review on your device, sending only its public round and vote key. The paid commit&apos;s
        public tlock ciphertext becomes decryptable after the commit deadline with no post-commit abort, exposing the
        vote, prediction, response hash, payout address, and salt even without a reveal or claim. Claiming later submits
        the payout address and salt on-chain; any wallet may relay, but funds still go to that address.
      </p>
      <div className="mt-4">
        <label className="text-sm">
          Saved review
          <select
            className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
            value={selectedSource}
            onChange={event => {
              resetEvidence();
              setSelectedSource(event.target.value);
            }}
          >
            <option value="">Choose a review</option>
            {allSources.map(source => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {needsRecoverySecret ? (
        <div className="mt-3 rounded-lg border border-white/10 p-3 text-sm text-base-content/60">
          <label className="block text-xs">
            Recovery secret
            <input
              className="input input-sm mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              type="password"
              value={recoverySecret}
              onChange={event => {
                resetEvidence();
                setRecoverySecret(event.target.value);
              }}
              minLength={12}
              maxLength={1024}
              autoComplete="off"
            />
          </label>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="rateloop-secondary-action cursor-pointer rounded-lg px-4 py-2 text-sm">
          Import backup
          <input
            className="sr-only"
            type="file"
            accept="application/json,.json"
            onChange={event => void loadFile(event.target.files?.[0])}
          />
        </label>
        <button
          type="button"
          className="rateloop-gradient-action px-4 text-sm"
          disabled={busy || !selectedSource || (needsRecoverySecret && recoverySecret.length < 12)}
          onClick={() => void checkEntitlements()}
        >
          {busy ? "Checking…" : "Check bonus"}
        </button>
      </div>
      {items.length ? (
        <div className="mt-5 space-y-3">
          {items.map(item => (
            <article key={`${item.poolId}:${item.feedbackId}`} className="surface-card-nested rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {item.awarded ? usdc(item.awardAmountAtomic) : "Awaiting the human award decision"}
                  </p>
                  <p className="mt-1 font-mono text-xs text-base-content/45">
                    Pool {item.poolId} · vote key {shortAddress(item.voteKey)}
                  </p>
                </div>
                {item.claimed ? (
                  <span className="rounded-md bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">Claimed</span>
                ) : item.awarded ? (
                  <button
                    type="button"
                    className="rateloop-gradient-action px-4 text-sm"
                    disabled={!account || claimingPoolId === item.poolId}
                    onClick={() => void claim(item)}
                  >
                    {claimingPoolId === item.poolId ? "Claiming…" : "Claim bonus"}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {claimable && !account && thirdwebBrowserClient ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-4">
          <p className="text-sm text-base-content/60">
            Connect a wallet to claim. Funds go only to the saved payout address.
          </p>
          <ConnectButton
            client={thirdwebBrowserClient}
            chain={baseSepolia}
            chains={[baseSepolia]}
            wallets={rateLoopThirdwebWallets}
            connectButton={{ label: "Connect wallet" }}
            connectModal={{ showThirdwebBranding: false, size: "compact", title: "Connect wallet" }}
          />
        </div>
      ) : null}
      {status ? (
        <p className="mt-4 text-sm text-emerald-100" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function FeedbackBonusClaimsClient() {
  return (
    <ThirdwebProvider>
      <FeedbackBonusClaimsControls />
    </ThirdwebProvider>
  );
}
