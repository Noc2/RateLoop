"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
import { useTargetNetwork, useTransactor } from "~~/hooks/scaffold-eth";
import type { ContentFeedbackBonusPool, ContentFeedbackItem } from "~~/lib/feedback/types";
import {
  FEEDBACK_BONUS_ESCROW_ABI,
  type FeedbackBonusAsset,
  formatFeedbackBonusAmount,
  getConfiguredFeedbackBonusEscrowAddress,
  parseFeedbackBonusAmount,
} from "~~/lib/questionRewardPools";
import {
  getGasBalanceErrorMessage,
  isFreeTransactionExhaustedError,
  isInsufficientFundsError,
  isTransactionRelayAuthorizationError,
  isTransactionRelayTimeoutError,
  isUserRejectedTransactionError,
  isWalletRpcOverloadedError,
} from "~~/lib/transactionErrors";
import { notification } from "~~/utils/scaffold-eth";

type AwardFeedbackBonusModalProps = {
  item: ContentFeedbackItem;
  pools: ContentFeedbackBonusPool[];
  onAwarded?: () => void;
  onClose: () => void;
};

function formatBonusInput(value: bigint): string {
  const dollars = value / 1_000_000n;
  const micros = value % 1_000_000n;
  if (micros === 0n) return dollars.toString();
  return `${dollars.toString()}.${micros.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

function getDefaultAwardAmount(pools: ContentFeedbackBonusPool[]) {
  const firstRemaining = BigInt(pools[0]?.remainingAmount ?? 0);
  if (firstRemaining <= 0n) return "";
  const oneToken = 1_000_000n;
  return formatBonusInput(firstRemaining < oneToken ? firstRemaining : oneToken);
}

function isHexHash(value: string | null | undefined): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function formatAwardDeadline(pool: ContentFeedbackBonusPool) {
  try {
    const timestamp = BigInt(pool.awardDeadline || pool.feedbackClosesAt);
    if (timestamp <= 0n) return "award window open";
    return `award by ${new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(Number(timestamp) * 1000))}`;
  } catch {
    return "award window open";
  }
}

function getPoolLabel(pool: ContentFeedbackBonusPool) {
  return `Round ${pool.roundId} · ${formatFeedbackBonusAmount(pool.remainingAmount, getPoolAsset(pool))} left · ${formatAwardDeadline(pool)}`;
}

function getPoolAsset(pool: ContentFeedbackBonusPool): FeedbackBonusAsset {
  return pool.asset === 0 ? "lrep" : "usdc";
}

function getDefaultTransactionErrorMessage(error: unknown) {
  return (
    (error as { shortMessage?: string; message?: string } | undefined)?.shortMessage ||
    (error as { shortMessage?: string; message?: string } | undefined)?.message ||
    "Failed to award this Feedback Bonus"
  );
}

export function AwardFeedbackBonusModal({ item, pools, onAwarded, onClose }: AwardFeedbackBonusModalProps) {
  const wagmiConfig = useConfig();
  const { address, chain } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const writeTx = useTransactor();
  const { targetNetwork } = useTargetNetwork();
  const amountInputId = useId();
  const poolInputId = useId();
  const [isMounted, setIsMounted] = useState(false);
  const [selectedPoolId, setSelectedPoolId] = useState(pools[0]?.id ?? "");
  const [amount, setAmount] = useState(() => getDefaultAwardAmount(pools));
  const [isAwarding, setIsAwarding] = useState(false);

  const chainId = targetNetwork.id ?? wagmiConfig.chains[0]?.id ?? 0;
  const walletOnTargetNetwork = chain?.id === chainId;
  const escrowAddress = useMemo(() => getConfiguredFeedbackBonusEscrowAddress(chainId), [chainId]);
  const selectedPool = useMemo(
    () => pools.find(pool => pool.id === selectedPoolId) ?? pools[0] ?? null,
    [pools, selectedPoolId],
  );
  const parsedAmount = useMemo(() => parseFeedbackBonusAmount(amount), [amount]);
  const remainingAmount = selectedPool ? BigInt(selectedPool.remainingAmount) : 0n;
  const selectedAsset = selectedPool ? getPoolAsset(selectedPool) : "usdc";
  const selectedAssetLabel = selectedAsset === "lrep" ? "LREP" : "USDC";
  const frontendFee =
    parsedAmount && selectedPool ? (parsedAmount * BigInt(selectedPool.frontendFeeBps)) / 10_000n : 0n;
  const recipientAmount = parsedAmount ? parsedAmount - frontendFee : 0n;
  const feedbackHash = isHexHash(item.feedbackHash) ? item.feedbackHash : null;
  const amountError =
    parsedAmount === null
      ? `Enter a positive ${selectedAssetLabel} amount.`
      : parsedAmount > remainingAmount
        ? `This pool has ${formatFeedbackBonusAmount(remainingAmount, selectedAsset)} left.`
        : null;
  const canAward = Boolean(
    address && walletOnTargetNetwork && escrowAddress && selectedPool && feedbackHash && parsedAmount && !amountError,
  );

  useEffect(() => {
    setSelectedPoolId(pools[0]?.id ?? "");
    setAmount(getDefaultAwardAmount(pools));
  }, [pools]);

  useEffect(() => {
    setIsMounted(true);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleAward = async () => {
    if (!address) {
      notification.info("Connect the awarder wallet to pay this Feedback Bonus.");
      return;
    }
    if (!walletOnTargetNetwork) {
      notification.error(`Switch your wallet to ${targetNetwork.name} to award this Feedback Bonus.`);
      return;
    }
    if (!escrowAddress) {
      notification.error("Feedback Bonus payouts are not deployed on this network yet.");
      return;
    }
    if (!selectedPool || !feedbackHash) {
      notification.warning("This feedback cannot receive a Feedback Bonus yet.");
      return;
    }
    if (!parsedAmount || amountError) {
      notification.warning(amountError || `Enter a positive ${selectedAssetLabel} amount.`);
      return;
    }

    setIsAwarding(true);
    try {
      const hash = await writeTx(
        () =>
          writeContractAsync({
            address: escrowAddress,
            abi: FEEDBACK_BONUS_ESCROW_ABI,
            functionName: "awardFeedbackBonus",
            args: [BigInt(selectedPool.id), item.authorAddress, feedbackHash, parsedAmount],
            chainId: chainId as any,
          } as any),
        {
          action: "Award Feedback Bonus",
          suppressErrorToast: true,
          suppressSuccessToast: true,
        },
      );
      if (!hash) {
        throw new Error("Feedback Bonus award transaction was not submitted.");
      }

      notification.success(`Awarded ${formatFeedbackBonusAmount(parsedAmount, selectedAsset)} Feedback Bonus.`);
      onAwarded?.();
      onClose();
    } catch (error) {
      if (isUserRejectedTransactionError(error)) {
        notification.info("Award transaction rejected in your wallet.");
      } else if (isTransactionRelayTimeoutError(error)) {
        notification.error(
          "The wallet relay timed out before returning a transaction hash. Refresh feedback in a moment; if it is not marked Awarded, retry or use a self-funded wallet.",
          { duration: 9000 },
        );
        onAwarded?.();
      } else if (isTransactionRelayAuthorizationError(error)) {
        notification.error(
          "The wallet relay did not authorize this award. Retry once; if it repeats, use a self-funded wallet or add gas to this wallet.",
          { duration: 8000 },
        );
      } else if (isFreeTransactionExhaustedError(error) || isInsufficientFundsError(error)) {
        notification.error(getGasBalanceErrorMessage(targetNetwork.nativeCurrency.symbol));
      } else if (isWalletRpcOverloadedError(error)) {
        notification.error("The wallet RPC is overloaded. Wait a moment, then retry.");
      } else {
        notification.error(getDefaultTransactionErrorMessage(error));
      }
    } finally {
      setIsAwarding(false);
    }
  };

  if (!isMounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Award Feedback Bonus"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm"
        aria-label="Close award Feedback Bonus dialog"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[calc(100svh-1rem)] w-full max-w-md overflow-y-auto rounded-t-2xl bg-base-200 p-6 shadow-2xl sm:rounded-2xl">
        <button
          type="button"
          onClick={onClose}
          className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3 text-base-content/70 hover:text-base-content"
          aria-label="Close"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        <h3 className="mb-3 px-9 text-balance break-words text-center text-lg font-semibold leading-tight">
          Award Feedback Bonus
        </h3>
        <div className="rounded-lg bg-base-100 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50">{item.feedbackTypeLabel}</p>
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-base-content/75">
            {item.body}
          </p>
        </div>

        <div className="mt-5 grid gap-4">
          {pools.length > 1 ? (
            <label className="form-control">
              <span className="label-text pb-1">Feedback Bonus pool</span>
              <select
                id={poolInputId}
                value={selectedPool?.id ?? ""}
                onChange={event => setSelectedPoolId(event.target.value)}
                className="select select-bordered bg-base-100"
              >
                {pools.map(pool => (
                  <option key={pool.id} value={pool.id}>
                    {getPoolLabel(pool)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-lg bg-base-100 p-3 text-sm text-base-content/70">
              {selectedPool ? getPoolLabel(selectedPool) : "No awardable Feedback Bonus pool found."}
            </div>
          )}

          <label className="form-control">
            <span className="label-text pb-1">Award amount</span>
            <div
              className={`input input-bordered flex items-center gap-2 bg-base-100 ${amountError ? "input-error" : ""}`}
            >
              <input
                id={amountInputId}
                inputMode="decimal"
                value={amount}
                onChange={event => setAmount(event.target.value)}
                className="min-w-0 grow"
                placeholder="1"
              />
              <span className="text-base-content/50">{selectedAssetLabel}</span>
            </div>
            {amountError ? (
              <span className="label pt-1">
                <span className="label-text-alt text-error">{amountError}</span>
              </span>
            ) : null}
          </label>

          <div className="grid gap-2 rounded-lg bg-base-100 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-base-content/55">Recipient gets</span>
              <span className="font-semibold text-base-content">
                {formatFeedbackBonusAmount(recipientAmount, selectedAsset)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-base-content/55">Frontend fee</span>
              <span className="font-semibold text-base-content">
                {formatFeedbackBonusAmount(frontendFee, selectedAsset)}
              </span>
            </div>
          </div>

          {!escrowAddress ? (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
              Feedback Bonus payouts are not available on this network yet.
            </p>
          ) : null}
          {address && !walletOnTargetNetwork ? (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
              Switch your wallet to {targetNetwork.name} to award from this pool.
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <GradientActionButton
            onClick={handleAward}
            disabled={!canAward || isAwarding}
            motion={getGradientActionMotion(isAwarding)}
          >
            {isAwarding ? "Awarding..." : "Award Bonus"}
          </GradientActionButton>
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
