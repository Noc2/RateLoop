"use client";

import { useState } from "react";
import { type Abi, zeroHash } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import { useTermsAcceptance } from "~~/contexts/TermsAcceptanceContext";
import {
  type ClaimableRewardItem,
  claimItemMayWriteLrepCheckpoint,
  getQuestionBundleRewardClaimArgs,
  getQuestionRewardClaimArgs,
  sortClaimableRewardItems,
} from "~~/hooks/claimableRewards";
import { useDeployedContractInfo, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useGasBalanceStatus } from "~~/hooks/useGasBalanceStatus";
import { useRefreshWalletBalances } from "~~/hooks/useRefreshWalletBalances";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useWalletRpcRecovery } from "~~/hooks/useWalletRpcRecovery";
import { useWalletTransactionReadiness } from "~~/hooks/useWalletTransactionReadiness";
import {
  getClaimGasErrorMessage,
  getClaimPreflightErrorMessage,
  isClaimGasShortageError,
} from "~~/lib/claimTransactionFeedback";
import {
  QUESTION_REWARD_POOL_ESCROW_ABI,
  getConfiguredQuestionRewardPoolEscrowAddress,
} from "~~/lib/questionRewardPools";
import { isWalletRpcOverloadedError } from "~~/lib/transactionErrors";
import { readLatestBlockNumber, waitForNextObservedBlock } from "~~/lib/transactions/blockWait";
import { raceTransactionWithPostcondition, waitForTransactionPostcondition } from "~~/lib/transactions/postcondition";
import scaffoldConfig from "~~/scaffold.config";
import { notification } from "~~/utils/scaffold-eth";

/**
 * Hook for claiming all outstanding rewards in sequence.
 */
type SponsoredClaimCall = {
  abi: Abi;
  address: `0x${string}`;
  functionName: string;
  args?: readonly unknown[];
};

function getClaimableRewardLabel(item: ClaimableRewardItem) {
  switch (item.claimType) {
    case "question_reward":
      return `bounty for content #${item.contentId} round ${item.roundId}`;
    case "question_bundle_reward":
      return `bundle bounty #${item.bundleId} round set ${item.roundSetIndex + 1n}`;
    case "frontend_registry_fee":
      return `frontend registry fee withdrawal request for ${item.frontend}`;
    case "frontend_registry_withdrawal":
      return `matured frontend fee withdrawal for ${item.frontend}`;
    case "frontend_round_fee":
      return `frontend round fee for content #${item.contentId} round ${item.roundId}`;
    case "refund":
    case "reward":
      return `content #${item.contentId} round ${item.roundId}`;
  }
}

function getClaimPostconditionPollingInterval(chainId: number) {
  return getTransactionReceiptPollingInterval(chainId, {
    preconfirmation: scaffoldConfig.useBasePreconfRpc,
  });
}

