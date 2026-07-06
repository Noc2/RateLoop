"use client";

import { useCallback, useMemo, useState } from "react";
import { FeedbackRegistryAbi, RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Address, encodePacked, keccak256, zeroHash } from "viem";
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import { useTransactor } from "~~/hooks/scaffold-eth";
import { useLocalE2ETestWalletClient } from "~~/hooks/scaffold-eth/useLocalE2ETestWalletClient";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useTransactionFlowToast } from "~~/hooks/useTransactionFlowToast";
import { useWalletTransactionReadiness } from "~~/hooks/useWalletTransactionReadiness";
import { hasPublishedFeedbackPostcondition } from "~~/lib/feedback/postconditions";
import type { ContentFeedbackItem, ContentFeedbackListResult, ContentFeedbackType } from "~~/lib/feedback/types";
import {
  getConfiguredFeedbackRegistryAddress,
  getConfiguredRoundVotingEngineAddress,
} from "~~/lib/questionRewardPools";
import { isUserRejectedTransactionError } from "~~/lib/transactionErrors";
import { raceTransactionWithPostcondition, waitForTransactionPostcondition } from "~~/lib/transactions/postcondition";
import scaffoldConfig from "~~/scaffold.config";
import { isSignatureRejected } from "~~/utils/signatureErrors";

interface SignedChallengeResponse {
  challengeId?: string;
  message?: string;
  chainId?: number;
  roundId?: string;
  feedbackType?: ContentFeedbackType;
  body?: string;
  sourceUrl?: string | null;
  clientNonce?: string;
  feedbackHash?: string;
  deploymentKey?: string;
  contentRegistryAddress?: string;
  feedbackRegistryAddress?: string;
  error?: string;
}

interface SubmitContentFeedbackInput {
  feedbackType: ContentFeedbackType;
  body: string;
  sourceUrl?: string;
  commitHash?: `0x${string}` | null;
}

interface ContentFeedbackActionResult {
  ok: boolean;
  reason?: "not_connected" | "rejected" | "request_failed";
  error?: string;
  alreadyPublished?: boolean;
}

interface ContentFeedbackScope {
  chainId?: number | null;
  deploymentKey?: string | null;
}

type PublishedFeedbackResult =
  | { commitKey: `0x${string}`; txHash: `0x${string}` | null; alreadyPublished?: false }
  | { commitKey: `0x${string}`; txHash: null; alreadyPublished: true };

const EMPTY_FEEDBACK_RESPONSE: ContentFeedbackListResult = {
  items: [],
  count: 0,
  publicCount: 0,
  settlementComplete: false,
  openRoundId: null,
  awardableFeedbackBonusPools: [],
};

function normalizeContentId(contentId: bigint | string | number | null | undefined): string | null {
  if (contentId === null || contentId === undefined) return null;
  const raw = typeof contentId === "bigint" ? contentId.toString() : String(contentId).trim();
  return /^\d+$/.test(raw) && raw !== "0" ? raw.replace(/^0+(?=\d)/, "") : null;
}

function getFeedbackPostconditionPollingInterval(chainId: number) {
  return getTransactionReceiptPollingInterval(chainId, {
    preconfirmation: scaffoldConfig.useBasePreconfRpc,
  });
}

async function readResponseBody<T>(response: Response, fallbackError: string): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(body?.error || fallbackError);
  }

  return body as T;
}

function readBatchTransactionHash(result: { receipts?: readonly { transactionHash?: unknown }[] }) {
  return result.receipts?.find(receipt => typeof receipt.transactionHash === "string")?.transactionHash as
    | `0x${string}`
    | undefined;
}

function readFeedbackSubmissionError(error: unknown, fallback = "Failed to submit feedback") {
  if (isUserRejectedTransactionError(error) || isSignatureRejected(error)) {
    return null;
  }

  const message = error instanceof Error ? error.message : "";
  if (/unknown rpc error occurred/i.test(message) && /request arguments:/i.test(message)) {
    return "Wallet could not submit the feedback transaction. Wait a moment for your wallet session to finish reconnecting, then retry.";
  }

  return message || fallback;
}

