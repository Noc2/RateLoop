"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { eth_getTransactionByHash, getRpcClient, prepareTransaction, sendTransaction, waitForReceipt } from "thirdweb";
import { baseSepolia } from "thirdweb/chains";
import { ConnectButton, ThirdwebProvider, useActiveAccount } from "thirdweb/react";
import { Field, SelectField } from "~~/components/tokenless/forms/Field";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
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

async function readJson(response: Response, fallbackMessage: string) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : fallbackMessage,
    );
  }
  return body;
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function FeedbackBonusClaimsControls() {
  const t = useTranslations("human.bonus");
  const format = useFormatter();
  const usdc = (atomic: string) =>
    `${format.number(Number(BigInt(atomic)) / 1_000_000, { maximumFractionDigits: 6 })} USDC`;
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
              label: t("roundDevice", { round: record.roundId }),
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
        setError(t("signIn"));
      }
    }
    void refreshPrincipalRecoveries();
    window.addEventListener("focus", refreshPrincipalRecoveries);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshPrincipalRecoveries);
    };
  }, [t]);

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
        throw new Error(t("accountChanged"));
      }
      const serialized = await file.text();
      const backup = parseDeviceRecoveryBackup(serialized);
      if (backup && backup.record.principalId !== session.principalId) {
        throw new Error(t("wrongAccount"));
      }
      const source: RecoverySource = {
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

  async function checkEntitlements() {
    const source =
      selectedSource === uploadedSource?.id ? uploadedSource : sources.find(value => value.id === selectedSource);
    if (!source) {
      setError(t("choose"));
      return;
    }
    const secret = source.recoverySecret ?? recoverySecret;
    if (secret.length < 12) {
      setError(t("secretRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(t("opening"));
    try {
      const session = await readBrowserSession();
      if (!session || session.principalId !== principalId) {
        throw new Error(t("accountChanged"));
      }
      const recovered = await importTokenlessRecoveryPackage(source.recoveryPackage, secret);
      const response = await readJson(
        await fetch(
          `/api/rater/feedback-bonus-entitlements?roundId=${encodeURIComponent(
            recovered.reveal.roundId.toString(10),
          )}&voteKey=${encodeURIComponent(recovered.reveal.voteKey)}`,
          { cache: "no-store", credentials: "same-origin" },
        ),
        t("requestFailed"),
      );
      const entitlements = (Array.isArray(response.items) ? response.items : []) as PublicFeedbackBonusEntitlement[];
      for (const entitlement of entitlements) assertFeedbackBonusEntitlementForRecovery(entitlement, recovered);
      setSecrets(recovered);
      setItems(entitlements);
      setStatus(entitlements.length ? t("matches") : t("notRegistered"));
    } catch {
      setSecrets(null);
      setItems([]);
      setStatus(null);
      setError(t("checkFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function claim(entitlement: PublicFeedbackBonusEntitlement) {
    if (!secrets || !account || !thirdwebBrowserClient) {
      setError(t("connectRequired"));
      return;
    }
    setClaimingPoolId(entitlement.poolId);
    setError(null);
    setStatus(t("waiting"));
    try {
      const session = await readBrowserSession();
      if (!session || session.principalId !== principalId) {
        throw new Error(t("accountChanged"));
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
      setStatus(t("submitted"));
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
      setStatus(t("claimedTo", { amount: usdc(entitlement.awardAmountAtomic) }));
    } catch {
      setStatus(null);
      setError(t("claimFailed"));
    } finally {
      setClaimingPoolId(null);
    }
  }

  const allSources = uploadedSource ? [...sources, uploadedSource] : sources;
  const activeSource = allSources.find(source => source.id === selectedSource);
  const needsRecoverySecret = Boolean(activeSource && !activeSource.recoverySecret);
  const claimable = items.some(item => item.awarded && !item.claimed);

  return (
    <Card as="section" className="rounded-2xl p-5" aria-labelledby="feedback-bonus-claims-title">
      <h2 id="feedback-bonus-claims-title" className="text-xl font-semibold">
        {t("title")}
      </h2>
      <SelectField
        containerClassName="mt-4"
        className="border-base-content/10 bg-[var(--rateloop-field)]"
        label={t("savedReview")}
        labelClassName="text-sm"
        value={selectedSource}
        onChange={event => {
          resetEvidence();
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
      {activeSource ? <p className="mt-3 text-sm leading-6 text-base-content/60">{t("privacy")}</p> : null}
      {needsRecoverySecret ? (
        <div className="mt-3 rounded-lg border border-base-content/10 p-3 text-sm text-base-content/60">
          <Field
            className="input-sm border-base-content/10 bg-[var(--rateloop-field)]"
            label={t("recoverySecret")}
            labelClassName="text-xs"
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
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Field
          containerClassName="rateloop-secondary-surface cursor-pointer rounded-lg px-4 py-2 text-sm"
          className="sr-only"
          label={t("import")}
          labelClassName="m-0 inline text-sm font-normal text-inherit"
          type="file"
          accept="application/json,.json"
          onChange={event => void loadFile(event.target.files?.[0])}
        />
        <Button
          variant="primary"
          size="none"
          className="px-4 text-sm"
          type="button"
          disabled={busy || !selectedSource || (needsRecoverySecret && recoverySecret.length < 12)}
          onClick={() => void checkEntitlements()}
        >
          {busy ? t("checking") : t("check")}
        </Button>
      </div>
      {items.length ? (
        <div className="mt-5 space-y-3">
          {items.map(item => (
            <Card as="article" variant="nested" key={`${item.poolId}:${item.feedbackId}`} className="rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{item.awarded ? usdc(item.awardAmountAtomic) : t("awaiting")}</p>
                  <p className="mt-1 font-mono text-xs text-base-content/55">
                    {t("poolVote", { pool: item.poolId, key: shortAddress(item.voteKey) })}
                  </p>
                </div>
                {item.claimed ? (
                  <span className="rounded-md bg-success/10 px-3 py-1 text-xs text-success">{t("claimed")}</span>
                ) : item.awarded ? (
                  <Button
                    variant="primary"
                    size="none"
                    className="px-4 text-sm"
                    type="button"
                    disabled={!account || claimingPoolId === item.poolId}
                    onClick={() => void claim(item)}
                  >
                    {claimingPoolId === item.poolId ? t("claiming") : t("claim")}
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      ) : null}
      {claimable && !account && thirdwebBrowserClient ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-base-content/10 p-4">
          <p className="text-sm text-base-content/60">{t("connectDescription")}</p>
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

export function FeedbackBonusClaimsClient() {
  return (
    <ThirdwebProvider>
      <FeedbackBonusClaimsControls />
    </ThirdwebProvider>
  );
}
