"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentText } from "./AgentText";
import { useAgentFormatter, useAgentTranslations } from "./AgentsLocaleProvider";
import { prepareTransaction, sendTransaction } from "thirdweb";
import { baseSepolia } from "thirdweb/chains";
import { ConnectButton, ThirdwebProvider, useActiveAccount } from "thirdweb/react";
import { Field } from "~~/components/tokenless/forms/Field";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Badge } from "~~/components/tokenless/ui/Badge";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { rateLoopThirdwebWallets, thirdwebBrowserClient } from "~~/lib/thirdweb/client";
import type { FeedbackBonusAwardInboxItem } from "~~/lib/tokenless/feedbackBonusAwards";
import type { FeedbackBonusHumanWalletAuthorization } from "~~/lib/tokenless/feedbackBonusHumanWalletExecution";
import { readJson } from "~~/lib/tokenless/http";
import { formatUsdcAtomic, parseUsdcDecimal } from "~~/lib/tokenless/usdc";

export function formatFeedbackBonusUsdc(atomic: string) {
  return formatUsdcAtomic(atomic);
}

class BonusValidationError extends Error {}

function decimalToAtomic(value: string, t: (key: string) => string) {
  let result: string;
  try {
    result = parseUsdcDecimal(value);
  } catch {
    throw new BonusValidationError(t("decimalPlaces"));
  }
  if (BigInt(result) <= 0n) throw new BonusValidationError(t("greaterThanZero"));
  return result;
}

