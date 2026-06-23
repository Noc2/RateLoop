"use client";

import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { isAddress } from "viem";
import { useAccount, useConfig, useSignTypedData, useWriteContract } from "wagmi";
import { getPublicClient, readContract, waitForTransactionReceipt } from "wagmi/actions";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import { useRateLoopSwitchNetwork } from "~~/hooks/useRateLoopSwitchNetwork";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useWalletTransactionReadiness } from "~~/hooks/useWalletTransactionReadiness";
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
import { hasFeedbackBonusPoolCreatedPostcondition } from "~~/lib/feedback/postconditions";
import {
  DEFAULT_REWARD_POOL_FRONTEND_FEE_BPS,
  ERC20_APPROVAL_ABI,
  FEEDBACK_BONUS_ASSET_LREP,
  FEEDBACK_BONUS_ASSET_USDC,
  FEEDBACK_BONUS_ESCROW_ABI,
  type FeedbackBonusAsset,
  formatFeedbackBonusAmount,
  getConfiguredFeedbackBonusEscrowAddress,
  getDefaultLrepAddress,
  getDefaultUsdcAddress,
  parseFeedbackBonusAmount,
} from "~~/lib/questionRewardPools";
import { isUserRejectedTransactionError } from "~~/lib/transactionErrors";
import { raceTransactionWithPostcondition, waitForTransactionPostcondition } from "~~/lib/transactions/postcondition";
import {
  buildUsdcReceiveWithAuthorizationTypedData,
  getDefaultSignatureDeadline,
  getSignatureParts,
} from "~~/lib/walletSignatures";
import scaffoldConfig from "~~/scaffold.config";
import { getTargetNetworks, notification } from "~~/utils/scaffold-eth";
import { isSignatureRejected } from "~~/utils/signatureErrors";

type FundFeedbackBonusModalProps = {
  contentChainId?: number | null;
  contentId: bigint;
  roundId: bigint;
  title: string;
  onClose: () => void;
  onCreated?: () => void;
};

const FRONTEND_FEE_PERCENT = DEFAULT_REWARD_POOL_FRONTEND_FEE_BPS / 100;
const FEEDBACK_BONUS_AMOUNT_TOOLTIP = `Paid in LREP or USDC on the active network. Awarded feedback reserves ${FRONTEND_FEE_PERCENT}% for the eligible frontend operator; the rest goes to selected revealed raters after settlement.`;
const FEEDBACK_WINDOW_TOOLTIP =
  "Sets the requested feedback close for this active round. Awarders still get at least 24 hours after the round settles to decide payouts.";

function getFundReceiptPollingInterval(chainId: number) {
  return getTransactionReceiptPollingInterval(chainId, {
    preconfirmation: scaffoldConfig.useBasePreconfRpc,
  });
}

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

