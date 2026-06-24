"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Address, type Hex, isAddress } from "viem";
import { usePublicClient } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { usePageVisibility } from "~~/hooks/usePageVisibility";
import { usePonderQuery } from "~~/hooks/usePonderQuery";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { getVoteCooldownRemainingSeconds } from "~~/lib/vote/cooldown";
import {
  type VoteCooldownContractInfo,
  findVoteCommittedEvent,
  pickVoteCooldownFallbackContract,
} from "~~/lib/vote/cooldownFallback";
import { type VoteCooldownLogLike, buildVoteCooldownItemsFromLogs } from "~~/lib/vote/cooldownLogs";
import {
  mergeVoteCooldownRemainingByContentId,
  readOnChainVoteCooldownsByContentId,
} from "~~/lib/vote/onChainVoteCooldown";
import { type PonderVoteCooldownsResponse, ponderApi } from "~~/services/ponder/client";
import { contracts } from "~~/utils/scaffold-eth/contract";

interface UseVoteCooldownsParams {
  contentIds: readonly bigint[];
  voters: readonly string[];
  identityKeys?: readonly string[];
  includeAdvisory?: boolean;
  primaryVoter?: string | null;
  identityHolder?: Address | null;
  identityKey?: Hex | null;
  identityResolved?: boolean;
  nowSeconds: number;
  enabled?: boolean;
}

const PONDER_VOTE_COOLDOWN_CONTENT_ID_BATCH_SIZE = 200;

function normalizeContentIds(contentIds: readonly bigint[]) {
  const unique = new Set<string>();
  for (const contentId of contentIds) {
    if (contentId < 0n) continue;
    unique.add(contentId.toString());
  }
  return Array.from(unique);
}

function chunkList<T>(items: readonly T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeVoters(voters: readonly string[]) {
  const unique = new Set<string>();
  for (const voter of voters) {
    const normalized = voter.trim().toLowerCase();
    if (!normalized) continue;
    unique.add(normalized);
  }
  return Array.from(unique);
}

function normalizeIdentityKeys(identityKeys: readonly string[] | undefined) {
  const unique = new Set<string>();
  for (const identityKey of identityKeys ?? []) {
    const normalized = identityKey.trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(normalized)) continue;
    unique.add(normalized);
  }
  return Array.from(unique);
}

function normalizePrimaryVoter(primaryVoter: string | null | undefined, voters: readonly string[]) {
  const candidate = primaryVoter?.trim();
  if (candidate && isAddress(candidate)) {
    return candidate as Address;
  }
  const fallback = voters[0]?.trim();
  return fallback && isAddress(fallback) ? (fallback as Address) : null;
}

