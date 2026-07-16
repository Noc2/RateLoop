"use client";

import { useEffect, useState } from "react";
import { eth_getTransactionByHash, getRpcClient, prepareTransaction, sendTransaction, waitForReceipt } from "thirdweb";
import { baseSepolia } from "thirdweb/chains";
import { ConnectButton, ThirdwebProvider, useActiveAccount } from "thirdweb/react";
import { rateLoopThirdwebWallets, thirdwebBrowserClient } from "~~/lib/thirdweb/client";
import type { PublicFeedbackBonusEntitlement } from "~~/lib/tokenless/feedbackBonusRecipientClaims";
import {
  assertFeedbackBonusEntitlementForRecovery,
  buildFeedbackBonusClaimAuthorization,
  verifyFeedbackBonusClaimEvidence,
} from "~~/lib/tokenless/rater/feedbackBonusClaim";
import { importTokenlessRecoveryPackage } from "~~/lib/tokenless/rater/recovery";
import type { TokenlessRaterRoundSecrets } from "~~/lib/tokenless/rater/types";

const RECOVERY_PREFIX = "rateloop:rater-recovery:";

type RecoverySource = { id: string; label: string; serialized: string };

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
  const [secrets, setSecrets] = useState<TokenlessRaterRoundSecrets | null>(null);
  const [items, setItems] = useState<PublicFeedbackBonusEntitlement[]>([]);
  const [busy, setBusy] = useState(false);
  const [claimingPoolId, setClaimingPoolId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const found: RecoverySource[] = [];
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(RECOVERY_PREFIX)) continue;
        const serialized = localStorage.getItem(key);
        if (!serialized) continue;
        const roundId = key.slice(RECOVERY_PREFIX.length);
        found.push({ id: key, label: `Round ${roundId} · this device`, serialized });
      }
    } catch {
      // File import remains available when browser storage is blocked.
    }
    found.sort((left, right) => right.id.localeCompare(left.id));
    setSources(found);
    setSelectedSource(current => current || found[0]?.id || "");
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
      const source = { id: "uploaded", label: file.name, serialized: await file.text() };
      setUploadedSource(source);
      setSelectedSource(source.id);
    } catch {
      setError("The recovery package could not be read.");
    }
  }

  async function checkEntitlements() {
    const source =
      selectedSource === uploadedSource?.id ? uploadedSource : sources.find(value => value.id === selectedSource);
    if (!source) {
      setError("Choose a saved recovery package or import one first.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("Decrypting the recovery package in this browser…");
    try {
      const recovered = await importTokenlessRecoveryPackage(source.serialized, recoverySecret);
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
          ? "Live Feedback Bonus evidence matches this local recovery package."
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
      setStatus(`${usdc(entitlement.awardAmountAtomic)} claimed to the payout address in your recovery package.`);
    } catch (cause) {
      setStatus(null);
      setError(cause instanceof Error ? cause.message : "Unable to claim this Feedback Bonus.");
    } finally {
      setClaimingPoolId(null);
    }
  }

  const allSources = uploadedSource ? [...sources, uploadedSource] : sources;
  const claimable = items.some(item => item.awarded && !item.claimed);

  return (
    <section className="surface-card rounded-2xl p-5" aria-labelledby="feedback-bonus-claims-title">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Optional award</p>
      <h2 id="feedback-bonus-claims-title" className="mt-2 text-xl font-semibold">
        Claim a Feedback Bonus
      </h2>
      <p className="mt-2 text-sm leading-6 text-base-content/60">
        Your recovery package opens the payout commitment locally. Checking sends RateLoop only the public round and
        vote key; claiming reveals the committed payout address and salt on-chain.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Recovery package
          <select
            className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
            value={selectedSource}
            onChange={event => {
              resetEvidence();
              setSelectedSource(event.target.value);
            }}
          >
            <option value="">Choose a package</option>
            {allSources.map(source => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Recovery secret
          <input
            className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
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
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="rateloop-secondary-action cursor-pointer rounded-lg px-4 py-2 text-sm">
          Import package
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
          disabled={busy || recoverySecret.length < 12 || !selectedSource}
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
            Any connected wallet can relay; funds go only to the committed payout address.
          </p>
          <ConnectButton
            client={thirdwebBrowserClient}
            chain={baseSepolia}
            chains={[baseSepolia]}
            wallets={rateLoopThirdwebWallets}
            connectButton={{ label: "Connect relayer wallet" }}
            connectModal={{ showThirdwebBranding: false, size: "compact", title: "Connect a relayer wallet" }}
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