function AwardCard({ item, onAwarded }: { item: FeedbackBonusAwardInboxItem; onAwarded: () => Promise<void> }) {
  const format = useAgentFormatter();
  const errors = useAgentTranslations("errors");
  const copy = useAgentTranslations("bonusInbox");
  const account = useActiveAccount();
  const [amount, setAmount] = useState(() => {
    const remaining = BigInt(item.remainingPoolAtomic);
    return formatFeedbackBonusUsdc(remaining < 1_000_000n ? remaining.toString() : "1000000").replace(" USDC", "");
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTransactionHash, setPendingTransactionHash] = useState<string | null>(null);

  async function award() {
    setBusy(true);
    setError(null);
    try {
      const amountAtomic = decimalToAtomic(amount, copy);
      if (BigInt(amountAtomic) > BigInt(item.remainingPoolAtomic)) {
        throw new BonusValidationError(
          copy("poolRemaining", { amount: formatFeedbackBonusUsdc(item.remainingPoolAtomic) }),
        );
      }
      const idempotencyKey = `feedback-bonus:${item.opportunityId}:${item.feedbackId}`;
      const endpoint = `/api/account/workspaces/${encodeURIComponent(
        item.workspaceId,
      )}/feedback-bonus/${encodeURIComponent(item.feedbackId)}`;
      const prepared = await readJson(
        await fetch(endpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amountAtomic, idempotencyKey }),
        }),
      );
      if (prepared.status === "confirmed") {
        await onAwarded();
        return;
      }
      if (!account || !thirdwebBrowserClient) throw new BonusValidationError(copy("connectFirst"));
      if (prepared.status !== "human_wallet_required") {
        throw new BonusValidationError(copy("authorizationMissing"));
      }
      const authorization = prepared.authorization as FeedbackBonusHumanWalletAuthorization;
      if (account.address.toLowerCase() !== authorization.awarderAddress.toLowerCase()) {
        throw new BonusValidationError(copy("designatedWallet", { address: authorization.awarderAddress }));
      }
      if (authorization.chainId !== baseSepolia.id) throw new BonusValidationError(copy("unsupportedChain"));
      const transactionHash =
        pendingTransactionHash ??
        (
          await sendTransaction({
            account,
            transaction: prepareTransaction({
              client: thirdwebBrowserClient,
              chain: baseSepolia,
              to: authorization.contractAddress,
              data: authorization.transactionData,
            }),
          })
        ).transactionHash;
      setPendingTransactionHash(transactionHash);
      await readJson(
        await fetch(endpoint, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amountAtomic, idempotencyKey, transactionHash }),
        }),
      );
      setPendingTransactionHash(null);
      await onAwarded();
    } catch (cause) {
      setError(cause instanceof BonusValidationError ? cause.message : errors("awardFeedback"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="article" className="rounded-2xl p-5" aria-labelledby={`feedback-bonus-${item.feedbackId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--rateloop-pink)]">
            <AgentText id="feedbackBonus" />
          </p>
          <h3 id={`feedback-bonus-${item.feedbackId}`} className="mt-1 font-semibold">
            <AgentText id="translated170" />
          </h3>
        </div>
        <Badge>
          {formatFeedbackBonusUsdc(item.remainingPoolAtomic)} <AgentText id="translated171" />
        </Badge>
      </div>
      <blockquote className="mt-4 whitespace-pre-wrap rounded-xl border border-base-content/10 bg-base-content/[0.02] p-4 text-sm leading-6 text-base-content/75">
        {item.feedbackBody}
      </blockquote>
      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field
          className="border-base-content/10 bg-[var(--rateloop-field)]"
          label={<AgentText id="attribute020" />}
          labelClassName="text-sm"
          inputMode="decimal"
          value={amount}
          onChange={event => setAmount(event.target.value)}
        />
        <Button type="button" disabled={busy} onClick={() => void award()}>
          {busy ? <AgentText id="dynamic036" /> : <AgentText id="dynamic035" />}
        </Button>
      </div>
      <p className="mt-3 text-xs text-base-content/55">
        <AgentText id="translated172" />{" "}
        {format.dateTime(new Date(item.awardDeadline), { dateStyle: "medium", timeStyle: "short" })}
        <AgentText id="translated173" />
      </p>
      {error ? (
        <p className="mt-3 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

function FeedbackBonusAwardInboxControls({ workspaceId }: { workspaceId: string }) {
  const errors = useAgentTranslations("errors");
  const copy = useAgentTranslations("bonusInbox");
  const account = useActiveAccount();
  const [items, setItems] = useState<FeedbackBonusAwardInboxItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/feedback-bonus`, {
          cache: "no-store",
          credentials: "same-origin",
        }),
      );
      setItems((body.items ?? []) as FeedbackBonusAwardInboxItem[]);
      setError(null);
    } catch {
      setError(errors("loadBonuses"));
    } finally {
      setLoaded(true);
    }
  }, [errors, workspaceId]);

  useEffect(() => void load(), [load]);

  return (
    <section className="space-y-4" aria-labelledby="feedback-bonus-award-inbox-title">
      <div>
        <h2 id="feedback-bonus-award-inbox-title" className="text-2xl font-semibold">
          <AgentText id="translated174" />
        </h2>
        <p className="mt-2 text-sm text-base-content/55">
          <AgentText id="translated175" />
        </p>
      </div>
      {!account && thirdwebBrowserClient ? (
        <Card className="flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4">
          <p className="text-sm text-base-content/60">
            <AgentText id="connectAwarder" />
          </p>
          <ConnectButton
            client={thirdwebBrowserClient}
            chain={baseSepolia}
            chains={[baseSepolia]}
            wallets={rateLoopThirdwebWallets}
            connectButton={{ label: copy("connectButton") }}
            connectModal={{ showThirdwebBranding: false, size: "compact", title: copy("connectTitle") }}
          />
        </Card>
      ) : null}
      <AsyncSection
        loading={!loaded}
        loadingLabel={copy("loading")}
        error={error}
        empty={items.length === 0}
        emptyTitle={copy("empty")}
      >
        {items.map(item => (
          <AwardCard key={`${item.opportunityId}:${item.feedbackId}`} item={item} onAwarded={load} />
        ))}
      </AsyncSection>
    </section>
  );
}

export function FeedbackBonusAwardInbox({ workspaceId }: { workspaceId: string }) {
  if (!thirdwebBrowserClient) return null;
  return (
    <ThirdwebProvider>
      <FeedbackBonusAwardInboxControls workspaceId={workspaceId} />
    </ThirdwebProvider>
  );
}
