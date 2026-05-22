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
import { protocolDocFacts } from "~~/lib/docs/protocolFacts";
import {
  DEFAULT_REWARD_POOL_FRONTEND_FEE_BPS,
  ERC20_APPROVAL_ABI,
  MIN_REWARD_POOL_REQUIRED_VOTERS,
  MIN_REWARD_POOL_SETTLED_ROUNDS,
  QUESTION_REWARD_POOL_ESCROW_ABI,
  QUESTION_SUBMISSION_ABI,
  formatUsdAmount,
  getConfiguredContentRegistryAddress,
  getConfiguredQuestionRewardPoolEscrowAddress,
  getDefaultUsdcAddress,
  parseUsdRewardPoolAmount,
} from "~~/lib/questionRewardPools";
import { notification } from "~~/utils/scaffold-eth";

type FundQuestionModalProps = {
  contentId: bigint;
  title: string;
  onClose: () => void;
  onCreated?: () => void;
};

const FRONTEND_FEE_PERCENT = DEFAULT_REWARD_POOL_FRONTEND_FEE_BPS / 100;
const BOUNTY_AMOUNT_TOOLTIP = `Paid in USDC on World Chain. Qualified claims reserve ${FRONTEND_FEE_PERCENT}% for the eligible frontend operator; the rest goes to eligible revealed voters after payout roots finalize.`;
const REQUIRED_VOTERS_TOOLTIP =
  "How many eligible revealed voters a round needs before that round can count toward this bounty. This cannot exceed the question's selected voter cap.";
const SETTLED_ROUNDS_TOOLTIP = `How many qualifying settled rounds must complete before the bounty is filled. USDC payouts then wait on finalized payout roots: ${protocolDocFacts.usdcBountyPayoutMinimumDelayLabel} minimum, normally up to ${protocolDocFacts.usdcBountyPayoutHappyPathMaxDelayLabel} on the happy path.`;
const BOUNTY_WINDOW_TOOLTIP = `Bounty and paid feedback are active only inside this window. The question remains visible after the bounty closes. ${protocolDocFacts.usdcBountyPayoutTimingTooltip}`;

function BountyFieldLabel({ htmlFor, children, tooltip }: { htmlFor: string; children: ReactNode; tooltip?: string }) {
  return (
    <div className="label justify-start gap-1 px-0 py-0 pb-1">
      <label htmlFor={htmlFor} className="label-text">
        {children}
      </label>
      {tooltip ? <InfoTooltip text={tooltip} position="top" /> : null}
    </div>
  );
}

