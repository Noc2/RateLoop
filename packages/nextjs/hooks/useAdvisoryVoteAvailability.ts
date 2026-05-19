"use client";

import { useMemo } from "react";
import { AdvisoryVoteRecorderAbi } from "@rateloop/contracts/abis";
import { useReadContracts } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { type AdvisoryCommitAvailability, parseAdvisoryCommitAvailability } from "~~/lib/vote/advisoryVoteAvailability";

export function useAdvisoryVoteAvailabilities(contentIds: readonly bigint[], enabled = true) {
  const { targetNetwork } = useTargetNetwork();
  const { data: advisoryVoteRecorderInfo, isLoading: isAdvisoryVoteRecorderLoading } = useDeployedContractInfo({
    contractName: "AdvisoryVoteRecorder",
  } as any);
  const uniqueContentIds = useMemo(
    () => Array.from(new Set(contentIds.map(contentId => contentId.toString()))).map(contentId => BigInt(contentId)),
    [contentIds],
  );
  const recorderAddress = advisoryVoteRecorderInfo?.address as `0x${string}` | undefined;

  const { data, isLoading, isFetching } = useReadContracts({
    allowFailure: true,
    contracts:
      recorderAddress && enabled
        ? uniqueContentIds.map(contentId => ({
            address: recorderAddress,
            abi: AdvisoryVoteRecorderAbi,
            functionName: "advisoryCommitAvailability",
            args: [contentId],
            chainId: targetNetwork.id,
          }))
        : [],
    query: {
      enabled: enabled && !!recorderAddress && uniqueContentIds.length > 0,
      refetchInterval: 10_000,
    },
  });

  const availabilityByContentId = useMemo(() => {
    const map = new Map<string, AdvisoryCommitAvailability>();
    uniqueContentIds.forEach((contentId, index) => {
      const result = data?.[index];
      if (result?.status !== "success") return;
      map.set(contentId.toString(), parseAdvisoryCommitAvailability(result.result));
    });
    return map;
  }, [data, uniqueContentIds]);

  return {
    availabilityByContentId,
    isLoading: enabled && (isAdvisoryVoteRecorderLoading || isLoading || isFetching),
  };
}
