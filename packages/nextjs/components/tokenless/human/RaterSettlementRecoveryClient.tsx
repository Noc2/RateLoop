"use client";

import { useEffect, useState } from "react";
import { eth_getTransactionByHash, getRpcClient, prepareTransaction, sendTransaction, waitForReceipt } from "thirdweb";
import { baseSepolia } from "thirdweb/chains";
import { ConnectButton, ThirdwebProvider, useActiveAccount } from "thirdweb/react";
import { Field, SelectField } from "~~/components/tokenless/forms/Field";
import { readBrowserSession } from "~~/lib/auth/client";
import { rateLoopThirdwebWallets, thirdwebBrowserClient } from "~~/lib/thirdweb/client";
import { listDeviceRecoveries, parseDeviceRecoveryBackup } from "~~/lib/tokenless/rater/deviceRecovery";
import { importTokenlessRecoveryPackage } from "~~/lib/tokenless/rater/recovery";
import {
  type RaterSettlementAuthorization,
  type RaterSettlementSnapshot,
  buildRaterClaimAuthorization,
  buildRaterRevealAuthorization,
  verifyRaterSettlementEvidence,
} from "~~/lib/tokenless/rater/settlementRecovery";
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

function deadline(seconds: string | null) {
  if (!seconds || seconds === "0") return "Not opened";
  return new Date(Number(BigInt(seconds) * 1_000n)).toLocaleString();
}

