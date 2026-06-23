"use client";

import { useMemo } from "react";
import { AdvisoryVoteRecorderAbi } from "@rateloop/contracts/abis";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { type AdvisoryCommitAvailability, parseAdvisoryCommitAvailability } from "~~/lib/vote/advisoryVoteAvailability";

export function useAdvisoryVoteAvailabilities(contentIds: readonly bigint[], enabled = true) {
  const { targetNetwork } = useTargetNetwork();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const { data: advisoryVoteRecorderInfo, isLoading: isAdvisoryVoteRecorderLoading } = useDeployedContractInfo({
    contractName: "AdvisoryVoteRecorder",
  } as any);
  const uniqueContentIds = useMemo(
    () => Array.from(new Set(contentIds.map(contentId => contentId.toString()))).map(contentId => BigInt(contentId)),
    [contentIds],
  );
  const recorderAddress = advisoryVoteRecorderInfo?.address as `0x${string}` | undefined;
  const contentIdKey = useMemo(
    () => uniqueContentIds.map(contentId => contentId.toString()).join(","),
    [uniqueContentIds],
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      "advisoryVoteAvailabilities",
      targetNetwork.id,
      recorderAddress ?? null,
      address?.toLowerCase() ?? null,
      contentIdKey,
    ],
    enabled: enabled && !!publicClient && !!recorderAddress && uniqueContentIds.length > 0,
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
            return [contentId.toString(), parseAdvisoryCommitAvailability(result)] as const;
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
    isLoading: enabled && (isAdvisoryVoteRecorderLoading || isLoading || isFetching),
  };
}
