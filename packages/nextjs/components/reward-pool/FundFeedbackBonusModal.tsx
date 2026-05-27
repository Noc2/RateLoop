"use client";

import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { getPublicClient, readContract, waitForTransactionReceipt } from "wagmi/actions";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import {
  BOUNTY_WINDOW_PRESETS,
  type BountyWindowPreset,
  type BountyWindowUnit,
  DEFAULT_BOUNTY_WINDOW_PRESET,
  DEFAULT_CUSTOM_BOUNTY_WINDOW_AMOUNT,
  DEFAULT_CUSTOM_BOUNTY_WINDOW_UNIT,
  getBountyClosesAt,
  getBountyWindowSeconds,
  parseBountyWindowAmount,
  resolveBountyReferenceNowSeconds,
} from "~~/lib/bountyWindows";
import {
  DEFAULT_REWARD_POOL_FRONTEND_FEE_BPS,
  ERC20_APPROVAL_ABI,
  FEEDBACK_BONUS_ESCROW_ABI,
  formatUsdAmount,
  getConfiguredFeedbackBonusEscrowAddress,
  getDefaultUsdcAddress,
  parseUsdRewardPoolAmount,
} from "~~/lib/questionRewardPools";
import { notification } from "~~/utils/scaffold-eth";

type FundFeedbackBonusModalProps = {
  contentId: bigint;
  roundId: bigint;
  title: string;
  onClose: () => void;
  onCreated?: () => void;
};

const FRONTEND_FEE_PERCENT = DEFAULT_REWARD_POOL_FRONTEND_FEE_BPS / 100;
const FEEDBACK_BONUS_AMOUNT_TOOLTIP = `Paid in USDC on World Chain. Awarded feedback reserves ${FRONTEND_FEE_PERCENT}% for the eligible frontend operator; the rest goes to selected revealed raters after settlement.`;
const FEEDBACK_WINDOW_TOOLTIP =
  "Feedback can earn this bonus only inside the selected window. The bonus is attached to the current active round.";

function FeedbackBonusFieldLabel({
  htmlFor,
  children,
  tooltip,
}: {
  htmlFor: string;
  children: ReactNode;
  tooltip?: string;
}) {
  return (
    <div className="label justify-start gap-1 px-0 py-0 pb-1">
      <label htmlFor={htmlFor} className="label-text">
        {children}
      </label>
      {tooltip ? <InfoTooltip text={tooltip} position="top" /> : null}
    </div>
  );
}