export function FundQuestionModal({ contentId, title, onClose, onCreated }: FundQuestionModalProps) {
  const wagmiConfig = useConfig();
  const { address, chain } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [isMounted, setIsMounted] = useState(false);
  const amountInputId = useId();
  const requiredVotersInputId = useId();
  const requiredRoundsInputId = useId();
  const [amount, setAmount] = useState("10");
  const [requiredVoters, setRequiredVoters] = useState("5");
  const [requiredRounds, setRequiredRounds] = useState("2");
  const [bountyWindowPreset, setBountyWindowPreset] = useState<BountyWindowPreset>(DEFAULT_BOUNTY_WINDOW_PRESET);
  const [customBountyWindowAmount, setCustomBountyWindowAmount] = useState(DEFAULT_CUSTOM_BOUNTY_WINDOW_AMOUNT);
  const [customBountyWindowUnit, setCustomBountyWindowUnit] = useState<BountyWindowUnit>(
    DEFAULT_CUSTOM_BOUNTY_WINDOW_UNIT,
  );
  const [isFunding, setIsFunding] = useState(false);

  const chainId = chain?.id ?? wagmiConfig.chains[0]?.id ?? 0;
  const contentRegistryAddress = useMemo(() => getConfiguredContentRegistryAddress(chainId), [chainId]);
  const escrowAddress = useMemo(() => getConfiguredQuestionRewardPoolEscrowAddress(chainId), [chainId]);
  const fallbackUsdcAddress = useMemo(() => getDefaultUsdcAddress(chainId), [chainId]);
  const parsedAmount = useMemo(() => parseUsdRewardPoolAmount(amount), [amount]);
  const voterCount = Math.max(MIN_REWARD_POOL_REQUIRED_VOTERS, Math.floor(Number(requiredVoters) || 0));
  const settledRounds = Math.max(MIN_REWARD_POOL_SETTLED_ROUNDS, Math.floor(Number(requiredRounds) || 0));
  const bountyWindowSeconds = getBountyWindowSeconds(
    bountyWindowPreset,
    customBountyWindowAmount,
    customBountyWindowUnit,
  );
  const bountyWindowAmount = parseBountyWindowAmount(customBountyWindowAmount);
  const hasValidBountyWindow =
    bountyWindowSeconds !== null && bountyWindowAmount >= (bountyWindowPreset === "custom" ? 1 : 0);
  const canSubmit = Boolean(
    address &&
      contentRegistryAddress &&
      escrowAddress &&
      parsedAmount &&
      voterCount >= MIN_REWARD_POOL_REQUIRED_VOTERS &&
      settledRounds >= MIN_REWARD_POOL_SETTLED_ROUNDS &&
      hasValidBountyWindow,
  );

  useEffect(() => {
    setIsMounted(true);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleFundQuestion = async () => {
    if (!address) {
      notification.error("Connect your wallet to fund this question.");
      return;
    }
    if (!escrowAddress) {
      notification.error("Bounties are not deployed on this network yet.");
      return;
    }
    if (!contentRegistryAddress) {
      notification.error("RateLoop registry is not deployed on this network yet.");
      return;
    }
    if (!parsedAmount) {
      notification.warning("Enter a positive USD amount.");
      return;
    }
    if (!hasValidBountyWindow) {
      notification.warning("Choose a bounty window.");
      return;
    }

    setIsFunding(true);
    try {
      const usdcAddress = fallbackUsdcAddress;
      try {
        const registryEscrowAddress = (await readContract(wagmiConfig, {
          address: contentRegistryAddress,
          abi: QUESTION_SUBMISSION_ABI,
          functionName: "questionRewardPoolEscrow",
        })) as `0x${string}`;
        if (registryEscrowAddress.toLowerCase() !== escrowAddress.toLowerCase()) {
          notification.error("Bounty escrow is not active for this registry.");
          return;
        }
      } catch {
        notification.error("Could not verify registry bounty escrow.");
        return;
      }

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

        // M-5 (2026-05-22 audit): re-read the allowance after waiting on the approval so
        // any concurrent spender that consumed it cannot turn the subsequent
        // createRewardPool into an opaque revert. Fail fast with a clearer message instead.
        const allowanceAfterApprove = await readUsdcAllowance();
        if (allowanceAfterApprove < parsedAmount) {
          throw new Error(
            "USDC allowance dropped below the required amount before the bounty could be funded. Please try again.",
          );
        }
      }

      const publicClient = getPublicClient(wagmiConfig, { chainId: chainId as any });
      const latestBlockTimestamp = await publicClient
        ?.getBlock({ blockTag: "latest" })
        .then(block => block.timestamp)
        .catch(() => undefined);
      const bountyClosesAt = getBountyClosesAt(
        bountyWindowPreset,
        customBountyWindowAmount,
        customBountyWindowUnit,
        resolveBountyReferenceNowSeconds(latestBlockTimestamp),
      );
      const rewardPoolHash = await writeContractAsync({
        address: escrowAddress,
        abi: QUESTION_REWARD_POOL_ESCROW_ABI,
        functionName: "createRewardPool",
        args: [contentId, parsedAmount, BigInt(voterCount), BigInt(settledRounds), bountyClosesAt, bountyClosesAt],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: rewardPoolHash });

      notification.success(`Bounty funded with ${formatUsdAmount(parsedAmount)}. Paid in USDC on World Chain.`);
      onCreated?.();
      onClose();
    } catch (error) {
      notification.error(
        (error as { shortMessage?: string; message?: string } | undefined)?.shortMessage ||
          (error as { shortMessage?: string; message?: string } | undefined)?.message ||
          "Failed to fund this question",
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
      aria-label="Fund a bounty"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm"
        aria-label="Close fund bounty dialog"
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
        <p className="mt-5 rounded-lg bg-warning/10 p-3 text-sm text-base-content/75">
          USDC claims take at least {protocolDocFacts.usdcBountyPayoutMinimumDelayLabel} after settlement, or normally
          up to {protocolDocFacts.usdcBountyPayoutHappyPathMaxDelayLabel} when both oracle layers still need to
          finalize.
        </p>

        <div className="mt-5 grid gap-4">
          <div className="form-control">
            <BountyFieldLabel htmlFor={amountInputId} tooltip={BOUNTY_AMOUNT_TOOLTIP}>
              Bounty amount
            </BountyFieldLabel>
            <div className="input input-bordered flex items-center gap-2 bg-base-100">
              <span className="text-base-content/50">$</span>
              <input
                id={amountInputId}
                inputMode="decimal"
                value={amount}
                onChange={event => setAmount(event.target.value)}
                className="grow"
                placeholder="10"
              />
              <span className="text-base-content/50">USDC</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="form-control">
              <BountyFieldLabel htmlFor={requiredVotersInputId} tooltip={REQUIRED_VOTERS_TOOLTIP}>
                Required voters
              </BountyFieldLabel>
              <input
                id={requiredVotersInputId}
                type="number"
                min={MIN_REWARD_POOL_REQUIRED_VOTERS}
                step={1}
                value={requiredVoters}
                onChange={event => setRequiredVoters(event.target.value)}
                className="input input-bordered bg-base-100"
              />
            </div>
            <div className="form-control">
              <BountyFieldLabel htmlFor={requiredRoundsInputId} tooltip={SETTLED_ROUNDS_TOOLTIP}>
                Settled rounds
              </BountyFieldLabel>
              <input
                id={requiredRoundsInputId}
                type="number"
                min={MIN_REWARD_POOL_SETTLED_ROUNDS}
                step={1}
                value={requiredRounds}
                onChange={event => setRequiredRounds(event.target.value)}
                className="input input-bordered bg-base-100"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="label justify-start gap-1 px-0 py-0 pb-1">
              <span className="label-text">Bounty window</span>
              <InfoTooltip text={BOUNTY_WINDOW_TOOLTIP} position="top" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {BOUNTY_WINDOW_PRESETS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={bountyWindowPreset === option.id}
                  onClick={() => setBountyWindowPreset(option.id)}
                  className={`btn btn-sm ${bountyWindowPreset === option.id ? "btn-primary" : "btn-outline"}`}
                >
                  {option.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={bountyWindowPreset === "custom"}
                onClick={() => setBountyWindowPreset("custom")}
                className={`btn btn-sm ${bountyWindowPreset === "custom" ? "btn-primary" : "btn-outline"}`}
              >
                Custom
              </button>
            </div>
            {bountyWindowPreset === "custom" ? (
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <label className="form-control">
                  <span className="label-text">Window length</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={customBountyWindowAmount}
                    onChange={event => setCustomBountyWindowAmount(event.target.value)}
                    className={`input input-bordered bg-base-100 ${hasValidBountyWindow ? "" : "input-error"}`}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Unit</span>
                  <select
                    value={customBountyWindowUnit}
                    onChange={event => setCustomBountyWindowUnit(event.target.value as BountyWindowUnit)}
                    className="select select-bordered bg-base-100"
                  >
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </label>
              </div>
            ) : null}
          </div>

          {!escrowAddress ? (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
              Bounty funding is not available on this network yet.
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={handleFundQuestion}
            disabled={!canSubmit || isFunding}
            className="btn btn-primary"
          >
            {isFunding ? "Funding..." : "Fund bounty"}
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