function short(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function SettlementRecoveryControls() {
  const account = useActiveAccount();
  const [principalId, setPrincipalId] = useState<string | null>(null);
  const [sources, setSources] = useState<RecoverySource[]>([]);
  const [uploadedSource, setUploadedSource] = useState<RecoverySource | null>(null);
  const [selectedSource, setSelectedSource] = useState("");
  const [recoverySecret, setRecoverySecret] = useState("");
  const [secrets, setSecrets] = useState<TokenlessRaterRoundSecrets | null>(null);
  const [snapshot, setSnapshot] = useState<RaterSettlementSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function refreshRecoveries() {
      try {
        const session = await readBrowserSession();
        if (!active) return;
        const nextPrincipalId = session?.principalId ?? null;
        const found = nextPrincipalId
          ? listDeviceRecoveries(nextPrincipalId).map(record => ({
              id: `device:${record.voteKey.toLowerCase()}`,
              label: `Round ${record.roundId} · ${short(record.voteKey)}`,
              recoveryPackage: record.recoveryPackage,
              recoverySecret: null,
            }))
          : [];
        setPrincipalId(nextPrincipalId);
        setSources(found);
        setSelectedSource(found[0]?.id ?? "");
        setUploadedSource(null);
        setRecoverySecret("");
        setSecrets(null);
        setSnapshot(null);
        setStatus(null);
        setError(null);
      } catch {
        if (!active) return;
        setPrincipalId(null);
        setSources([]);
        setSelectedSource("");
        setError("Sign in again to load settlement recovery for this account.");
      }
    }
    void refreshRecoveries();
    window.addEventListener("focus", refreshRecoveries);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshRecoveries);
    };
  }, []);

  function resetSettlement() {
    setSecrets(null);
    setSnapshot(null);
    setTransactionHash(null);
    setStatus(null);
    setError(null);
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    resetSettlement();
    try {
      const session = await readBrowserSession();
      if (!session || session.principalId !== principalId) {
        throw new Error("The active account changed. Reload settlement recovery.");
      }
      const serialized = await file.text();
      const backup = parseDeviceRecoveryBackup(serialized);
      if (backup && backup.record.principalId !== session.principalId) {
        throw new Error("This recovery backup belongs to another RateLoop account.");
      }
      const source = {
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

  async function fetchSnapshot(path: "reveal" | "claim", recovered: TokenlessRaterRoundSecrets) {
    return (await readJson(
      await fetch(
        `/api/rater/${path}?roundId=${encodeURIComponent(
          recovered.reveal.roundId.toString(10),
        )}&voteKey=${encodeURIComponent(recovered.reveal.voteKey)}`,
        { cache: "no-store", credentials: "same-origin" },
      ),
    )) as unknown as RaterSettlementSnapshot;
  }

  async function checkSettlement() {
    const allSources = uploadedSource ? [...sources, uploadedSource] : sources;
    const source = allSources.find(value => value.id === selectedSource);
    if (!source) return setError("Choose a saved review or import its backup first.");
    const secret = source.recoverySecret ?? recoverySecret;
    if (secret.length < 12) return setError("Enter the recovery secret for this saved review.");
    setBusy(true);
    setError(null);
    setStatus("Opening the saved review on this device…");
    try {
      const session = await readBrowserSession();
      if (!session || session.principalId !== principalId) {
        throw new Error("The active account changed. Reload settlement recovery.");
      }
      const recovered = await importTokenlessRecoveryPackage(source.recoveryPackage, secret);
      const nextSnapshot = await fetchSnapshot("reveal", recovered);
      setSecrets(recovered);
      setSnapshot(nextSnapshot);
      setStatus("The saved review matches your account-bound on-chain commit.");
    } catch (cause) {
      setSecrets(null);
      setSnapshot(null);
      setStatus(null);
      setError(cause instanceof Error ? cause.message : "Unable to load this settlement.");
    } finally {
      setBusy(false);
    }
  }

  async function execute(action: "reveal" | "claim") {
    if (!snapshot || !secrets || !account || !thirdwebBrowserClient) {
      setError("Connect a wallet to relay this settlement action.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(`Waiting for the connected wallet to relay the ${action}…`);
    try {
      const session = await readBrowserSession();
      if (!session || session.principalId !== principalId) {
        throw new Error("The active account changed. Reload settlement recovery.");
      }
      const authorization: RaterSettlementAuthorization =
        action === "reveal"
          ? buildRaterRevealAuthorization({ snapshot, secrets, relayerAddress: account.address })
          : buildRaterClaimAuthorization({ snapshot, secrets, relayerAddress: account.address });
      const result = await sendTransaction({
        account,
        transaction: prepareTransaction({
          client: thirdwebBrowserClient,
          chain: baseSepolia,
          to: authorization.panelAddress,
          data: authorization.transactionData,
        }),
      });
      setStatus(`${action === "reveal" ? "Reveal" : "Claim"} submitted · checking the exact on-chain event…`);
      const [receipt, transaction] = await Promise.all([
        waitForReceipt({ client: thirdwebBrowserClient, chain: baseSepolia, transactionHash: result.transactionHash }),
        eth_getTransactionByHash(getRpcClient({ client: thirdwebBrowserClient, chain: baseSepolia }), {
          hash: result.transactionHash,
        }),
      ]);
      verifyRaterSettlementEvidence({
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
      setTransactionHash(result.transactionHash);
      const refreshed = await fetchSnapshot("claim", secrets);
      setSnapshot(refreshed);
      setStatus(
        action === "reveal"
          ? "Review revealed. Return after settlement to claim before the displayed deadline."
          : `${usdc(authorization.expectedAmountAtomic!.toString(10))} claimed to the saved payout address.`,
      );
    } catch (cause) {
      setStatus(null);
      setError(cause instanceof Error ? cause.message : `Unable to ${action} this review.`);
    } finally {
      setBusy(false);
    }
  }

  const allSources = uploadedSource ? [...sources, uploadedSource] : sources;
  const activeSource = allSources.find(source => source.id === selectedSource);
  const needsRecoverySecret = Boolean(activeSource && !activeSource.recoverySecret);
  const actionAvailable = Boolean(snapshot?.canReveal || snapshot?.canClaim);
  const earnedAtomic = snapshot
    ? snapshot.claimKind === "compensation"
      ? snapshot.compensationAtomic
      : snapshot.finalizedPayoutAtomic
    : "0";

  return (
    <section className="surface-card rounded-2xl p-5" aria-labelledby="settlement-recovery-title">
      <h2 id="settlement-recovery-title" className="text-xl font-semibold">
        Reveal and claim paid reviews
      </h2>
      <p className="mt-2 text-sm leading-6 text-base-content/60">
        Open a saved review locally, reveal it if automatic disclosure has not completed, and claim before the deadline.
        RateLoop receives only the public round and vote key. Your recovery secret, payout key, salt, vote, and response
        stay in this browser until you approve the exact on-chain transaction.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
        <SelectField
          className="border-white/10 bg-[var(--rateloop-field)]"
          label="Saved paid review"
          labelClassName="text-sm"
          value={selectedSource}
          onChange={event => {
            resetSettlement();
            setSelectedSource(event.target.value);
          }}
        >
          <option value="">Choose a review</option>
          {allSources.map(source => (
            <option key={source.id} value={source.id}>
              {source.label}
            </option>
          ))}
        </SelectField>
        <Field
          containerClassName="rateloop-secondary-action mt-7 cursor-pointer self-start rounded-lg px-4 py-2 text-sm"
          className="sr-only"
          label="Import backup"
          labelClassName="m-0 inline text-sm font-normal text-inherit"
          type="file"
          accept="application/json,.json"
          onChange={event => void loadFile(event.target.files?.[0])}
        />
      </div>
      {needsRecoverySecret ? (
        <Field
          containerClassName="mt-3"
          className="border-white/10 bg-[var(--rateloop-field)]"
          label="Recovery secret"
          labelClassName="text-sm"
          type="password"
          minLength={12}
          maxLength={1024}
          autoComplete="off"
          value={recoverySecret}
          onChange={event => {
            resetSettlement();
            setRecoverySecret(event.target.value);
          }}
        />
      ) : null}
      <button
        type="button"
        className="rateloop-gradient-action mt-3 px-4 text-sm"
        disabled={busy || !selectedSource || (needsRecoverySecret && recoverySecret.length < 12)}
        onClick={() => void checkSettlement()}
      >
        {busy && !snapshot ? "Checking…" : "Check settlement"}
      </button>

      {snapshot ? (
        <div className="surface-card-nested mt-5 rounded-xl p-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-base-content/55">Round status</dt>
              <dd className="mt-1 font-medium">{snapshot.roundStatus.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt className="text-base-content/55">Review outcome</dt>
              <dd className="mt-1 font-medium">
                {snapshot.claimed ? "Paid" : snapshot.revealed ? "Revealed" : "Committed"}
              </dd>
            </div>
            <div>
              <dt className="text-base-content/55">Earned</dt>
              <dd className="mt-1 font-medium">{usdc(earnedAtomic)}</dd>
            </div>
            <div>
              <dt className="text-base-content/55">Claim deadline</dt>
              <dd className="mt-1 font-medium">{deadline(snapshot.claimDeadline)}</dd>
            </div>
            <div>
              <dt className="text-base-content/55">Reveal deadline</dt>
              <dd className="mt-1 font-medium">{deadline(snapshot.revealDeadline)}</dd>
            </div>
            <div>
              <dt className="text-base-content/55">Commit</dt>
              <dd className="mt-1 font-mono text-xs">{short(snapshot.commitKey)}</dd>
            </div>
          </dl>
          {actionAvailable && account ? (
            <button
              type="button"
              className="rateloop-gradient-action mt-4 px-4 text-sm"
              disabled={busy}
              onClick={() => void execute(snapshot.canReveal ? "reveal" : "claim")}
            >
              {busy ? "Confirming…" : snapshot.canReveal ? "Reveal review" : `Claim ${usdc(earnedAtomic)}`}
            </button>
          ) : null}
          {actionAvailable && !account && thirdwebBrowserClient ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-base-content/60">
                Any wallet may relay. Funds still go only to the saved payout address.
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
        </div>
      ) : null}
      {transactionHash ? (
        <a
          className="mt-4 block text-sm text-[var(--rateloop-pink)] underline"
          href={`https://sepolia.basescan.org/tx/${transactionHash}`}
          target="_blank"
          rel="noreferrer"
        >
          View confirmed transaction
        </a>
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

export function RaterSettlementRecoveryClient() {
  return (
    <ThirdwebProvider>
      <SettlementRecoveryControls />
    </ThirdwebProvider>
  );
}