export function useContentFeedback(
  contentId: bigint | string | number | null | undefined,
  address?: string,
  scope: ContentFeedbackScope = {},
) {
  const queryClient = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const {
    canUseSelfFundedBatchCalls,
    canUseSponsoredSubmitCalls,
    executeContractCallBatch,
    isAwaitingSelfFundedSubmitCalls,
    isAwaitingSponsoredSubmitCalls,
  } = useThirdwebSponsoredSubmitCalls();
  const flowToast = useTransactionFlowToast();
  const walletTransactionReadiness = useWalletTransactionReadiness({
    address,
    includeExternalSendCalls: true,
    isAwaitingSelfFundedWallet: isAwaitingSelfFundedSubmitCalls,
    isAwaitingSponsoredWallet: isAwaitingSponsoredSubmitCalls,
  });
  const { chain } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const localE2ETestWalletClient = useLocalE2ETestWalletClient(address as Address | undefined, targetNetwork.id);
  const writeTx = useTransactor(localE2ETestWalletClient);
  const normalizedContentId = useMemo(() => normalizeContentId(contentId), [contentId]);
  const normalizedAddress = address?.toLowerCase();
  const chainId = scope.chainId ?? targetNetwork.id;
  const deploymentKey = scope.deploymentKey?.trim() || null;
  const queryKey = useMemo(
    () =>
      [
        "contentFeedback",
        normalizedContentId ?? "none",
        normalizedAddress ?? "anonymous",
        chainId,
        deploymentKey ?? "default",
      ] as const,
    [chainId, deploymentKey, normalizedAddress, normalizedContentId],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resolveCommitKey = useCallback(
    async (roundId: string, knownCommitHash?: `0x${string}` | null): Promise<`0x${string}` | null> => {
      if (!address || !normalizedContentId) return null;

      let commitHash = knownCommitHash;
      if (!commitHash || commitHash === zeroHash) {
        const votingEngineAddress = getConfiguredRoundVotingEngineAddress(targetNetwork.id);
        if (!votingEngineAddress || !publicClient) return null;
        const commitState = (await publicClient.readContract({
          address: votingEngineAddress,
          abi: RoundVotingEngineAbi,
          functionName: "voterCommitKey",
          args: [BigInt(normalizedContentId), BigInt(roundId), address as `0x${string}`],
        })) as readonly [`0x${string}`, `0x${string}`];
        commitHash = commitState[0];
      }

      if (!commitHash || commitHash === zeroHash) return null;
      return keccak256(encodePacked(["address", "bytes32"], [address as `0x${string}`, commitHash]));
    },
    [address, normalizedContentId, publicClient, targetNetwork.id],
  );

  const publishFeedbackOnchain = useCallback(
    async (params: {
      roundId: string;
      feedbackType: ContentFeedbackType;
      body: string;
      sourceUrl?: string;
      clientNonce: `0x${string}`;
      commitHash?: `0x${string}` | null;
      feedbackHash: `0x${string}`;
    }): Promise<PublishedFeedbackResult | null> => {
      if (!normalizedContentId) return null;
      const feedbackRegistryAddress = getConfiguredFeedbackRegistryAddress(targetNetwork.id);
      if (!feedbackRegistryAddress) return null;
      if (!localE2ETestWalletClient && chain?.id !== targetNetwork.id) {
        throw new Error(`Switch your wallet to ${targetNetwork.name} before publishing feedback.`);
      }

      const commitKey = await resolveCommitKey(params.roundId, params.commitHash);
      if (!commitKey) {
        throw new Error("Vote on this question before saving feedback");
      }

      const hasAlreadyPublishedFeedback = async () => {
        if (!publicClient) return false;
        try {
          return await hasPublishedFeedbackPostcondition({
            client: publicClient,
            commitKey,
            contentId: BigInt(normalizedContentId),
            expectedFeedbackHash: params.feedbackHash,
            feedbackRegistryAddress,
            roundId: BigInt(params.roundId),
          });
        } catch {
          return false;
        }
      };

      if (await hasAlreadyPublishedFeedback()) {
        return { commitKey, txHash: null, alreadyPublished: true };
      }

      let txHash: `0x${string}` | null;
      try {
        const request = {
          address: feedbackRegistryAddress,
          abi: FeedbackRegistryAbi,
          chainId: targetNetwork.id,
          functionName: "publishFeedback",
          args: [
            BigInt(normalizedContentId),
            BigInt(params.roundId),
            commitKey,
            params.feedbackType,
            params.body,
            params.sourceUrl ?? "",
            params.clientNonce,
          ],
        } as const;
        const canUseBatchedFeedbackWrite =
          !localE2ETestWalletClient && (canUseSponsoredSubmitCalls || canUseSelfFundedBatchCalls);
        const feedbackBatchSponsorshipMode = canUseSponsoredSubmitCalls ? "sponsored" : "self-funded";
        const batchOptions = {
          ...flowToast.getSponsoredBatchOptions({
            action: "Publish feedback",
            sponsorshipMode: feedbackBatchSponsorshipMode,
          }),
          atomicRequired: true,
        };
        const submittedHash = await (canUseBatchedFeedbackWrite
          ? (async () => {
              flowToast.beginFlow({
                action: "Publish feedback",
                sponsored: feedbackBatchSponsorshipMode === "sponsored",
              });
              try {
                if (publicClient) {
                  const contentIdValue = BigInt(normalizedContentId);
                  const roundIdValue = BigInt(params.roundId);
                  return await raceTransactionWithPostcondition({
                    onPostconditionSuccessThenTransactionError: error => {
                      console.warn(
                        "[content-feedback] publish postcondition succeeded before thirdweb status settled.",
                        {
                          contentId: normalizedContentId,
                          error,
                          roundId: params.roundId,
                        },
                      );
                    },
                    transaction: () =>
                      executeContractCallBatch(
                        [
                          {
                            abi: request.abi,
                            address: request.address,
                            args: request.args,
                            functionName: request.functionName,
                          },
                        ],
                        batchOptions,
                      ),
                    waitForPostcondition: shouldStop =>
                      waitForTransactionPostcondition(
                        () =>
                          hasPublishedFeedbackPostcondition({
                            client: publicClient,
                            commitKey,
                            contentId: contentIdValue,
                            expectedFeedbackHash: params.feedbackHash,
                            feedbackRegistryAddress,
                            roundId: roundIdValue,
                          }),
                        "feedback-publish-postcondition",
                        {
                          pollingIntervalMs: getFeedbackPostconditionPollingInterval(targetNetwork.id),
                          shouldStop,
                        },
                      ),
                  }).then(result =>
                    result.confirmation === "postcondition" ? null : readBatchTransactionHash(result.result),
                  );
                }

                return readBatchTransactionHash(
                  await executeContractCallBatch(
                    [
                      {
                        abi: request.abi,
                        address: request.address,
                        args: request.args,
                        functionName: request.functionName,
                      },
                    ],
                    batchOptions,
                  ),
                );
              } finally {
                flowToast.endFlow();
              }
            })()
          : writeTx(
              () =>
                localE2ETestWalletClient
                  ? localE2ETestWalletClient.writeContract(request as any)
                  : writeContractAsync(request as any),
              { action: "Publish feedback", suppressSuccessToast: true },
            ));
        if (submittedHash === undefined) {
          throw new Error("Feedback publication transaction was not submitted.");
        }
        txHash = submittedHash as `0x${string}` | null;
      } catch (error) {
        if (await hasAlreadyPublishedFeedback()) {
          return { commitKey, txHash: null, alreadyPublished: true };
        }
        throw error;
      }
      return { commitKey, txHash };
    },
    [
      chain?.id,
      canUseSelfFundedBatchCalls,
      canUseSponsoredSubmitCalls,
      executeContractCallBatch,
      localE2ETestWalletClient,
      normalizedContentId,
      publicClient,
      resolveCommitKey,
      targetNetwork.id,
      targetNetwork.name,
      writeContractAsync,
      writeTx,
      flowToast,
    ],
  );

  const feedbackQuery = useQuery({
    queryKey,
    queryFn: async () => {
      if (!normalizedContentId) return EMPTY_FEEDBACK_RESPONSE;

      const params = new URLSearchParams({ contentId: normalizedContentId, chainId: String(chainId) });
      if (address) {
        params.set("address", address);
      }
      if (deploymentKey) {
        params.set("deploymentKey", deploymentKey);
      }

      return readResponseBody<ContentFeedbackListResult>(
        await fetch(`/api/feedback?${params.toString()}`),
        "Failed to fetch feedback",
      );
    },
    enabled: Boolean(normalizedContentId),
    staleTime: 15_000,
    refetchInterval: false,
    retry: false,
  });

  const submitFeedback = useCallback(
    async (input: SubmitContentFeedbackInput): Promise<ContentFeedbackActionResult> => {
      if (walletTransactionReadiness.isBlocked) {
        return {
          ok: false,
          reason: walletTransactionReadiness.status === "disconnected" ? "not_connected" : "request_failed",
          error: walletTransactionReadiness.message ?? "Wallet is unavailable.",
        };
      }
      if (!address || !normalizedContentId) {
        return { ok: false, reason: "not_connected" };
      }

      setIsSubmitting(true);
      try {
        const challenge = await readResponseBody<SignedChallengeResponse>(
          await fetch("/api/feedback/challenge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address,
              contentId: normalizedContentId,
              chainId,
              deploymentKey,
              feedbackType: input.feedbackType,
              body: input.body,
              sourceUrl: input.sourceUrl,
            }),
          }),
          "Failed to create feedback challenge",
        );

        if (
          !challenge.message ||
          !challenge.challengeId ||
          !challenge.chainId ||
          !challenge.roundId ||
          !challenge.feedbackType ||
          !challenge.body ||
          !challenge.clientNonce ||
          !challenge.feedbackHash
        ) {
          throw new Error("Failed to create feedback challenge");
        }

        const signature = await signMessageAsync({ message: challenge.message });
        const publishedFeedback = await publishFeedbackOnchain({
          roundId: challenge.roundId,
          feedbackType: challenge.feedbackType,
          body: challenge.body,
          sourceUrl: challenge.sourceUrl ?? undefined,
          clientNonce: challenge.clientNonce as `0x${string}`,
          commitHash: input.commitHash,
          feedbackHash: challenge.feedbackHash as `0x${string}`,
        });
        if (!publishedFeedback) {
          throw new Error("Feedback registry is not deployed for this chain");
        }
        await readResponseBody<{ ok: true; item: ContentFeedbackItem }>(
          await fetch("/api/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address,
              contentId: normalizedContentId,
              feedbackType: challenge.feedbackType,
              body: challenge.body,
              sourceUrl: challenge.sourceUrl,
              chainId: challenge.chainId,
              deploymentKey: challenge.deploymentKey ?? deploymentKey,
              roundId: challenge.roundId,
              clientNonce: challenge.clientNonce,
              feedbackHash: challenge.feedbackHash,
              commitKey: publishedFeedback.commitKey,
              publicationTxHash: publishedFeedback.alreadyPublished ? null : publishedFeedback.txHash,
              signature,
              challengeId: challenge.challengeId,
            }),
          }),
          "Failed to submit feedback",
        );

        await queryClient.invalidateQueries({ queryKey });
        return publishedFeedback.alreadyPublished ? { ok: true, alreadyPublished: true } : { ok: true };
      } catch (error) {
        const submitError = readFeedbackSubmissionError(error);
        if (!submitError) {
          return { ok: false, reason: "rejected" };
        }

        return {
          ok: false,
          reason: "request_failed",
          error: submitError,
        };
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      address,
      chainId,
      deploymentKey,
      normalizedContentId,
      publishFeedbackOnchain,
      queryClient,
      queryKey,
      signMessageAsync,
      walletTransactionReadiness.isBlocked,
      walletTransactionReadiness.message,
      walletTransactionReadiness.status,
    ],
  );

  const feedback = feedbackQuery.data ?? EMPTY_FEEDBACK_RESPONSE;

  return {
    feedback,
    items: feedback.items,
    isLoading: feedbackQuery.isLoading,
    isFetching: feedbackQuery.isFetching,
    isSubmitting,
    submitFeedback,
    refetchFeedback: feedbackQuery.refetch,
  };
}
