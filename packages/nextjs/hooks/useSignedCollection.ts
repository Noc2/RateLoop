"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { assertSignedCollectionWalletContext } from "~~/hooks/signedCollectionWalletContext";
import { isSignatureRejected } from "~~/utils/signatureErrors";

export interface SignedCollectionResponse<TItem> {
  items: TItem[];
  count: number;
}

interface SignedCollectionSessionStatus {
  hasReadSession: boolean;
  hasWriteSession: boolean;
}

export interface SignedCollectionToggleResult<TExtraReason extends string = never> {
  ok: boolean;
  selected?: boolean;
  reason?: "not_connected" | "rejected" | "request_failed" | "wallet_changed" | TExtraReason;
  error?: string;
}

export interface SignedCollectionReadAccessResult {
  ok: boolean;
  reason?: "not_connected" | "rejected" | "request_failed" | "wallet_changed";
  error?: string;
}

interface SignedChallengeResponse {
  challengeId?: string;
  message?: string;
  error?: string;
}

interface UseSignedCollectionConfig<TItem, TId, TExtraReason extends string = never> {
  address?: string;
  autoRead?: boolean;
  queryKey: readonly unknown[];
  emptyResponse: SignedCollectionResponse<TItem>;
  sessionPath: string;
  collectionPath: string;
  readSearchParams?: URLSearchParams;
  challengePath: string;
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>;
  getItemKey: (item: TItem) => string;
  normalizeId: (id: TId) => string;
  createOptimisticItem: (normalizedId: string) => TItem;
  buildReadChallengeRequest: (address: string) => Record<string, unknown>;
  buildSignedReadRequest: (address: string, challengeId: string, signature: `0x${string}`) => Record<string, unknown>;
  buildWriteChallengeRequest: (
    address: string,
    normalizedId: string,
    currentlySelected: boolean,
  ) => Record<string, unknown>;
  buildSignedWriteRequest: (
    address: string,
    normalizedId: string,
    currentlySelected: boolean,
    challengeId: string,
    signature: `0x${string}`,
  ) => Record<string, unknown>;
  buildSessionWriteRequest: (
    address: string,
    normalizedId: string,
    currentlySelected: boolean,
  ) => Record<string, unknown>;
  validateToggle?: (normalizedId: string, address: string) => TExtraReason | null;
}

async function readResponseBody<T>(response: Response, fallbackError: string): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(body?.error || fallbackError);
  }

  return body as T;
}

async function requestSignedCollectionReadSession<TItem>(
  config: Pick<
    UseSignedCollectionConfig<TItem, string>,
    "buildReadChallengeRequest" | "buildSignedReadRequest" | "challengePath" | "collectionPath" | "signMessageAsync"
  >,
  address: string,
) {
  const challenge = await readResponseBody<SignedChallengeResponse>(
    await fetch(config.challengePath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config.buildReadChallengeRequest(address)),
    }),
    "Failed to create read signature challenge",
  );

  if (!challenge.message || !challenge.challengeId) {
    throw new Error(challenge.error || "Failed to create read signature challenge");
  }

  const signature = await config.signMessageAsync({ message: challenge.message });
  await readResponseBody<unknown>(
    await fetch(config.collectionPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config.buildSignedReadRequest(address, challenge.challengeId, signature)),
    }),
    "Failed to create read session",
  );
}

async function getSignedCollectionSessionStatus(
  sessionPath: string,
  address: string,
  readSearchParams?: URLSearchParams,
): Promise<SignedCollectionSessionStatus> {
  const searchParams = new URLSearchParams(readSearchParams);
  searchParams.set("address", address);
  const sessionRes = await fetch(`${sessionPath}?${searchParams.toString()}`);
  const sessionBody = await readResponseBody<{
    hasSession?: boolean;
    hasReadSession?: boolean;
    hasWriteSession?: boolean;
  }>(sessionRes, "Failed to check session status");

  return {
    hasReadSession: sessionBody.hasReadSession ?? sessionBody.hasSession ?? false,
    hasWriteSession: sessionBody.hasWriteSession ?? false,
  };
}

