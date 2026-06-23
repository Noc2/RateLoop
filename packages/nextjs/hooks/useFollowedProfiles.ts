"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Abi } from "viem";
import { isAddress } from "viem";
import { useDeployedContractInfo, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import type { SignedCollectionReadAccessResult, SignedCollectionToggleResult } from "~~/hooks/useSignedCollection";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useWalletTransactionReadiness } from "~~/hooks/useWalletTransactionReadiness";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import {
  type PonderFollowResponse,
  invalidatePonderCache,
  isPonderAvailable,
  ponderApi,
} from "~~/services/ponder/client";
import { isSignatureRejected } from "~~/utils/signatureErrors";

export interface FollowedProfileItem {
  walletAddress: string;
  createdAt: string;
}

interface ToggleFollowResult extends SignedCollectionToggleResult<"self_follow"> {
  following?: boolean;
}

interface UseFollowedProfilesOptions {
  autoRead?: boolean;
}

const EMPTY_FOLLOWED_RESPONSE: PonderFollowResponse = {
  items: [],
  count: 0,
  followerCount: 0,
  followingCount: 0,
  limit: 0,
  offset: 0,
};

function normalizeWalletAddress(walletAddress: string) {
  return walletAddress.toLowerCase();
}

function normalizeFollowItems(items: FollowedProfileItem[]) {
  return items.map(item => ({
    ...item,
    walletAddress: normalizeWalletAddress(item.walletAddress),
  }));
}

async function fetchFollowedProfiles(
  address: string | undefined,
  options: { chainId: number; deploymentKey?: string | null },
): Promise<PonderFollowResponse> {
  const normalizedAddress = address?.toLowerCase();
  if (!normalizedAddress) return EMPTY_FOLLOWED_RESPONSE;

  const available = await isPonderAvailable(options.deploymentKey);
  if (!available) return EMPTY_FOLLOWED_RESPONSE;

  try {
    return await ponderApi.getAllFollows(normalizedAddress, options);
  } catch (error) {
    invalidatePonderCache();
    if (process.env.NODE_ENV !== "production") {
      console.warn("[Ponder] Failed to fetch followed profiles:", error);
    }
    return EMPTY_FOLLOWED_RESPONSE;
  }
}

