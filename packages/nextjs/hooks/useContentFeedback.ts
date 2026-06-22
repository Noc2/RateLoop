"use client";

import { useCallback, useMemo, useState } from "react";
import { FeedbackRegistryAbi, RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Address, encodePacked, keccak256, zeroHash } from "viem";
import { useAccount, useConfig, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { useTransactor } from "~~/hooks/scaffold-eth";
import { useLocalE2ETestWalletClient } from "~~/hooks/scaffold-eth/useLocalE2ETestWalletClient";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useGasBalanceStatus } from "~~/hooks/useGasBalanceStatus";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import type { ContentFeedbackItem, ContentFeedbackListResult, ContentFeedbackType } from "~~/lib/feedback/types";
import {
  getConfiguredFeedbackRegistryAddress,
  getConfiguredRoundVotingEngineAddress,
} from "~~/lib/questionRewardPools";
import { getGasBalanceErrorMessage, isUserRejectedTransactionError } from "~~/lib/transactionErrors";
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

type PublishedFeedbackResult =
  | { commitKey: `0x${string}`; txHash: `0x${string}`; alreadyPublished?: false }
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

async function readResponseBody<T>(response: Response, fallbackError: string): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(body?.error || fallbackError);
  }

  return body as T;
}

function readFeedbackRecordHash(record: unknown): string | null {
  if (Array.isArray(record)) {
    return typeof record[0] === "string" ? record[0] : null;
  }
  if (record && typeof record === "object" && "feedbackHash" in record) {
    const hash = (record as { feedbackHash?: unknown }).feedbackHash;
    return typeof hash === "string" ? hash : null;
  }
  return null;
}

function hasPublishedFeedbackRecord(record: unknown) {
  const feedbackHash = readFeedbackRecordHash(record);
  return typeof feedbackHash === "string" && feedbackHash !== zeroHash;
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

export function useContentFeedback(contentId: bigint | string | number | null | undefined, address?: string) {
  const queryClient = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const {
    canUseSelfFundedBatchCalls,
    canUseSponsoredSubmitCalls,
    executeContractCallBatch,
    isAwaitingSponsoredSubmitCalls,
  } = useThirdwebSponsoredSubmitCalls();
  const { canSponsorTransactions, isMissingGasBalance, nativeTokenSymbol } = useGasBalanceStatus({
    includeExternalSendCalls: true,
  });
  const wagmiConfig = useConfig();
  const { chain } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const localE2ETestWalletClient = useLocalE2ETestWalletClient(address as Address | undefined, targetNetwork.id);
  const writeTx = useTransactor(localE2ETestWalletClient);
  const normalizedContentId = useMemo(() => normalizeContentId(contentId), [contentId]);
  const normalizedAddress = address?.toLowerCase();
  const chainId = targetNetwork.id;
  const queryKey = useMemo(
    () => ["contentFeedback", normalizedContentId ?? "none", normalizedAddress ?? "anonymous", chainId] as const,
    [chainId, normalizedAddress, normalizedContentId],
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
          const record = await publicClient.readContract({
            address: feedbackRegistryAddress,
            abi: FeedbackRegistryAbi,
            functionName: "feedbackByCommitKey",
            args: [BigInt(normalizedContentId), BigInt(params.roundId), commitKey],
          });
          return hasPublishedFeedbackRecord(record);
        } catch {
          return false;
        }
      };

      if (await hasAlreadyPublishedFeedback()) {
        return { commitKey, txHash: null, alreadyPublished: true };
      }

      let txHash: `0x${string}`;
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
        const submittedHash = canUseBatchedFeedbackWrite
          ? readBatchTransactionHash(
              await executeContractCallBatch(
                [
                  {
                    abi: request.abi,
                    address: request.address,
                    args: request.args,
                    functionName: request.functionName,
                  },
                ],
                {
                  action: "Publish feedback",
                  atomicRequired: true,
                  sponsorshipMode: canUseSponsoredSubmitCalls ? "sponsored" : "self-funded",
                },
              ),
            )
          : await writeTx(
              () =>
                localE2ETestWalletClient
                  ? localE2ETestWalletClient.writeContract(request as any)
                  : writeContractAsync(request as any),
              { action: "Publish feedback", suppressSuccessToast: true },
            );
        if (!submittedHash) {
          throw new Error("Feedback publication transaction was not submitted.");
        }
        txHash = submittedHash as `0x${string}`;
      } catch (error) {
        if (await hasAlreadyPublishedFeedback()) {
          return { commitKey, txHash: null, alreadyPublished: true };
        }
        throw error;
      }
      try {
        await waitForTransactionReceipt(wagmiConfig, { chainId: targetNetwork.id, hash: txHash });
      } catch (error) {
        if (!(await hasAlreadyPublishedFeedback())) {
          throw error;
        }
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
      wagmiConfig,
      writeContractAsync,
      writeTx,
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
      if (!address || !normalizedContentId) {
        return { ok: false, reason: "not_connected" };
      }
      if (isAwaitingSponsoredSubmitCalls) {
        return {
          ok: false,
          reason: "request_failed",
          error: "Your wallet session is still preparing free transactions. Wait a moment, then retry.",
        };
      }
      if (isMissingGasBalance && !canUseSponsoredSubmitCalls && !canUseSelfFundedBatchCalls) {
        return {
          ok: false,
          reason: "request_failed",
          error: getGasBalanceErrorMessage(nativeTokenSymbol, { canSponsorTransactions }),
        };
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
        });
        if (!publishedFeedback) {
          throw new Error("Feedback registry is not deployed for this chain");
        }
        if (publishedFeedback.alreadyPublished) {
          await queryClient.invalidateQueries({ queryKey });
          return { ok: true, alreadyPublished: true };
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
              roundId: challenge.roundId,
              clientNonce: challenge.clientNonce,
              feedbackHash: challenge.feedbackHash,
              commitKey: publishedFeedback.commitKey,
              publicationTxHash: publishedFeedback.txHash,
              signature,
              challengeId: challenge.challengeId,
            }),
          }),
          "Failed to submit feedback",
        );

        await queryClient.invalidateQueries({ queryKey });
        return { ok: true };
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
      canSponsorTransactions,
      canUseSelfFundedBatchCalls,
      canUseSponsoredSubmitCalls,
      chainId,
      isAwaitingSponsoredSubmitCalls,
      isMissingGasBalance,
      nativeTokenSymbol,
      normalizedContentId,
      publishFeedbackOnchain,
      queryClient,
      queryKey,
      signMessageAsync,
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
