"use client";

import { useMemo } from "react";
import { AdvisoryVoteRecorderAbi, RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useRaterRegistryIdentity } from "~~/hooks/useRaterRegistryIdentity";
import {
  ADVISORY_COMMIT_AVAILABILITY_STATUS,
  type AdvisoryCommitAvailability,
  parseAdvisoryCommitAvailability,
} from "~~/lib/vote/advisoryVoteAvailability";
import { hasNonZeroCommit } from "~~/lib/vote/commitState";

export function useAdvisoryVoteAvailabilities(contentIds: readonly bigint[], enabled = true) {
  const { targetNetwork } = useTargetNetwork();
  const { address } = useAccount();
  const { holder, identityKey } = useRaterRegistryIdentity(address);
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const { data: advisoryVoteRecorderInfo, isLoading: isAdvisoryVoteRecorderLoading } = useDeployedContractInfo({
    contractName: "AdvisoryVoteRecorder",
  } as any);
  const { data: votingEngineInfo, isLoading: isVotingEngineLoading } = useDeployedContractInfo({
    contractName: "RoundVotingEngine",
  } as any);
  const uniqueContentIds = useMemo(
    () => Array.from(new Set(contentIds.map(contentId => contentId.toString()))).map(contentId => BigInt(contentId)),
    [contentIds],
  );
  const recorderAddress = advisoryVoteRecorderInfo?.address as `0x${string}` | undefined;
  const votingEngineAddress = votingEngineInfo?.address as `0x${string}` | undefined;
  const normalizedAddress = address?.toLowerCase() ?? null;
  const holderAddress = holder && holder.toLowerCase() !== normalizedAddress ? holder : null;
  const contentIdKey = useMemo(
    () => uniqueContentIds.map(contentId => contentId.toString()).join(","),
    [uniqueContentIds],
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      "advisoryVoteAvailabilities",
      targetNetwork.id,
      recorderAddress ?? null,
      votingEngineAddress ?? null,
      address?.toLowerCase() ?? null,
      holderAddress?.toLowerCase() ?? null,
      identityKey ?? null,
      contentIdKey,
    ],
    enabled: enabled && !!publicClient && !!recorderAddress && !!votingEngineAddress && uniqueContentIds.length > 0,
    refetchInterval: 10_000,
    queryFn: async () => {
      const entries = await Promise.all(
        uniqueContentIds.map(async contentId => {
          try {
            const result = await publicClient!.readContract({
              account: address,
              address: recorderAddress!,
              abi: AdvisoryVoteRecorderAbi,
              functionName: "advisoryCommitAvailability",
              args: [contentId],
            });
            const availability = parseAdvisoryCommitAvailability(result);
            if (address && availability.canCommit && availability.roundId > 0n) {
              const commitReads: Promise<unknown>[] = [
                publicClient!.readContract({
                  address: votingEngineAddress!,
                  abi: RoundVotingEngineAbi,
                  functionName: "voterCommitKey",
                  args: [contentId, availability.roundId, address],
                }),
                publicClient!.readContract({
                  address: recorderAddress!,
                  abi: AdvisoryVoteRecorderAbi,
                  functionName: "advisoryCommitKeyByRater",
                  args: [contentId, availability.roundId, address],
                }),
              ];

              if (holderAddress) {
                commitReads.push(
                  publicClient!.readContract({
                    address: votingEngineAddress!,
                    abi: RoundVotingEngineAbi,
                    functionName: "voterCommitKey",
                    args: [contentId, availability.roundId, holderAddress],
                  }),
                );
                commitReads.push(
                  publicClient!.readContract({
                    address: recorderAddress!,
                    abi: AdvisoryVoteRecorderAbi,
                    functionName: "advisoryCommitKeyByRater",
                    args: [contentId, availability.roundId, holderAddress],
                  }),
                );
              }

              if (identityKey) {
                commitReads.push(
                  publicClient!.readContract({
                    address: votingEngineAddress!,
                    abi: RoundVotingEngineAbi,
                    functionName: "identityCommitState",
                    args: [contentId, availability.roundId, identityKey, holder ?? address],
                  }),
                );
                commitReads.push(
                  publicClient!.readContract({
                    address: recorderAddress!,
                    abi: AdvisoryVoteRecorderAbi,
                    functionName: "advisoryCommitKeyByIdentity",
                    args: [contentId, availability.roundId, identityKey],
                  }),
                );
              }

              const commitResults = await Promise.allSettled(commitReads);
              if (commitResults.some(result => result.status === "fulfilled" && hasNonZeroCommit(result.value))) {
                return [
                  contentId.toString(),
                  {
                    ...availability,
                    canCommit: false,
                    status: ADVISORY_COMMIT_AVAILABILITY_STATUS.AlreadyCommitted,
                  },
                ] as const;
              }
            }

            return [contentId.toString(), availability] as const;
          } catch {
            return null;
          }
        }),
      );

      return entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    },
  });

  const availabilityByContentId = useMemo(() => {
    return new Map<string, AdvisoryCommitAvailability>(data ?? []);
  }, [data]);

  return {
    availabilityByContentId,
    isLoading: enabled && (isAdvisoryVoteRecorderLoading || isVotingEngineLoading || isLoading || isFetching),
  };
}
