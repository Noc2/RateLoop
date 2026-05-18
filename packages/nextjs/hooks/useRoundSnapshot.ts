"use client";

import { useEffect } from "react";
import { useOptimisticVote } from "~~/contexts/OptimisticVoteContext";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { usePageVisibility } from "~~/hooks/usePageVisibility";
import { useUnixTime } from "~~/hooks/useUnixTime";
import { useVotingConfig } from "~~/hooks/useVotingConfig";
import {
  type OpenRoundFallbackData,
  type VotingConfig,
  deriveRoundSnapshot,
  isOptimisticRoundDeltaReflected,
  mergeRoundDataWithFallback,
  parseRound,
  parseVotingConfig,
} from "~~/lib/contracts/roundVotingEngine";

export function useRoundSnapshot(
  contentId?: bigint,
  fallbackOpenRound?: OpenRoundFallbackData,
  fallbackRoundConfig?: VotingConfig | null,
) {
  const { clearOptimisticVote, getOptimisticDelta } = useOptimisticVote();
  const optimisticDelta = contentId !== undefined ? getOptimisticDelta(contentId) : undefined;
  const protocolConfig = useVotingConfig();
  const now = useUnixTime();
  const isPageVisible = usePageVisibility();
  const refetchInterval = isPageVisible ? 10_000 : false;

  const { data: rawCurrentRoundId, isLoading: isRoundIdLoading } = useScaffoldReadContract({
    contractName: "RoundVotingEngine" as any,
    functionName: "currentRoundId" as any,
    args: [contentId] as any,
    watch: true,
    query: {
      enabled: contentId !== undefined,
      refetchInterval,
    },
  } as any);
  const currentRoundId = (rawCurrentRoundId as unknown as bigint | undefined) ?? 0n;

  const { data: rawRoundData, isLoading: isRoundLoading } = useScaffoldReadContract({
    contractName: "RoundVotingEngine" as any,
    functionName: "rounds" as any,
    args: [contentId, currentRoundId] as any,
    watch: true,
    query: {
      enabled: contentId !== undefined && currentRoundId > 0n,
      refetchInterval,
    },
  } as any);

  const { data: rawRoundConfigSnapshot, isLoading: isRoundConfigLoading } = useScaffoldReadContract({
    contractName: "RoundVotingEngine" as any,
    functionName: "roundConfigSnapshot" as any,
    args: [contentId, currentRoundId] as any,
    watch: true,
    query: {
      enabled: contentId !== undefined && currentRoundId > 0n,
      refetchInterval,
    },
  } as any);

  const { data: rawPreviewRoundId, isLoading: isPreviewRoundIdLoading } = useScaffoldReadContract({
    contractName: "RoundVotingEngine" as any,
    functionName: "previewCommitRoundId" as any,
    args: [contentId] as any,
    watch: true,
    query: {
      enabled: contentId !== undefined,
      refetchInterval,
    },
  } as any);

  const previewRoundId = (rawPreviewRoundId as unknown as bigint | undefined) ?? 0n;
  const parsedRound = parseRound(rawRoundData);
  const mergedRound = mergeRoundDataWithFallback({
    roundId: currentRoundId,
    round: parsedRound,
    fallback: fallbackOpenRound,
  });
  const optimisticDeltaReflected = isOptimisticRoundDeltaReflected({
    optimisticDelta,
    round: mergedRound.round,
    roundId: mergedRound.roundId,
  });
  const effectiveOptimisticDelta = optimisticDeltaReflected ? undefined : optimisticDelta;
  const previewStartsNewRound = previewRoundId > 0n && (currentRoundId === 0n || previewRoundId !== currentRoundId);
  const currentOpenRoundId = currentRoundId > 0n ? currentRoundId : 0n;
  const roundId = previewStartsNewRound ? previewRoundId : currentOpenRoundId;
  const round = roundId === mergedRound.roundId ? mergedRound.round : undefined;
  const fallbackConfig =
    fallbackRoundConfig ?? (fallbackOpenRound ? parseVotingConfig(fallbackOpenRound) : protocolConfig);
  const config =
    currentOpenRoundId > 0n && roundId === currentOpenRoundId
      ? parseVotingConfig(rawRoundConfigSnapshot ?? fallbackConfig)
      : fallbackConfig;

  const snapshot = deriveRoundSnapshot({
    roundId,
    round,
    config,
    optimisticDelta: effectiveOptimisticDelta,
    previewRoundId,
    previewStartsNewRound,
    now,
  });

  useEffect(() => {
    if (contentId === undefined || !optimisticDeltaReflected) {
      return;
    }

    clearOptimisticVote(contentId);
  }, [clearOptimisticVote, contentId, optimisticDeltaReflected]);

  return {
    ...snapshot,
    isLoading:
      contentId !== undefined &&
      (isPreviewRoundIdLoading ||
        isRoundIdLoading ||
        (currentOpenRoundId > 0n && (isRoundLoading || isRoundConfigLoading))),
    isReady:
      contentId !== undefined &&
      !isPreviewRoundIdLoading &&
      !isRoundIdLoading &&
      !isRoundLoading &&
      !isRoundConfigLoading,
  };
}

export type RoundSnapshot = ReturnType<typeof useRoundSnapshot>;