export function FundFeedbackBonusModal({ contentId, roundId, title, onClose, onCreated }: FundFeedbackBonusModalProps) {
  const wagmiConfig = useConfig();
  const { address, chain } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [isMounted, setIsMounted] = useState(false);
  const amountInputId = useId();
  const [amount, setAmount] = useState("2");
  const [feedbackWindowPreset, setFeedbackWindowPreset] = useState<BountyWindowPreset>(DEFAULT_BOUNTY_WINDOW_PRESET);
  const [customFeedbackWindowAmount, setCustomFeedbackWindowAmount] = useState(DEFAULT_CUSTOM_BOUNTY_WINDOW_AMOUNT);
  const [customFeedbackWindowUnit, setCustomFeedbackWindowUnit] = useState<BountyWindowUnit>(
    DEFAULT_CUSTOM_BOUNTY_WINDOW_UNIT,
  );
  const [isFunding, setIsFunding] = useState(false);

  const chainId = chain?.id ?? wagmiConfig.chains[0]?.id ?? 0;
  const escrowAddress = useMemo(() => getConfiguredFeedbackBonusEscrowAddress(chainId), [chainId]);
  const fallbackUsdcAddress = useMemo(() => getDefaultUsdcAddress(chainId), [chainId]);
  const parsedAmount = useMemo(() => parseUsdRewardPoolAmount(amount), [amount]);
  const feedbackWindowSeconds = getBountyWindowSeconds(
    feedbackWindowPreset,
    customFeedbackWindowAmount,
    customFeedbackWindowUnit,
  );
  const feedbackWindowAmount = parseBountyWindowAmount(customFeedbackWindowAmount);
  const hasValidFeedbackWindow =
    feedbackWindowSeconds !== null && feedbackWindowAmount >= (feedbackWindowPreset === "custom" ? 1 : 0);
  const hasActiveRound = roundId > 0n;
  const canSubmit = Boolean(address && escrowAddress && parsedAmount && hasActiveRound && hasValidFeedbackWindow);

  useEffect(() => {
    setIsMounted(true);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleFundFeedbackBonus = async () => {
    if (!address) {
      notification.error("Connect your wallet to fund a Feedback Bonus.");
      return;
    }
    if (!escrowAddress) {
      notification.error("Feedback Bonus funding is not deployed on this network yet.");
      return;
    }
    if (!hasActiveRound) {
      notification.warning("Feedback Bonuses can be added only while a question has an active round.");
      return;
    }
    if (!parsedAmount) {
      notification.warning("Enter a positive USD amount.");
      return;
    }
    if (!hasValidFeedbackWindow) {
      notification.warning("Choose a feedback window.");
      return;
    }

    setIsFunding(true);
    try {
      const usdcAddress = fallbackUsdcAddress;
      if (!usdcAddress) {
        notification.error("World Chain USDC is not configured for this network.");
        return;
      }

      const readUsdcAllowance = async () =>
        (await readContract(wagmiConfig, {
          address: usdcAddress,
          abi: ERC20_APPROVAL_ABI,
          functionName: "allowance",
          args: [address, escrowAddress],
        })) as bigint;

      const initialAllowance = await readUsdcAllowance();

      if (initialAllowance < parsedAmount) {
        const approveHash = await writeContractAsync({
          address: usdcAddress,
          abi: ERC20_APPROVAL_ABI,
          functionName: "approve",
          args: [escrowAddress, parsedAmount],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });

        const allowanceAfterApprove = await readUsdcAllowance();
        if (allowanceAfterApprove < parsedAmount) {
          throw new Error(
            "USDC allowance dropped below the required amount before the Feedback Bonus could be funded. Please try again.",
          );
        }
      }

      const publicClient = getPublicClient(wagmiConfig, { chainId: chainId as any });
      const latestBlockTimestamp = await publicClient
        ?.getBlock({ blockTag: "latest" })
        .then(block => block.timestamp)
        .catch(() => undefined);
      const feedbackClosesAt = getBountyClosesAt(
        feedbackWindowPreset,
        customFeedbackWindowAmount,
        customFeedbackWindowUnit,
        resolveBountyReferenceNowSeconds(latestBlockTimestamp),
      );
      const feedbackBonusHash = await writeContractAsync({
        address: escrowAddress,
        abi: FEEDBACK_BONUS_ESCROW_ABI,
        functionName: "createFeedbackBonusPool",
        args: [contentId, roundId, parsedAmount, feedbackClosesAt, address],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: feedbackBonusHash });

      notification.success(`Feedback Bonus funded with ${formatUsdAmount(parsedAmount)}. Paid in USDC on World Chain.`);
      onCreated?.();
      onClose();
    } catch (error) {
      notification.error(
        (error as { shortMessage?: string; message?: string } | undefined)?.shortMessage ||
          (error as { shortMessage?: string; message?: string } | undefined)?.message ||
          "Failed to fund this Feedback Bonus",
      );
    } finally {
      setIsFunding(false);
    }
  };

  if (!isMounted) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Fund a Feedback Bonus"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm"
        aria-label="Close fund Feedback Bonus dialog"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[calc(100svh-1rem)] w-full max-w-md overflow-y-auto rounded-t-2xl bg-base-200 p-6 shadow-2xl sm:max-w-lg sm:rounded-2xl">
        <button
          type="button"
          onClick={onClose}
          className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3 text-base-content/70 hover:text-base-content"
          aria-label="Close"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        <h3 className="mb-3 px-9 text-balance break-words text-center text-lg font-semibold leading-tight">{title}</h3>
        <p className="mt-5 rounded-lg bg-info/10 p-3 text-sm text-base-content/75">
          Feedback Bonuses reward useful written feedback from revealed raters after this round settles.
        </p>

        <div className="mt-5 grid gap-4">
          <div className="form-control">
            <FeedbackBonusFieldLabel htmlFor={amountInputId} tooltip={FEEDBACK_BONUS_AMOUNT_TOOLTIP}>
              Feedback Bonus amount
            </FeedbackBonusFieldLabel>
            <div className="input input-bordered flex items-center gap-2 bg-base-100">
              <span className="text-base-content/50">$</span>
              <input
                id={amountInputId}
                inputMode="decimal"
                value={amount}
                onChange={event => setAmount(event.target.value)}
                className="grow"
                placeholder="2"
              />
              <span className="text-base-content/50">USDC</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="label justify-start gap-1 px-0 py-0 pb-1">
              <span className="label-text">Feedback window</span>
              <InfoTooltip text={FEEDBACK_WINDOW_TOOLTIP} position="top" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {BOUNTY_WINDOW_PRESETS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={feedbackWindowPreset === option.id}
                  onClick={() => setFeedbackWindowPreset(option.id)}
                  className={`btn btn-sm ${feedbackWindowPreset === option.id ? "btn-primary" : "btn-outline"}`}
                >
                  {option.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={feedbackWindowPreset === "custom"}
                onClick={() => setFeedbackWindowPreset("custom")}
                className={`btn btn-sm ${feedbackWindowPreset === "custom" ? "btn-primary" : "btn-outline"}`}
              >
                Custom
              </button>
            </div>
            {feedbackWindowPreset === "custom" ? (
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <label className="form-control">
                  <span className="label-text">Window length</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={customFeedbackWindowAmount}
                    onChange={event => setCustomFeedbackWindowAmount(event.target.value)}
                    className={`input input-bordered bg-base-100 ${hasValidFeedbackWindow ? "" : "input-error"}`}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Unit</span>
                  <select
                    value={customFeedbackWindowUnit}
                    onChange={event => setCustomFeedbackWindowUnit(event.target.value as BountyWindowUnit)}
                    className="select select-bordered bg-base-100"
                  >
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </label>
              </div>
            ) : null}
          </div>

          {!hasActiveRound ? (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
              Feedback Bonuses can be added only while this question has an active round.
            </p>
          ) : null}
          {!escrowAddress ? (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
              Feedback Bonus funding is not available on this network yet.
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={handleFundFeedbackBonus}
            disabled={!canSubmit || isFunding}
            className="btn btn-primary"
          >
            {isFunding ? "Funding..." : "Fund Feedback Bonus"}
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