export function useClaimAll() {
  const { address } = useAccount();
  const [isClaiming, setIsClaiming] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const { requireAcceptance } = useTermsAcceptance();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const questionRewardPoolEscrowAddress = getConfiguredQuestionRewardPoolEscrowAddress(targetNetwork.id);
  const {
    canUseSelfFundedBatchCalls,
    canUseSponsoredSubmitCalls,
    executeSponsoredCalls,
    isAwaitingSelfFundedSubmitCalls,
    isAwaitingSponsoredSubmitCalls,
  } = useThirdwebSponsoredSubmitCalls();
  const canUseBatchedClaimCalls = canUseSponsoredSubmitCalls || canUseSelfFundedBatchCalls;
  const claimCallSponsorshipMode = canUseSponsoredSubmitCalls ? "sponsored" : "self-funded";
  const { data: distributorInfo } = useDeployedContractInfo({ contractName: "RoundRewardDistributor" });
  const { data: votingEngineInfo } = useDeployedContractInfo({ contractName: "RoundVotingEngine" as any });
  const { data: frontendRegistryInfo } = useDeployedContractInfo({ contractName: "FrontendRegistry" });
  const { data: questionRewardPoolEscrowInfo } = useDeployedContractInfo({
    contractName: "QuestionRewardPoolEscrow" as any,
  });
  const {
    canShowFreeTransactionAllowance,
    canSponsorTransactions,
    freeTransactionRemaining,
    freeTransactionVerified,
    isAwaitingFreeTransactionAllowance,
    isAwaitingSelfFundedWalletReconnect,
    isAwaitingSponsoredWalletReconnect,
    isMissingGasBalance,
    nativeBalanceValue,
    nativeTokenSymbol,
  } = useGasBalanceStatus({
    includeExternalSendCalls: true,
  });
  const walletTransactionReadiness = useWalletTransactionReadiness({
    includeExternalSendCalls: true,
    isAwaitingSelfFundedWallet: isAwaitingSelfFundedWalletReconnect || isAwaitingSelfFundedSubmitCalls,
    isAwaitingSponsoredWallet: isAwaitingSponsoredSubmitCalls || isAwaitingSponsoredWalletReconnect,
  });
  const { showWalletRpcOverloadNotification } = useWalletRpcRecovery();
  const refreshWalletBalances = useRefreshWalletBalances();

  const { writeContractAsync: writeDistributor } = useScaffoldWriteContract({
    contractName: "RoundRewardDistributor",
  } as any);

  const { writeContractAsync: writeVotingEngine } = useScaffoldWriteContract({
    contractName: "RoundVotingEngine",
  } as any);

  const { writeContractAsync: writeFrontendRegistry } = useScaffoldWriteContract({
    contractName: "FrontendRegistry",
  } as any);
  const { writeContractAsync: writeQuestionRewardPoolEscrow } = useScaffoldWriteContract({
    contractName: "QuestionRewardPoolEscrow",
  } as any);

  const getSponsoredClaimCall = (item: ClaimableRewardItem): SponsoredClaimCall => {
    if (item.claimType === "refund") {
      if (!votingEngineInfo) throw new Error("Round voting engine is unavailable right now.");
      return {
        abi: votingEngineInfo.abi as Abi,
        address: votingEngineInfo.address as `0x${string}`,
        args: [item.contentId, item.roundId],
        functionName: "claimCancelledRoundRefund",
      };
    }

    if (item.claimType === "frontend_registry_fee") {
      if (!frontendRegistryInfo) throw new Error("Frontend registry is unavailable right now.");
      return {
        abi: frontendRegistryInfo.abi as Abi,
        address: frontendRegistryInfo.address as `0x${string}`,
        functionName: "requestFeeWithdrawal",
      };
    }

    if (item.claimType === "frontend_registry_withdrawal") {
      if (!frontendRegistryInfo) throw new Error("Frontend registry is unavailable right now.");
      return {
        abi: frontendRegistryInfo.abi as Abi,
        address: frontendRegistryInfo.address as `0x${string}`,
        functionName: "completeFeeWithdrawal",
      };
    }

    if (item.claimType === "question_reward") {
      if (!questionRewardPoolEscrowInfo) throw new Error("Question reward escrow is unavailable right now.");
      return {
        abi: questionRewardPoolEscrowInfo.abi as Abi,
        address: questionRewardPoolEscrowInfo.address as `0x${string}`,
        args: getQuestionRewardClaimArgs(item),
        functionName: "claimQuestionReward",
      };
    }

    if (item.claimType === "question_bundle_reward") {
      if (!questionRewardPoolEscrowInfo) throw new Error("Question reward escrow is unavailable right now.");
      return {
        abi: questionRewardPoolEscrowInfo.abi as Abi,
        address: questionRewardPoolEscrowInfo.address as `0x${string}`,
        args: getQuestionBundleRewardClaimArgs(item),
        functionName: "claimQuestionBundleReward",
      };
    }

    if (!distributorInfo) throw new Error("Round reward distributor is unavailable right now.");
    if (item.claimType === "frontend_round_fee") {
      return {
        abi: distributorInfo.abi as Abi,
        address: distributorInfo.address as `0x${string}`,
        args: [item.contentId, item.roundId, item.frontend],
        functionName: "claimFrontendFee",
      };
    }

    return {
      abi: distributorInfo.abi as Abi,
      address: distributorInfo.address as `0x${string}`,
      args: [item.contentId, item.roundId],
      functionName: "claimReward",
    };
  };

  const waitForClaimPostcondition = (item: ClaimableRewardItem, shouldStop: () => boolean): Promise<boolean> | null => {
    if (!publicClient || !address) return null;

    if (item.claimType === "refund" && votingEngineInfo) {
      const claimVoter = item.voter ?? address;
      return waitForTransactionPostcondition(
        async () => {
          let commitKey = item.commitKey;
          if (!commitKey || commitKey.toLowerCase() === zeroHash) {
            const voterCommit = (await publicClient.readContract({
              address: votingEngineInfo.address as `0x${string}`,
              abi: votingEngineInfo.abi as Abi,
              functionName: "voterCommitKey",
              args: [item.contentId, item.roundId, claimVoter],
            } as never)) as readonly [`0x${string}`, `0x${string}`];
            commitKey = voterCommit[1];
          }
          if (!commitKey || commitKey.toLowerCase() === zeroHash) return false;

          const commitCore = (await publicClient.readContract({
            address: votingEngineInfo.address as `0x${string}`,
            abi: votingEngineInfo.abi as Abi,
            functionName: "commitCore",
            args: [item.contentId, item.roundId, commitKey],
          } as never)) as readonly unknown[];
          const stakeAmount = commitCore[1];
          return stakeAmount === 0n || stakeAmount === 0;
        },
        "claim-refund-postcondition",
        {
          pollingIntervalMs: getClaimPostconditionPollingInterval(targetNetwork.id),
          shouldStop,
        },
      );
    }

    if (item.claimType === "reward" && distributorInfo) {
      const commitKey = item.commitKey;
      const voter = item.voter;
      const lookup =
        commitKey && /^0x[0-9a-fA-F]{64}$/.test(commitKey)
          ? {
              functionName: "rewardCommitClaimed" as const,
              args: [item.contentId, item.roundId, commitKey] as const,
            }
          : voter
            ? {
                functionName: "rewardClaimed" as const,
                args: [item.contentId, item.roundId, voter] as const,
              }
            : null;
      if (!lookup) return null;
      return waitForTransactionPostcondition(
        async () =>
          (await publicClient.readContract({
            address: distributorInfo.address as `0x${string}`,
            abi: distributorInfo.abi as Abi,
            functionName: lookup.functionName,
            args: lookup.args,
          } as never)) === true,
        "claim-reward-postcondition",
        {
          pollingIntervalMs: getClaimPostconditionPollingInterval(targetNetwork.id),
          shouldStop,
        },
      );
    }

    if (item.claimType === "frontend_round_fee" && distributorInfo) {
      return waitForTransactionPostcondition(
        async () =>
          (await publicClient.readContract({
            address: distributorInfo.address as `0x${string}`,
            abi: distributorInfo.abi as Abi,
            functionName: "frontendFeeClaimed",
            args: [item.contentId, item.roundId, item.frontend],
          } as never)) === true,
        "claim-frontend-round-fee-postcondition",
        {
          pollingIntervalMs: getClaimPostconditionPollingInterval(targetNetwork.id),
          shouldStop,
        },
      );
    }

    if (item.claimType === "frontend_registry_fee" && frontendRegistryInfo) {
      return waitForTransactionPostcondition(
        async () => {
          const releaseAt = await publicClient.readContract({
            address: frontendRegistryInfo.address as `0x${string}`,
            abi: frontendRegistryInfo.abi as Abi,
            functionName: "pendingFeeWithdrawalReleaseAt",
            args: [item.frontend],
          } as never);
          return typeof releaseAt === "bigint" && releaseAt > 0n;
        },
        "claim-frontend-registry-fee-postcondition",
        {
          pollingIntervalMs: getClaimPostconditionPollingInterval(targetNetwork.id),
          shouldStop,
        },
      );
    }

    if (item.claimType === "frontend_registry_withdrawal" && frontendRegistryInfo) {
      return waitForTransactionPostcondition(
        async () => {
          const [pendingAmount, releaseAt] = await Promise.all([
            publicClient.readContract({
              address: frontendRegistryInfo.address as `0x${string}`,
              abi: frontendRegistryInfo.abi as Abi,
              functionName: "pendingFeeWithdrawalAmount",
              args: [item.frontend],
            } as never),
            publicClient.readContract({
              address: frontendRegistryInfo.address as `0x${string}`,
              abi: frontendRegistryInfo.abi as Abi,
              functionName: "pendingFeeWithdrawalReleaseAt",
              args: [item.frontend],
            } as never),
          ]);
          return pendingAmount === 0n && releaseAt === 0n;
        },
        "claim-frontend-registry-withdrawal-postcondition",
        {
          pollingIntervalMs: getClaimPostconditionPollingInterval(targetNetwork.id),
          shouldStop,
        },
      );
    }

    if (item.claimType === "question_reward" && questionRewardPoolEscrowInfo) {
      return waitForTransactionPostcondition(
        async () => {
          const claimableAmount = await publicClient.readContract({
            address: questionRewardPoolEscrowInfo.address as `0x${string}`,
            abi: QUESTION_REWARD_POOL_ESCROW_ABI,
            functionName:
              item.payoutWeight && item.payoutProof
                ? "claimableQuestionRewardWithPayoutWeight"
                : "claimableQuestionReward",
            args:
              item.payoutWeight && item.payoutProof
                ? [item.rewardPoolId, item.roundId, address, item.payoutWeight, item.payoutProof]
                : [item.rewardPoolId, item.roundId, address],
          } as never);
          return claimableAmount === 0n;
        },
        "claim-question-reward-postcondition",
        {
          pollingIntervalMs: getClaimPostconditionPollingInterval(targetNetwork.id),
          shouldStop,
        },
      );
    }

    if (item.claimType === "question_bundle_reward" && questionRewardPoolEscrowInfo) {
      return waitForTransactionPostcondition(
        async () => {
          const claimableAmount = await publicClient.readContract({
            address: questionRewardPoolEscrowInfo.address as `0x${string}`,
            abi: QUESTION_REWARD_POOL_ESCROW_ABI,
            functionName:
              item.payoutWeight && item.payoutProof
                ? "claimableQuestionBundleRewardWithPayoutWeight"
                : "claimableQuestionBundleReward",
            args:
              item.payoutWeight && item.payoutProof
                ? [item.bundleId, item.roundSetIndex, address, item.payoutWeight, item.payoutProof]
                : [item.bundleId, item.roundSetIndex, address],
          } as never);
          return claimableAmount === 0n;
        },
        "claim-question-bundle-reward-postcondition",
        {
          pollingIntervalMs: getClaimPostconditionPollingInterval(targetNetwork.id),
          shouldStop,
        },
      );
    }

    return null;
  };

  const canWaitForClaimPostcondition = (item: ClaimableRewardItem) =>
    Boolean(
      publicClient &&
        address &&
        ((item.claimType === "refund" && votingEngineInfo && (item.commitKey || item.voter || address)) ||
          (item.claimType === "reward" && distributorInfo && (item.commitKey || item.voter)) ||
          (item.claimType === "frontend_round_fee" && distributorInfo) ||
          (item.claimType === "frontend_registry_fee" && frontendRegistryInfo) ||
          (item.claimType === "frontend_registry_withdrawal" && frontendRegistryInfo) ||
          (item.claimType === "question_reward" && questionRewardPoolEscrowInfo) ||
          (item.claimType === "question_bundle_reward" && questionRewardPoolEscrowInfo)),
    );

  const raceClaimTransaction = async (item: ClaimableRewardItem, transaction: () => Promise<unknown>) => {
    if (canWaitForClaimPostcondition(item)) {
      await raceTransactionWithPostcondition({
        onPostconditionSuccessThenTransactionError: error => {
          console.warn("[claim-all] claim postcondition succeeded before transaction status settled.", {
            claimType: item.claimType,
            error,
          });
        },
        transaction,
        waitForPostcondition: shouldStop => waitForClaimPostcondition(item, shouldStop) ?? Promise.resolve(false),
      });
      return;
    }

    await transaction();
  };

  const claimAll = async (
    items: ClaimableRewardItem[],
    onComplete?: (result: {
      claimedItems: ClaimableRewardItem[];
      failedItems: ClaimableRewardItem[];
    }) => void | Promise<void>,
  ) => {
    if (items.length === 0) return;

    const notifyAborted = async () => {
      await onComplete?.({ claimedItems: [], failedItems: items });
    };

    const accepted = await requireAcceptance("claim");
    if (!accepted) {
      await notifyAborted();
      return;
    }

    if (walletTransactionReadiness.isBlocked) {
      const message = walletTransactionReadiness.message ?? "Wallet is unavailable.";
      if (walletTransactionReadiness.isPending) {
        notification.warning(message);
      } else {
        notification.error(message);
      }
      await notifyAborted();
      return;
    }

    const transactionFeedback = {
      canShowFreeTransactionAllowance,
      canSponsorTransactions,
      freeTransactionRemaining,
      freeTransactionVerified,
      hasNativeGasBalance: nativeBalanceValue > 0n,
      isAwaitingFreeTransactionAllowance,
      isAwaitingSelfFundedWalletReconnect,
      isAwaitingSponsoredWalletReconnect,
      isMissingGasBalance,
      nativeTokenSymbol,
    };
    const preflightError = getClaimPreflightErrorMessage(transactionFeedback);
    if (preflightError) {
      if (
        isAwaitingFreeTransactionAllowance ||
        isAwaitingSelfFundedWalletReconnect ||
        isAwaitingSponsoredWalletReconnect
      ) {
        notification.warning(preflightError);
      } else {
        notification.error(preflightError);
      }
      await notifyAborted();
      return;
    }

    const gasErrorMessage = getClaimGasErrorMessage(transactionFeedback);
    const getTransactionErrorMessage = (error: unknown, defaultMessage: string) =>
      isClaimGasShortageError(error, transactionFeedback) ? gasErrorMessage : defaultMessage;

    setIsClaiming(true);
    const orderedItems = sortClaimableRewardItems(items);
    let creditedFrontendRoundCount = 0;
    const claimedItems: ClaimableRewardItem[] = [];
    const failedItems: ClaimableRewardItem[] = [];
    setProgress({ current: 0, total: orderedItems.length });

    try {
      for (let i = 0; i < orderedItems.length; i++) {
        setProgress({ current: i + 1, total: orderedItems.length });
        const item = orderedItems[i];
        const claimLabel = getClaimableRewardLabel(item);

        try {
          if (item.claimType === "frontend_registry_fee" && item.reward <= 0n && creditedFrontendRoundCount === 0) {
            continue;
          }

          if (canUseBatchedClaimCalls) {
            const nextItem = orderedItems[i + 1];
            const shouldWaitForCheckpointBlock =
              claimItemMayWriteLrepCheckpoint(item) &&
              nextItem !== undefined &&
              claimItemMayWriteLrepCheckpoint(nextItem);
            const checkpointBaselineBlock = shouldWaitForCheckpointBlock
              ? await readLatestBlockNumber(publicClient)
              : null;
            const executeClaim = (suppressStatusToast = false) =>
              executeSponsoredCalls([getSponsoredClaimCall(item)], {
                action: claimLabel,
                sponsorshipMode: claimCallSponsorshipMode,
                suppressStatusToast,
              });
            await raceClaimTransaction(item, () => executeClaim(canWaitForClaimPostcondition(item)));
            if (shouldWaitForCheckpointBlock) {
              await waitForNextObservedBlock(publicClient, { afterBlockNumber: checkpointBaselineBlock });
            }
            if (item.claimType === "frontend_round_fee") {
              creditedFrontendRoundCount += 1;
            }
          } else {
            await raceClaimTransaction(item, async () => {
              if (item.claimType === "refund") {
                await (writeVotingEngine as any)(
                  {
                    functionName: "claimCancelledRoundRefund",
                    args: [item.contentId, item.roundId],
                  },
                  { getErrorMessage: getTransactionErrorMessage },
                );
              } else if (item.claimType === "frontend_round_fee") {
                await (writeDistributor as any)(
                  {
                    functionName: "claimFrontendFee",
                    args: [item.contentId, item.roundId, item.frontend],
                  },
                  { getErrorMessage: getTransactionErrorMessage },
                );
                creditedFrontendRoundCount += 1;
              } else if (item.claimType === "frontend_registry_fee") {
                await (writeFrontendRegistry as any)(
                  {
                    functionName: "requestFeeWithdrawal",
                  },
                  { getErrorMessage: getTransactionErrorMessage },
                );
              } else if (item.claimType === "frontend_registry_withdrawal") {
                await (writeFrontendRegistry as any)(
                  {
                    functionName: "completeFeeWithdrawal",
                  },
                  { getErrorMessage: getTransactionErrorMessage },
                );
              } else if (item.claimType === "question_reward") {
                await (writeQuestionRewardPoolEscrow as any)(
                  {
                    functionName: "claimQuestionReward",
                    args: getQuestionRewardClaimArgs(item),
                  },
                  { getErrorMessage: getTransactionErrorMessage },
                );
              } else if (item.claimType === "question_bundle_reward") {
                if (!questionRewardPoolEscrowAddress) {
                  throw new Error("Question reward escrow is not configured");
                }
                await (writeQuestionRewardPoolEscrow as any)(
                  {
                    address: questionRewardPoolEscrowAddress,
                    abi: QUESTION_REWARD_POOL_ESCROW_ABI,
                    functionName: "claimQuestionBundleReward",
                    args: getQuestionBundleRewardClaimArgs(item),
                  },
                  { getErrorMessage: getTransactionErrorMessage },
                );
              } else {
                await (writeDistributor as any)(
                  {
                    functionName: "claimReward",
                    args: [item.contentId, item.roundId],
                  },
                  { getErrorMessage: getTransactionErrorMessage },
                );
              }
            });
          }
          claimedItems.push(item);
        } catch (e: any) {
          failedItems.push(item);
          console.error(`Claim failed for ${claimLabel}:`, e?.shortMessage || e?.message);
          if (isClaimGasShortageError(e, transactionFeedback)) {
            break;
          }
          if (isWalletRpcOverloadedError(e)) {
            showWalletRpcOverloadNotification();
            break;
          }
        }
      }
      await refreshWalletBalances(address);
      await onComplete?.({ claimedItems, failedItems });
    } finally {
      setIsClaiming(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  return {
    claimAll,
    isClaiming,
    isPreparingClaim:
      isAwaitingFreeTransactionAllowance ||
      isAwaitingSelfFundedWalletReconnect ||
      isAwaitingSelfFundedSubmitCalls ||
      isAwaitingSponsoredSubmitCalls ||
      isAwaitingSponsoredWalletReconnect ||
      walletTransactionReadiness.isPending,
    progress,
  };
}