async function readSignedCollection<TItem>(
  config: Pick<
    UseSignedCollectionConfig<TItem, string>,
    | "autoRead"
    | "buildReadChallengeRequest"
    | "buildSignedReadRequest"
    | "challengePath"
    | "collectionPath"
    | "emptyResponse"
    | "sessionPath"
    | "signMessageAsync"
    | "readSearchParams"
  >,
  address: string,
): Promise<{
  response: SignedCollectionResponse<TItem>;
  sessionStatus: SignedCollectionSessionStatus;
}> {
  const sessionStatus = await getSignedCollectionSessionStatus(config.sessionPath, address, config.readSearchParams);

  if (sessionStatus.hasReadSession) {
    const searchParams = new URLSearchParams(config.readSearchParams);
    searchParams.set("address", address);
    const response = await fetch(`${config.collectionPath}?${searchParams.toString()}`);
    const body = await readResponseBody<Partial<SignedCollectionResponse<TItem>>>(
      response,
      "Failed to fetch collection",
    );

    return {
      response: {
        items: Array.isArray(body.items) ? body.items : [],
        count: Array.isArray(body.items) ? body.items.length : 0,
      },
      sessionStatus,
    };
  }

  if (!config.autoRead) {
    return {
      response: config.emptyResponse,
      sessionStatus,
    };
  }

  await requestSignedCollectionReadSession(config, address);

  const searchParams = new URLSearchParams(config.readSearchParams);
  searchParams.set("address", address);
  const response = await fetch(`${config.collectionPath}?${searchParams.toString()}`);
  const body = await readResponseBody<Partial<SignedCollectionResponse<TItem>>>(response, "Failed to fetch collection");

  return {
    response: {
      items: Array.isArray(body.items) ? body.items : [],
      count: Array.isArray(body.items) ? body.items.length : 0,
    },
    sessionStatus: {
      ...sessionStatus,
      hasReadSession: true,
    },
  };
}