export function useFollowedProfiles(address?: string, options?: UseFollowedProfilesOptions) {
  const { targetNetwork } = useTargetNetwork();
  const deployment = useMemo(() => resolveProtocolDeploymentScope(targetNetwork.id), [targetNetwork.id]);
  const deploymentKey = deployment?.deploymentKey ?? null;
  const autoRead = options?.autoRead ?? true;
  const normalizedAddress = address?.toLowerCase();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useScaffoldWriteContract({
    contractName: "RaterRegistry",
  });
  const { data: raterRegistryContract } = useDeployedContractInfo({
    contractName: "RaterRegistry",
  } as any);
  const {
    canUseSelfFundedBatchCalls,
    canUseSponsoredSubmitCalls,
    executeContractCallBatch,
    isAwaitingSelfFundedBatchCalls,
    isAwaitingSponsoredSubmitCalls,
  } = useThirdwebSponsoredSubmitCalls();
  const walletTransactionReadiness = useWalletTransactionReadiness({
    address,
    includeExternalSendCalls: true,
    isAwaitingSelfFundedWallet: isAwaitingSelfFundedBatchCalls,
    isAwaitingSponsoredWallet: isAwaitingSponsoredSubmitCalls,
  });
  const queryKey = useMemo(
    () => ["followedProfiles", normalizedAddress ?? "anonymous", targetNetwork.id, deploymentKey] as const,
    [deploymentKey, normalizedAddress, targetNetwork.id],
  );
  const [pendingWallets, setPendingWallets] = useState<Set<string>>(() => new Set());
  const [optimisticFollows, setOptimisticFollows] = useState<Map<string, FollowedProfileItem | null>>(() => new Map());

  useEffect(() => {
    setPendingWallets(new Set());
    setOptimisticFollows(new Map());
  }, [deploymentKey, normalizedAddress, targetNetwork.id]);

  const followQuery = useQuery({
    queryKey,
    queryFn: async () => {
      return fetchFollowedProfiles(normalizedAddress, { chainId: targetNetwork.id, deploymentKey });
    },
    enabled: Boolean(normalizedAddress) && autoRead,
    staleTime: 15_000,
    retry: false,
  });

  const baseItems = useMemo(
    () => normalizeFollowItems(followQuery.data?.items ?? EMPTY_FOLLOWED_RESPONSE.items),
    [followQuery.data?.items],
  );

  useEffect(() => {
    const baseKeys = new Set(baseItems.map(item => item.walletAddress));
    setOptimisticFollows(current => {
      let changed = false;
      const next = new Map(current);
      for (const [walletAddress, item] of current.entries()) {
        const existsInBase = baseKeys.has(walletAddress);
        if ((item === null && !existsInBase) || (item !== null && existsInBase)) {
          next.delete(walletAddress);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [baseItems]);

  const followedItems = useMemo(() => {
    const merged = new Map(baseItems.map(item => [item.walletAddress, item] as const));
    for (const [walletAddress, item] of optimisticFollows.entries()) {
      if (item === null) {
        merged.delete(walletAddress);
      } else {
        merged.set(walletAddress, item);
      }
    }
    return Array.from(merged.values()).sort((left, right) => {
      if (left.createdAt === right.createdAt) {
        return left.walletAddress.localeCompare(right.walletAddress);
      }
      return right.createdAt.localeCompare(left.createdAt);
    });
  }, [baseItems, optimisticFollows]);

  const followedWallets = useMemo(
    () => new Set(followedItems.map(item => normalizeWalletAddress(item.walletAddress))),
    [followedItems],
  );

  const refreshFollowState = useCallback(
    async (targetWalletAddress?: string) => {
      const invalidations: Promise<unknown>[] = [
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["ponder-fallback", "discoverSignals"] }),
      ];

      if (normalizedAddress) {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: ["ponder-fallback", "publicProfile", normalizedAddress] }),
          queryClient.invalidateQueries({
            queryKey: ["ponder-fallback", "publicProfile", normalizedAddress, targetNetwork.id, deploymentKey],
          }),
        );
      }

      if (targetWalletAddress) {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: ["ponder-fallback", "publicProfile", targetWalletAddress] }),
          queryClient.invalidateQueries({
            queryKey: ["ponder-fallback", "publicProfile", targetWalletAddress, targetNetwork.id, deploymentKey],
          }),
        );
      }

      await Promise.all(invalidations);
    },
    [deploymentKey, normalizedAddress, queryClient, queryKey, targetNetwork.id],
  );

  const requestReadAccess = useCallback(async (): Promise<SignedCollectionReadAccessResult> => {
    if (!normalizedAddress) {
      return { ok: false, reason: "not_connected" };
    }

    try {
      const result = await followQuery.refetch();
      if (result.error) {
        throw result.error;
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: "request_failed",
        error: error instanceof Error ? error.message : "Failed to load follows",
      };
    }
  }, [followQuery, normalizedAddress]);

  const toggleFollow = useCallback(
    async (targetAddress: string): Promise<ToggleFollowResult> => {
      if (!normalizedAddress) {
        return { ok: false, reason: "not_connected" };
      }
      if (!isAddress(targetAddress)) {
        return { ok: false, reason: "request_failed", error: "Invalid profile address" };
      }

      const normalizedTargetAddress = normalizeWalletAddress(targetAddress);
      if (normalizedTargetAddress === normalizedAddress) {
        return { ok: false, reason: "self_follow" };
      }
      if (walletTransactionReadiness.isBlocked) {
        return {
          ok: false,
          reason: walletTransactionReadiness.status === "disconnected" ? "not_connected" : "request_failed",
          error: walletTransactionReadiness.message ?? "Wallet is unavailable.",
        };
      }
      if (pendingWallets.has(normalizedTargetAddress)) {
        return {
          ok: true,
          following: followedWallets.has(normalizedTargetAddress),
          selected: followedWallets.has(normalizedTargetAddress),
        };
      }

      const currentlyFollowing = followedWallets.has(normalizedTargetAddress);
      const nextFollowing = !currentlyFollowing;
      const previousOptimisticEntry = optimisticFollows.get(normalizedTargetAddress);
      const optimisticItem = nextFollowing
        ? { walletAddress: normalizedTargetAddress, createdAt: new Date().toISOString() }
        : null;

      setPendingWallets(current => new Set(current).add(normalizedTargetAddress));
      setOptimisticFollows(current => {
        const next = new Map(current);
        next.set(normalizedTargetAddress, optimisticItem);
        return next;
      });

      try {
        const functionName = currentlyFollowing ? "unfollowProfile" : "followProfile";
        const args = [normalizedTargetAddress as `0x${string}`] as const;
        const canUseBatchedFollowWrite = Boolean(
          raterRegistryContract && (canUseSponsoredSubmitCalls || canUseSelfFundedBatchCalls),
        );

        if (canUseBatchedFollowWrite && raterRegistryContract) {
          await executeContractCallBatch(
            [
              {
                abi: raterRegistryContract.abi as Abi,
                address: raterRegistryContract.address as `0x${string}`,
                args,
                functionName,
              },
            ],
            {
              action: nextFollowing ? "follow profile" : "unfollow profile",
              atomicRequired: true,
              sponsorshipMode: canUseSponsoredSubmitCalls ? "sponsored" : "self-funded",
            },
          );
        } else {
          const txHash = await writeContractAsync({
            functionName,
            args,
          });
          if (!txHash) {
            throw new Error("Follow transaction was not submitted");
          }
        }
        await refreshFollowState(normalizedTargetAddress);
        return {
          ok: true,
          following: nextFollowing,
          selected: nextFollowing,
        };
      } catch (error) {
        setOptimisticFollows(current => {
          const next = new Map(current);
          if (previousOptimisticEntry === undefined) {
            next.delete(normalizedTargetAddress);
          } else {
            next.set(normalizedTargetAddress, previousOptimisticEntry);
          }
          return next;
        });

        if (isSignatureRejected(error)) {
          return { ok: false, reason: "rejected" };
        }

        return {
          ok: false,
          reason: "request_failed",
          error: error instanceof Error ? error.message : "Failed to update follows",
        };
      } finally {
        setPendingWallets(current => {
          const next = new Set(current);
          next.delete(normalizedTargetAddress);
          return next;
        });
      }
    },
    [
      canUseSelfFundedBatchCalls,
      canUseSponsoredSubmitCalls,
      executeContractCallBatch,
      followedWallets,
      normalizedAddress,
      optimisticFollows,
      pendingWallets,
      raterRegistryContract,
      refreshFollowState,
      walletTransactionReadiness.isBlocked,
      walletTransactionReadiness.message,
      walletTransactionReadiness.status,
      writeContractAsync,
    ],
  );

  return {
    followedItems,
    followedWallets,
    isLoading: Boolean(normalizedAddress) && followQuery.isLoading,
    hasReadSession: Boolean(normalizedAddress),
    requestReadAccess,
    toggleFollow,
    isPending: (targetAddress: string) => pendingWallets.has(normalizeWalletAddress(targetAddress)),
  };
}