export function useVoteCooldowns({
  contentIds,
  voters,
  identityKeys,
  includeAdvisory = false,
  primaryVoter,
  identityHolder,
  identityKey,
  identityResolved = true,
  nowSeconds,
  enabled = true,
}: UseVoteCooldownsParams) {
  const { targetNetwork } = useTargetNetwork();
  const deployment = useMemo(() => resolveProtocolDeploymentScope(targetNetwork.id), [targetNetwork.id]);
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const isPageVisible = usePageVisibility();
  const { data: votingEngineInfo } = useDeployedContractInfo({
    contractName: "RoundVotingEngine" as any,
    chainId: targetNetwork.id as any,
  });
  const normalizedContentIds = useMemo(() => normalizeContentIds(contentIds), [contentIds]);
  const normalizedVoters = useMemo(() => normalizeVoters(voters), [voters]);
  const normalizedIdentityKeys = useMemo(() => normalizeIdentityKeys(identityKeys), [identityKeys]);
  const resolvedPrimaryVoter = useMemo(
    () => normalizePrimaryVoter(primaryVoter, normalizedVoters),
    [normalizedVoters, primaryVoter],
  );
  const contentIdsKey = normalizedContentIds.join(",");
  const votersKey = normalizedVoters.join(",");
  const identityKeysKey = normalizedIdentityKeys.join(",");
  const queryEnabled = enabled && normalizedContentIds.length > 0 && normalizedVoters.length > 0;
  const configuredVotingEngineInfo = contracts?.[targetNetwork.id]?.RoundVotingEngine as
    | VoteCooldownContractInfo
    | undefined;
  const voteCooldownContractInfo = pickVoteCooldownFallbackContract(votingEngineInfo, configuredVotingEngineInfo);
  const voteCommittedEvent = useMemo(
    () => findVoteCommittedEvent(voteCooldownContractInfo),
    [voteCooldownContractInfo],
  );
  const rpcCooldownFallbackEnabled = Boolean(publicClient && voteCooldownContractInfo?.address && voteCommittedEvent);
  const onChainQueryEnabled =
    queryEnabled &&
    identityResolved &&
    Boolean(publicClient && voteCooldownContractInfo?.address && resolvedPrimaryVoter);

  const { data: result, isLoading: indexedLoading } = usePonderQuery<
    PonderVoteCooldownsResponse,
    PonderVoteCooldownsResponse
  >({
    queryKey: [
      "voteCooldowns",
      targetNetwork.id,
      deployment?.deploymentKey ?? null,
      voteCooldownContractInfo?.address ?? null,
      contentIdsKey,
      votersKey,
      identityKeysKey,
      includeAdvisory,
    ],
    availabilityDeploymentKey: deployment?.deploymentKey,
    enabled: queryEnabled,
    ponderFn: async () => {
      const batches = chunkList(normalizedContentIds, PONDER_VOTE_COOLDOWN_CONTENT_ID_BATCH_SIZE);
      const responses = await Promise.all(
        batches.map(batch =>
          ponderApi.getVoteCooldowns(
            {
              contentIds: batch.join(","),
              voters: votersKey,
              ...(identityKeysKey ? { identityKeys: identityKeysKey } : {}),
              ...(includeAdvisory ? { includeAdvisory: "1" } : {}),
            },
            { chainId: targetNetwork.id, deploymentKey: deployment?.deploymentKey },
          ),
        ),
      );

      return {
        items: responses.flatMap(response => response.items),
      };
    },
    rpcFn: async () => {
      if (!publicClient || !voteCooldownContractInfo?.address || !voteCommittedEvent) {
        return { items: [] };
      }

      const fromBlock = BigInt(voteCooldownContractInfo.deployedOnBlock ?? 0);
      const logGroups = await Promise.all(
        normalizedContentIds.flatMap(contentId =>
          normalizedVoters.map(voter =>
            publicClient.getLogs({
              address: voteCooldownContractInfo.address,
              event: voteCommittedEvent,
              fromBlock,
              args: {
                contentId: BigInt(contentId),
                voter: voter as Address,
              },
            }),
          ),
        ),
      );
      const items = await buildVoteCooldownItemsFromLogs(logGroups.flat() as VoteCooldownLogLike[], async log => {
        const latestBlockNumber = log.blockNumber;
        if (log.blockHash == null && latestBlockNumber == null) {
          return null;
        }

        const block =
          log.blockHash != null
            ? await publicClient.getBlock({ blockHash: log.blockHash })
            : await publicClient.getBlock({ blockNumber: latestBlockNumber ?? undefined });

        return Number(block.timestamp);
      });

      return { items };
    },
    rpcEnabled: rpcCooldownFallbackEnabled,
    staleTime: 15_000,
    refetchInterval: isPageVisible ? 30_000 : false,
  });

  const {
    data: onChainCooldownByContentId,
    isError: onChainError,
    isLoading: onChainLoading,
  } = useQuery({
    queryKey: [
      "voteCooldownsOnChain",
      targetNetwork.id,
      voteCooldownContractInfo?.address ?? null,
      contentIdsKey,
      resolvedPrimaryVoter,
      identityHolder ?? null,
      identityKey ?? null,
    ],
    enabled: onChainQueryEnabled,
    staleTime: 15_000,
    refetchInterval: isPageVisible ? 30_000 : false,
    queryFn: async () =>
      readOnChainVoteCooldownsByContentId({
        contentIds: normalizedContentIds.map(contentId => BigInt(contentId)),
        identityHolder,
        identityKey,
        nowSeconds,
        publicClient: publicClient!,
        voter: resolvedPrimaryVoter!,
        votingEngineAddress: voteCooldownContractInfo!.address as Address,
      }),
  });

  const cooldownByContentId = useMemo(() => {
    let cooldowns = new Map<string, number>();

    for (const item of result?.data.items ?? []) {
      const remainingSeconds = getVoteCooldownRemainingSeconds(item.latestCommittedAt, nowSeconds);
      cooldowns = mergeVoteCooldownRemainingByContentId(cooldowns, BigInt(item.contentId), remainingSeconds);
    }

    for (const [contentId, remainingSeconds] of onChainCooldownByContentId ?? []) {
      cooldowns = mergeVoteCooldownRemainingByContentId(cooldowns, BigInt(contentId), remainingSeconds);
    }

    return cooldowns;
  }, [nowSeconds, onChainCooldownByContentId, result?.data.items]);

  return {
    cooldownByContentId,
    isLoading:
      indexedLoading ||
      onChainLoading ||
      (queryEnabled && result === undefined) ||
      (onChainQueryEnabled && !onChainError && onChainCooldownByContentId === undefined),
  };
}