export function FundFeedbackBonusModal({
  contentChainId,
  contentId,
  roundId,
  title,
  onClose,
  onCreated,
}: FundFeedbackBonusModalProps) {
  const wagmiConfig = useConfig();
  const { address, chain } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchToChain, switchingChainId } = useRateLoopSwitchNetwork();
  const {
    canUseSelfFundedBatchCalls,
    canUseSponsoredBatchCalls,
    executeContractCallBatch,
    isAwaitingSelfFundedBatchCalls,
    isAwaitingSponsoredBatchCalls,
  } = useThirdwebSponsoredSubmitCalls();
  const [isMounted, setIsMounted] = useState(false);
  const amountInputId = useId();
  const awarderInputId = useId();
  const [amount, setAmount] = useState("2");
  const [asset, setAsset] = useState<FeedbackBonusAsset>("usdc");
  const [awarderAddress, setAwarderAddress] = useState("");
  const [awarderTouched, setAwarderTouched] = useState(false);
  const [feedbackWindowPreset, setFeedbackWindowPreset] = useState<BountyWindowPreset>(DEFAULT_BOUNTY_WINDOW_PRESET);
  const [customFeedbackWindowAmount, setCustomFeedbackWindowAmount] = useState(DEFAULT_CUSTOM_BOUNTY_WINDOW_AMOUNT);
  const [customFeedbackWindowUnit, setCustomFeedbackWindowUnit] = useState<BountyWindowUnit>(
    DEFAULT_CUSTOM_BOUNTY_WINDOW_UNIT,
  );
  const [isFunding, setIsFunding] = useState(false);

  const chainId = contentChainId ?? chain?.id ?? wagmiConfig.chains[0]?.id ?? 0;
  const targetChain = useMemo(() => getTargetNetworks().find(network => network.id === chainId), [chainId]);
  const targetChainName = targetChain?.name ?? `chain ${chainId}`;
  const walletTransactionReadiness = useWalletTransactionReadiness({
    includeExternalSendCalls: true,
    isAwaitingSelfFundedWallet: isAwaitingSelfFundedBatchCalls,
    isAwaitingSponsoredWallet: isAwaitingSponsoredBatchCalls,
    targetChainId: chainId,
    targetChainName,
  });
  const isWrongFundingChain = Boolean(address && chainId && chain?.id !== chainId);
  const escrowAddress = useMemo(() => getConfiguredFeedbackBonusEscrowAddress(chainId), [chainId]);
  const fallbackUsdcAddress = useMemo(() => getDefaultUsdcAddress(chainId), [chainId]);
  const fallbackLrepAddress = useMemo(() => getDefaultLrepAddress(chainId), [chainId]);
  const parsedAmount = useMemo(() => parseFeedbackBonusAmount(amount), [amount]);
  const selectedTokenAddress = asset === "lrep" ? fallbackLrepAddress : fallbackUsdcAddress;
  const selectedAssetId = asset === "lrep" ? FEEDBACK_BONUS_ASSET_LREP : FEEDBACK_BONUS_ASSET_USDC;
  const selectedAssetLabel = asset === "lrep" ? "LREP" : "USDC";
  const trimmedAwarderAddress = awarderAddress.trim();
  const selectedAwarderAddress = trimmedAwarderAddress
    ? isAddress(trimmedAwarderAddress)
      ? (trimmedAwarderAddress as `0x${string}`)
      : undefined
    : address;
  const awarderError = selectedAwarderAddress
    ? null
    : trimmedAwarderAddress
      ? "Enter a valid EVM address for the awarder."
      : "Connect a wallet or enter an awarder address.";
  const feedbackWindowSeconds = getBountyWindowSeconds(
    feedbackWindowPreset,
    customFeedbackWindowAmount,
    customFeedbackWindowUnit,
  );
  const feedbackWindowAmount = parseBountyWindowAmount(customFeedbackWindowAmount);
  const hasValidFeedbackWindow =
    feedbackWindowSeconds !== null && feedbackWindowAmount >= (feedbackWindowPreset === "custom" ? 1 : 0);
  const hasActiveRound = roundId > 0n;
  const canSubmit = Boolean(
    address &&
      escrowAddress &&
      selectedTokenAddress &&
      parsedAmount &&
      selectedAwarderAddress &&
      hasActiveRound &&
      hasValidFeedbackWindow &&
      !isWrongFundingChain &&
      !walletTransactionReadiness.isBlocked,
  );

  useEffect(() => {
    if (awarderTouched) return;
    setAwarderAddress(address ?? "");
  }, [address, awarderTouched]);

  useEffect(() => {
    setIsMounted(true);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleFundFeedbackBonus = async () => {
    if (walletTransactionReadiness.isBlocked && walletTransactionReadiness.status !== "disconnected") {
      const message = walletTransactionReadiness.message ?? "Wallet is unavailable.";
      if (walletTransactionReadiness.isPending) {
        notification.info(message);
      } else {
        notification.error(message);
      }
      return;
    }
    if (!address) {
      notification.error("Connect your wallet to fund a Feedback Bonus.");
      return;
    }
    if (isWrongFundingChain) {
      notification.error(`Switch your wallet to ${targetChainName} before funding this Feedback Bonus.`);
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
      notification.warning(`Enter a positive ${selectedAssetLabel} amount.`);
      return;
    }
    if (!hasValidFeedbackWindow) {
      notification.warning("Choose a feedback window.");
      return;
    }
    if (!selectedAwarderAddress) {
      notification.warning("Enter a valid awarder address.");
      return;
    }

    setIsFunding(true);
    try {
      const tokenAddress = selectedTokenAddress;
      if (!tokenAddress) {
        notification.error(`${selectedAssetLabel} funding is not configured for this network.`);
        return;
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

      const canUseBatchFunding = canUseSponsoredBatchCalls || canUseSelfFundedBatchCalls;
      const startPoolId =
        canUseBatchFunding && publicClient
          ? await publicClient
              .readContract({
                address: escrowAddress,
                abi: FEEDBACK_BONUS_ESCROW_ABI,
                functionName: "nextFeedbackBonusPoolId",
              } as never)
              .then(value => (typeof value === "bigint" ? value : null))
              .catch(() => null)
          : null;
      const executeFeedbackBonusFundingBatch = async (
        calls: Parameters<typeof executeContractCallBatch>[0],
        options: Parameters<typeof executeContractCallBatch>[1],
      ) => {
        if (!publicClient || startPoolId === null) {
          return executeContractCallBatch(calls, options);
        }

        return raceTransactionWithPostcondition({
          onPostconditionSuccessThenTransactionError: error => {
            console.warn("[feedback-bonus] fund postcondition succeeded before thirdweb status settled.", {
              contentId: contentId.toString(),
              error,
              roundId: roundId.toString(),
            });
          },
          transaction: () =>
            executeContractCallBatch(calls, {
              ...options,
              suppressStatusToast: true,
            }),
          waitForPostcondition: shouldStop =>
            waitForTransactionPostcondition(
              () =>
                hasFeedbackBonusPoolCreatedPostcondition({
                  amount: parsedAmount,
                  asset: selectedAssetId,
                  awarder: selectedAwarderAddress,
                  client: publicClient,
                  contentId,
                  escrowAddress,
                  feedbackClosesAt,
                  funder: address,
                  roundId,
                  startPoolId,
                }),
              "feedback-bonus-fund-postcondition",
              {
                pollingIntervalMs: getFundReceiptPollingInterval(chainId),
                shouldStop,
              },
            ),
        });
      };

      if (asset === "usdc") {
        const authorizationParams = {
          amount: parsedAmount,
          awarder: selectedAwarderAddress,
          contentId,
          feedbackClosesAt,
          roundId,
        } as const;
        let authorizationHash: `0x${string}` | undefined;
        try {
          const validAfter = 0n;
          const validBefore = getDefaultSignatureDeadline();
          const nonce = (await readContract(wagmiConfig, {
            chainId: chainId as any,
            address: escrowAddress,
            abi: FEEDBACK_BONUS_ESCROW_ABI,
            functionName: "computeFeedbackBonusAuthorizationNonce",
            args: [authorizationParams, address, validAfter, validBefore],
          })) as `0x${string}`;
          const signature = await signTypedDataAsync(
            buildUsdcReceiveWithAuthorizationTypedData({
              authorization: {
                from: address,
                nonce,
                to: escrowAddress,
                validAfter,
                validBefore,
                value: parsedAmount,
              },
              chainId,
              tokenAddress,
            }),
          );
          const signatureParts = getSignatureParts(signature);
          const authorizationCall = {
            address: escrowAddress,
            abi: FEEDBACK_BONUS_ESCROW_ABI,
            functionName: "createFeedbackBonusPoolWithAuthorization",
            args: [
              authorizationParams,
              {
                from: address,
                nonce,
                to: escrowAddress,
                validAfter,
                validBefore,
                value: parsedAmount,
                ...signatureParts,
              },
            ],
          } as const;

          if (canUseBatchFunding) {
            await executeFeedbackBonusFundingBatch([authorizationCall], {
              action: "Fund Feedback Bonus",
              atomicRequired: false,
              sponsorshipMode: canUseSponsoredBatchCalls ? "sponsored" : "self-funded",
            });
          } else {
            authorizationHash = await writeContractAsync({
              chainId: chainId as any,
              ...authorizationCall,
            });
            await waitForTransactionReceipt(wagmiConfig, {
              chainId: chainId as any,
              hash: authorizationHash,
              pollingInterval: getFundReceiptPollingInterval(chainId),
            });
          }

          notification.success(`Feedback Bonus funded with ${formatFeedbackBonusAmount(parsedAmount, asset)}.`);
          onCreated?.();
          onClose();
          return;
        } catch (authorizationError) {
          if (authorizationHash) throw authorizationError;
          if (isSignatureRejected(authorizationError) || isUserRejectedTransactionError(authorizationError)) {
            notification.info("USDC authorization rejected in your wallet.", { duration: 6000 });
            return;
          }
          console.warn("USDC authorization unavailable; falling back to approve + fund.", authorizationError);
        }
      }

      const readTokenAllowance = async () =>
        (await readContract(wagmiConfig, {
          chainId: chainId as any,
          address: tokenAddress,
          abi: ERC20_APPROVAL_ABI,
          functionName: "allowance",
          args: [address, escrowAddress],
        })) as bigint;

      const initialAllowance = await readTokenAllowance();

      if (canUseBatchFunding) {
        await executeFeedbackBonusFundingBatch(
          [
            ...(initialAllowance < parsedAmount
              ? [
                  {
                    address: tokenAddress,
                    abi: ERC20_APPROVAL_ABI,
                    functionName: "approve",
                    args: [escrowAddress, parsedAmount],
                  },
                ]
              : []),
            {
              address: escrowAddress,
              abi: FEEDBACK_BONUS_ESCROW_ABI,
              functionName: "createFeedbackBonusPoolWithAsset",
              args: [contentId, roundId, selectedAssetId, parsedAmount, feedbackClosesAt, selectedAwarderAddress],
            },
          ],
          {
            action: "Fund Feedback Bonus",
            atomicRequired: true,
            sponsorshipMode: canUseSponsoredBatchCalls ? "sponsored" : "self-funded",
          },
        );
      } else if (initialAllowance < parsedAmount) {
        const approveHash = await writeContractAsync({
          chainId: chainId as any,
          address: tokenAddress,
          abi: ERC20_APPROVAL_ABI,
          functionName: "approve",
          args: [escrowAddress, parsedAmount],
        });
        await waitForTransactionReceipt(wagmiConfig, {
          chainId: chainId as any,
          hash: approveHash,
          pollingInterval: getFundReceiptPollingInterval(chainId),
        });

        const allowanceAfterApprove = await readTokenAllowance();
        if (allowanceAfterApprove < parsedAmount) {
          throw new Error(
            `${selectedAssetLabel} allowance dropped below the required amount before the Feedback Bonus could be funded. Please try again.`,
          );
        }
      }

      if (!canUseBatchFunding) {
        const feedbackBonusHash = await writeContractAsync({
          chainId: chainId as any,
          address: escrowAddress,
          abi: FEEDBACK_BONUS_ESCROW_ABI,
          functionName: "createFeedbackBonusPoolWithAsset",
          args: [contentId, roundId, selectedAssetId, parsedAmount, feedbackClosesAt, selectedAwarderAddress],
        });
        await waitForTransactionReceipt(wagmiConfig, {
          chainId: chainId as any,
          hash: feedbackBonusHash,
          pollingInterval: getFundReceiptPollingInterval(chainId),
        });
      }

      notification.success(`Feedback Bonus funded with ${formatFeedbackBonusAmount(parsedAmount, asset)}.`);
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
          Feedback Bonuses reward useful written feedback from revealed raters after this round settles. The award
          decision window stays open for at least 24 hours after settlement.
        </p>
        <div className="mt-5 grid gap-4">
          {isWrongFundingChain ? (
            <div className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
              <p>Switch your wallet to {targetChainName} to fund this Feedback Bonus.</p>
              <button
                type="button"
                className="btn btn-sm btn-outline mt-2"
                disabled={switchingChainId === chainId}
                onClick={() => void switchToChain(chainId)}
              >
                {switchingChainId === chainId ? "Switching..." : `Switch to ${targetChainName}`}
              </button>
            </div>
          ) : null}
          <div className="form-control">
            <FeedbackBonusFieldLabel htmlFor={amountInputId} tooltip={FEEDBACK_BONUS_AMOUNT_TOOLTIP}>
              Feedback Bonus amount
            </FeedbackBonusFieldLabel>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={asset === "usdc"}
                onClick={() => setAsset("usdc")}
                className={`btn btn-sm ${asset === "usdc" ? "btn-primary" : "btn-outline"}`}
              >
                USDC
              </button>
              <button
                type="button"
                aria-pressed={asset === "lrep"}
                onClick={() => setAsset("lrep")}
                className={`btn btn-sm ${asset === "lrep" ? "btn-primary" : "btn-outline"}`}
              >
                LREP
              </button>
            </div>
            <div className="input input-bordered flex items-center gap-2 bg-base-100">
              <input
                id={amountInputId}
                inputMode="decimal"
                value={amount}
                onChange={event => setAmount(event.target.value)}
                className="grow"
                placeholder="2"
              />
              <span className="text-base-content/50">{selectedAssetLabel}</span>
            </div>
          </div>

          <div className="form-control">
            <FeedbackBonusFieldLabel
              htmlFor={awarderInputId}
              tooltip="Defaults to your connected wallet. Paste another wallet if someone else should decide feedback awards."
            >
              Awarder address
            </FeedbackBonusFieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id={awarderInputId}
                type="text"
                value={awarderAddress}
                onChange={event => {
                  setAwarderTouched(true);
                  setAwarderAddress(event.target.value);
                }}
                className={`input input-bordered min-w-0 flex-1 bg-base-100 ${awarderError ? "input-error" : ""}`}
                placeholder={address ?? "0x..."}
              />
              <button
                type="button"
                onClick={() => {
                  setAwarderTouched(false);
                  setAwarderAddress(address ?? "");
                }}
                className="btn btn-outline h-12 shrink-0"
              >
                Use connected
              </button>
            </div>
            {awarderError ? (
              <span className="label pt-1">
                <span className="label-text-alt text-error">{awarderError}</span>
              </span>
            ) : null}
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
          <GradientActionButton
            onClick={handleFundFeedbackBonus}
            disabled={!canSubmit || isFunding}
            motion={getGradientActionMotion(isFunding)}
          >
            {isFunding ? "Funding..." : "Fund Feedback Bonus"}
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
