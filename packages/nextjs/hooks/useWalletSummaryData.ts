"use client";

import { Address } from "viem";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useActiveVotesWithDeadlines } from "~~/hooks/useActiveVotesWithDeadlines";
import { usePageVisibility } from "~~/hooks/usePageVisibility";
import { useSubmissionStakes } from "~~/hooks/useSubmissionStakes";
import { useVotingStakes } from "~~/hooks/useVotingStakes";
import { getWalletDisplayLiquidMicro, useWalletDisplaySummary } from "~~/hooks/useWalletDisplaySummary";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";

function toMicroUnits(value: number) {
  return BigInt(Math.round(value * 1e6));
}

export function useWalletSummaryData(address?: Address) {
  const { targetNetwork } = useTargetNetwork();
  const isPageVisible = usePageVisibility();
  const isLocalNetwork = targetNetwork.id === 31337;
  const { totalSubmissionStake } = useSubmissionStakes(address);
  const { activeStaked: votingStaked } = useVotingStakes(address);
  const { votes: activeVotes, earliestReveal, hasPendingReveals } = useActiveVotesWithDeadlines(address);

  const { data: lrepBalance } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "balanceOf",
    args: [address],
    watch: false,
    query: {
      enabled: !!address,
      staleTime: isLocalNetwork ? 0 : 60_000,
      refetchInterval: isPageVisible ? (isLocalNetwork ? 2_000 : 60_000) : false,
    },
  });

  const { data: frontendInfo } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "getFrontendInfo",
    args: [address],
    watch: false,
    query: {
      enabled: !!address,
      staleTime: isLocalNetwork ? 0 : 60_000,
      refetchInterval: isPageVisible ? (isLocalNetwork ? 2_000 : 60_000) : false,
    },
  });

  const fallbackVotingStakedMicro = activeVotes.reduce((sum, vote) => sum + BigInt(vote.stake), 0n);
  const indexedVotingStakedMicro = toMicroUnits(votingStaked);
  const votingStakedMicro =
    indexedVotingStakedMicro > fallbackVotingStakedMicro ? indexedVotingStakedMicro : fallbackVotingStakedMicro;

  const summary = useWalletDisplaySummary(
    address,
    !address || lrepBalance === undefined
      ? null
      : {
          liquidMicro: lrepBalance,
          votingStakedMicro,
          submissionStakedMicro: toMicroUnits(totalSubmissionStake),
          frontendStakedMicro: frontendInfo?.[1] ?? 0n,
        },
    targetNetwork.id,
  );

  return {
    activeVotes,
    lrepBalance,
    earliestReveal,
    hasPendingReveals,
    liquidBalance: getWalletDisplayLiquidMicro(summary, lrepBalance),
    summary,
  };
}
