"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { eth_getTransactionByHash, getRpcClient, prepareTransaction, sendTransaction, waitForReceipt } from "thirdweb";
import { baseSepolia } from "thirdweb/chains";
import { ConnectButton, ThirdwebProvider, useActiveAccount } from "thirdweb/react";
import { Field, SelectField } from "~~/components/tokenless/forms/Field";
import { settlementRoundStatusLabel } from "~~/components/tokenless/human/humanStatePresentation";
import { Card } from "~~/components/tokenless/ui/Card";
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

async function readJson(response: Response, fallbackMessage: string) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : fallbackMessage,
    );
  }
  return body;
}

function short(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function SettlementRecoveryControls() {
  const t = useTranslations("human.settlement");
  const format = useFormatter();
  const usdc = (atomic: string) =>
    `${format.number(Number(BigInt(atomic)) / 1_000_000, { maximumFractionDigits: 6 })} USDC`;
  const deadline = (seconds: string | null) =>
    !seconds || seconds === "0"
      ? t("notOpened")
      : format.dateTime(new Date(Number(BigInt(seconds) * 1_000n)), {
          dateStyle: "medium",
          timeStyle: "short",
        });
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
              label: t("roundSource", { round: record.roundId, key: short(record.voteKey) }),
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
        setError(t("signIn"));
      }
    }
    void refreshRecoveries();
    window.addEventListener("focus", refreshRecoveries);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshRecoveries);
    };
  }, [t]);

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
        throw new Error(t("accountChanged"));
      }
      const serialized = await file.text();
      const backup = parseDeviceRecoveryBackup(serialized);
      if (backup && backup.record.principalId !== session.principalId) {
        throw new Error(t("wrongAccount"));
      }
      const source = {
        id: "uploaded",
        label: file.name,
        recoveryPackage: backup?.record.recoveryPackage ?? serialized,
        recoverySecret: backup?.recoverySecret ?? null,
      };
      setUploadedSource(source);
      setSelectedSource(source.id);
    } catch {
      setError(t("readFailed"));
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
      t("requestFailed"),
    )) as unknown as RaterSettlementSnapshot;
  }

  async function checkSettlement() {
    const allSources = uploadedSource ? [...sources, uploadedSource] : sources;
    const source = allSources.find(value => value.id === selectedSource);
    if (!source) return setError(t("choose"));
    const secret = source.recoverySecret ?? recoverySecret;
    if (secret.length < 12) return setError(t("secretRequired"));
    setBusy(true);
    setError(null);
    setStatus(t("opening"));
    try {
      const session = await readBrowserSession();
      if (!session || session.principalId !== principalId) {
        throw new Error(t("accountChanged"));
      }
      const recovered = await importTokenlessRecoveryPackage(source.recoveryPackage, secret);
      const nextSnapshot = await fetchSnapshot("reveal", recovered);
      setSecrets(recovered);
      setSnapshot(nextSnapshot);
      setStatus(t("matches"));
    } catch {
      setSecrets(null);
      setSnapshot(null);
      setStatus(null);
      setError(t("loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function execute(action: "reveal" | "claim") {
    if (!snapshot || !secrets || !account || !thirdwebBrowserClient) {
      setError(t("connectRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(t("waiting", { action: action === "reveal" ? t("reveal") : t("claim") }));
    try {
      const session = await readBrowserSession();
      if (!session || session.principalId !== principalId) {
        throw new Error(t("accountChanged"));
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
      setStatus(t("submitted", { action: action === "reveal" ? t("reveal") : t("claim") }));
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
          ? t("revealedStatus")
          : t("claimedStatus", { amount: usdc(authorization.expectedAmountAtomic!.toString(10)) }),
      );
    } catch {
      setStatus(null);
      setError(t("actionFailed", { action }));
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
    <Card as="section" className="rounded-2xl p-5" aria-labelledby="settlement-recovery-title">
      <h2 id="settlement-recovery-title" className="text-xl font-semibold">
        {t("title")}
      </h2>
      <p className="mt-2 text-sm leading-6 text-base-content/60">{t("description")}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
        <SelectField
          className="border-base-content/10 bg-[var(--rateloop-field)]"
          label={t("savedReview")}
          labelClassName="text-sm"
          value={selectedSource}
          onChange={event => {
            resetSettlement();
            setSelectedSource(event.target.value);
          }}
        >
          <option value="">{t("chooseReview")}</option>
          {allSources.map(source => (
            <option key={source.id} value={source.id}>
              {source.label}
            </option>
          ))}
        </SelectField>
        <Field
          containerClassName="rateloop-secondary-action mt-7 cursor-pointer self-start rounded-lg px-4 py-2 text-sm"
          className="sr-only"
          label={t("import")}
          labelClassName="m-0 inline text-sm font-normal text-inherit"
          type="file"
          accept="application/json,.json"
          onChange={event => void loadFile(event.target.files?.[0])}
        />
      </div>
      {needsRecoverySecret ? (
        <Field
          containerClassName="mt-3"
          className="border-base-content/10 bg-[var(--rateloop-field)]"
          label={t("recoverySecret")}
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
        {busy && !snapshot ? t("checking") : t("check")}
      </button>

      {snapshot ? (
        <Card as="div" variant="nested" className="mt-5 rounded-xl p-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-base-content/55">{t("roundStatus")}</dt>
              <dd className="mt-1 font-medium">{settlementRoundStatusLabel(snapshot.roundStatus, t)}</dd>
            </div>
            <div>
              <dt className="text-base-content/55">{t("outcome")}</dt>
              <dd className="mt-1 font-medium">
                {snapshot.claimed ? t("paid") : snapshot.revealed ? t("revealed") : t("committed")}
              </dd>
            </div>
            <div>
              <dt className="text-base-content/55">{t("earned")}</dt>
              <dd className="mt-1 font-medium">{usdc(earnedAtomic)}</dd>
            </div>
            <div>
              <dt className="text-base-content/55">{t("claimDeadline")}</dt>
              <dd className="mt-1 font-medium">{deadline(snapshot.claimDeadline)}</dd>
            </div>
            <div>
              <dt className="text-base-content/55">{t("revealDeadline")}</dt>
              <dd className="mt-1 font-medium">{deadline(snapshot.revealDeadline)}</dd>
            </div>
            <div>
              <dt className="text-base-content/55">{t("commit")}</dt>
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
              {busy
                ? t("confirming")
                : snapshot.canReveal
                  ? t("revealReview")
                  : t("claimAmount", { amount: usdc(earnedAtomic) })}
            </button>
          ) : null}
          {actionAvailable && !account && thirdwebBrowserClient ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-base-content/60">{t("relayDescription")}</p>
              <ConnectButton
                client={thirdwebBrowserClient}
                chain={baseSepolia}
                chains={[baseSepolia]}
                wallets={rateLoopThirdwebWallets}
                connectButton={{ label: t("connect") }}
                connectModal={{ showThirdwebBranding: false, size: "compact", title: t("connect") }}
              />
            </div>
          ) : null}
        </Card>
      ) : null}
      {transactionHash ? (
        <a
          className="mt-4 block text-sm text-[var(--rateloop-pink)] underline"
          href={`https://sepolia.basescan.org/tx/${transactionHash}`}
          target="_blank"
          rel="noreferrer"
        >
          {t("viewTransaction")}
        </a>
      ) : null}
      {status ? (
        <p className="mt-4 text-sm text-success" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

export function RaterSettlementRecoveryClient() {
  return (
    <ThirdwebProvider>
      <SettlementRecoveryControls />
    </ThirdwebProvider>
  );
}