export function useSignedCollection<TItem, TId, TExtraReason extends string = never>(
  config: UseSignedCollectionConfig<TItem, TId, TExtraReason>,
) {
  const queryClient = useQueryClient();
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [hasWriteSession, setHasWriteSession] = useState(false);
  const sessionStatusQueryKey = useMemo(() => [...config.queryKey, "sessionStatus"], [config.queryKey]);

  useEffect(() => {
    setHasWriteSession(false);
  }, [config.address]);

  const { data: sessionStatus } = useQuery({
    queryKey: sessionStatusQueryKey,
    queryFn: async () => {
      if (!config.address) {
        return { hasReadSession: false, hasWriteSession: false };
      }

      return getSignedCollectionSessionStatus(config.sessionPath, config.address, config.readSearchParams);
    },
    enabled: Boolean(config.address),
    staleTime: 30_000,
    refetchInterval: false,
    retry: false,
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: config.queryKey,
    queryFn: async () => {
      if (!config.address) {
        return config.emptyResponse;
      }

      try {
        const result = await readSignedCollection<TItem>(config, config.address);
        queryClient.setQueryData(sessionStatusQueryKey, result.sessionStatus);
        return result.response;
      } catch (error) {
        if (isSignatureRejected(error)) {
          return config.emptyResponse;
        }
        throw error;
      }
    },
    enabled: Boolean(config.address),
    staleTime: Infinity,
    refetchInterval: false,
    retry: false,
  });

  const items = data?.items ?? config.emptyResponse.items;
  const itemKeys = useMemo(() => new Set(items.map(item => config.getItemKey(item))), [config, items]);

  const updatePending = useCallback((normalizedId: string, isPending: boolean) => {
    setPendingKeys(prev => {
      const next = new Set(prev);
      if (isPending) {
        next.add(normalizedId);
      } else {
        next.delete(normalizedId);
      }
      return next;
    });
  }, []);

  const setOptimisticState = useCallback(
    (normalizedId: string, selected: boolean) => {
      queryClient.setQueryData(config.queryKey, (old: SignedCollectionResponse<TItem> | undefined) => {
        const existingItems = old?.items ?? config.emptyResponse.items;

        if (selected) {
          if (existingItems.some(item => config.getItemKey(item) === normalizedId)) {
            return old ?? { items: existingItems, count: existingItems.length };
          }

          const nextItems = [config.createOptimisticItem(normalizedId), ...existingItems];
          return { items: nextItems, count: nextItems.length };
        }

        const nextItems = existingItems.filter(item => config.getItemKey(item) !== normalizedId);
        return { items: nextItems, count: nextItems.length };
      });
    },
    [config, queryClient],
  );

  const toggleItem = useCallback(
    async (id: TId): Promise<SignedCollectionToggleResult<TExtraReason>> => {
      if (!config.address) {
        return { ok: false, reason: "not_connected" };
      }

      const snapshottedAddress = config.address;
      const guardWalletContext = (): SignedCollectionToggleResult<TExtraReason> | null => {
        const walletContext = assertSignedCollectionWalletContext(snapshottedAddress, config.address);
        if (!walletContext.ok) {
          return { ok: false, reason: "wallet_changed" };
        }
        return null;
      };

      const normalizedId = config.normalizeId(id);
      const extraReason = config.validateToggle?.(normalizedId, snapshottedAddress) ?? null;
      if (extraReason) {
        return { ok: false, reason: extraReason };
      }

      await queryClient.cancelQueries({ queryKey: config.queryKey });
      const previous = queryClient.getQueryData<SignedCollectionResponse<TItem>>(config.queryKey);
      const currentlySelected = itemKeys.has(normalizedId);

      updatePending(normalizedId, true);

      try {
        const performSignedToggle = async () => {
          const walletGuard = guardWalletContext();
          if (walletGuard) {
            return walletGuard;
          }

          const challengeRes = await fetch(config.challengePath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              config.buildWriteChallengeRequest(snapshottedAddress, normalizedId, currentlySelected),
            ),
          });
          const challengeData = await readResponseBody<SignedChallengeResponse>(
            challengeRes,
            "Failed to create signature challenge",
          );

          if (!challengeData.message || !challengeData.challengeId) {
            throw new Error("Failed to create signature challenge");
          }

          const walletGuardBeforeSign = guardWalletContext();
          if (walletGuardBeforeSign) {
            return walletGuardBeforeSign;
          }

          const signature = await config.signMessageAsync({ message: challengeData.message });

          const walletGuardBeforeFetch = guardWalletContext();
          if (walletGuardBeforeFetch) {
            return walletGuardBeforeFetch;
          }

          await readResponseBody(
            await fetch(config.collectionPath, {
              method: currentlySelected ? "DELETE" : "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                config.buildSignedWriteRequest(
                  snapshottedAddress,
                  normalizedId,
                  currentlySelected,
                  challengeData.challengeId,
                  signature,
                ),
              ),
            }),
            "Request failed",
          );
          return { ok: true as const, selected: !currentlySelected };
        };

        setOptimisticState(normalizedId, !currentlySelected);
        const canUseWriteSession =
          hasWriteSession ||
          (await getSignedCollectionSessionStatus(config.sessionPath, snapshottedAddress, config.readSearchParams))
            .hasWriteSession;
        if (canUseWriteSession && !hasWriteSession) {
          setHasWriteSession(true);
        }

        const walletGuardBeforeWrite = guardWalletContext();
        if (walletGuardBeforeWrite) {
          queryClient.setQueryData(config.queryKey, previous);
          return walletGuardBeforeWrite;
        }

        const response = canUseWriteSession
          ? await fetch(config.collectionPath, {
              method: currentlySelected ? "DELETE" : "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                config.buildSessionWriteRequest(snapshottedAddress, normalizedId, currentlySelected),
              ),
            })
          : null;

        if (!canUseWriteSession) {
          const signedToggleResult = await performSignedToggle();
          if (!signedToggleResult.ok) {
            queryClient.setQueryData(config.queryKey, previous);
            return signedToggleResult;
          }
          setHasWriteSession(true);
          queryClient.setQueryData(sessionStatusQueryKey, { hasReadSession: true, hasWriteSession: true });
          return signedToggleResult;
        }

        if (response && response.status === 401) {
          setHasWriteSession(false);
          const signedToggleResult = await performSignedToggle();
          if (!signedToggleResult.ok) {
            queryClient.setQueryData(config.queryKey, previous);
            return signedToggleResult;
          }
          setHasWriteSession(true);
          queryClient.setQueryData(sessionStatusQueryKey, { hasReadSession: true, hasWriteSession: true });
          return signedToggleResult;
        }

        await readResponseBody(response!, "Request failed");
        setHasWriteSession(true);
        queryClient.setQueryData(sessionStatusQueryKey, { hasReadSession: true, hasWriteSession: true });
        return { ok: true, selected: !currentlySelected };
      } catch (error) {
        queryClient.setQueryData(config.queryKey, previous);
        await refetch();

        if (isSignatureRejected(error)) {
          return { ok: false, reason: "rejected" };
        }

        return {
          ok: false,
          reason: "request_failed",
          error: error instanceof Error ? error.message : "Request failed",
        };
      } finally {
        updatePending(normalizedId, false);
      }
    },
    [config, hasWriteSession, itemKeys, queryClient, refetch, sessionStatusQueryKey, setOptimisticState, updatePending],
  );

  const isPending = useCallback((id: TId) => pendingKeys.has(config.normalizeId(id)), [config, pendingKeys]);

  const requestReadAccess = useCallback(async (): Promise<SignedCollectionReadAccessResult> => {
    if (!config.address) {
      return { ok: false, reason: "not_connected" };
    }

    const snapshottedAddress = config.address;

    try {
      const walletContext = assertSignedCollectionWalletContext(snapshottedAddress, config.address);
      if (!walletContext.ok) {
        return { ok: false, reason: "wallet_changed" };
      }

      const result = await readSignedCollection<TItem>({ ...config, autoRead: true }, snapshottedAddress);

      const walletContextAfterRead = assertSignedCollectionWalletContext(snapshottedAddress, config.address);
      if (!walletContextAfterRead.ok) {
        return { ok: false, reason: "wallet_changed" };
      }

      queryClient.setQueryData(sessionStatusQueryKey, result.sessionStatus);
      queryClient.setQueryData(config.queryKey, result.response);
      return { ok: true };
    } catch (error) {
      if (isSignatureRejected(error)) {
        return { ok: false, reason: "rejected" };
      }

      return {
        ok: false,
        reason: "request_failed",
        error: error instanceof Error ? error.message : "Failed to load collection",
      };
    }
  }, [config, queryClient, sessionStatusQueryKey]);

  return {
    items,
    itemKeys,
    isLoading,
    hasReadSession: sessionStatus?.hasReadSession ?? false,
    toggleItem,
    requestReadAccess,
    isPending,
  };
}
