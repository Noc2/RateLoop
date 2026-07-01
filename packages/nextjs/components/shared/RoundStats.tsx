"use client";

import React from "react";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { useContentLabel } from "~~/hooks/useCategoryRegistry";
import type { RoundSnapshot } from "~~/hooks/useRoundSnapshot";
import { formatLrepAmount } from "~~/lib/vote/voteIncentives";
import { type VoteUiConfig, getRevealedDirectionLabels } from "~~/lib/vote/voteUiConfig";

interface RoundStatsProps {
  categoryId?: bigint;
  snapshot: RoundSnapshot;
}

interface RoundRevealedBreakdownProps {
  snapshot: RoundSnapshot;
  stacked?: boolean;
  voteUiConfig?: VoteUiConfig;
}

interface RoundStatMetric {
  label: string;
  value: string;
  tooltip: string;
}

function RoundStatSeparator() {
  return <div className="h-4 w-px bg-base-content/10" aria-hidden="true" />;
}

function RoundStatItem({ label, value, tooltip }: RoundStatMetric) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1">
        {label}
        <InfoTooltip text={tooltip} position="bottom" />
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function formatRaterProgress(voteCount: number, minimumRaters: number): string {
  return `${voteCount}/${minimumRaters}`;
}

export function shouldHidePendingRoundStats(
  snapshot: Pick<RoundSnapshot, "hasRound" | "phase" | "voteCount" | "willStartNewRound">,
) {
  return snapshot.willStartNewRound || !snapshot.hasRound || (snapshot.phase === "voting" && snapshot.voteCount === 0);
}

export function RoundRevealedBreakdown({
  snapshot,
  stacked = false,
  voteUiConfig = { mode: "thumbs" },
}: RoundRevealedBreakdownProps) {
  const { round, isLoading } = snapshot;
  const { up: upLabel, down: downLabel } = getRevealedDirectionLabels(voteUiConfig);

  if (isLoading) return null;

  const revealedCount = round.revealedCount;
  if (revealedCount <= 0) return null;

  const upCount = Number(round.upCount);
  const downCount = Number(round.downCount);

  if (stacked) {
    return (
      <div className="flex w-full max-w-full flex-col gap-1.5 text-base-content/60">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-left">
          <span>{upLabel}</span>
          <span className="font-semibold tabular-nums">{formatLrepAmount(round.upPool)} LREP</span>
          <span className="text-sm text-base-content/60">
            {upCount} signal{upCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-left">
          <span>{downLabel}</span>
          <span className="font-semibold tabular-nums">{formatLrepAmount(round.downPool)} LREP</span>
          <span className="text-sm text-base-content/60">
            {downCount} signal{downCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-full items-center gap-3">
      <div className="inline-flex min-w-0 flex-1 items-center justify-start gap-2 whitespace-nowrap text-left text-base-content/60">
        <span className="font-semibold">{upLabel}</span>
        <span className="font-semibold tabular-nums">{formatLrepAmount(round.upPool)} LREP</span>
        <span className="text-xs text-base-content/60">
          {upCount} signal{upCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="h-4 w-px shrink-0 bg-base-content/10" />
      <div className="inline-flex min-w-0 flex-1 items-center justify-end gap-2 whitespace-nowrap text-right text-base-content/60">
        <span className="font-semibold">{downLabel}</span>
        <span className="font-semibold tabular-nums">{formatLrepAmount(round.downPool)} LREP</span>
        <span className="text-xs text-base-content/60">
          {downCount} signal{downCount === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

/**
 * Displays stake and signal statistics for the current round on a specific content.
 *
 * Blind signal model:
 * - During blind phase: signals are encrypted and hidden. Only totalStake and voteCount are shown.
 * - After blind phase: the system reveals signals. Revealed pool breakdown is shown.
 */
export function RoundStats({ categoryId, snapshot }: RoundStatsProps) {
  const contentLabel = useContentLabel(categoryId);
  const { round, hasRound, isLoading, maxVoters, isRoundFull, phase } = snapshot;

  if (isLoading && !hasRound) {
    return (
      <div className="flex flex-col gap-2 py-2 text-base animate-pulse">
        <div className="flex items-center gap-3">
          <div className="h-4 w-20 rounded bg-base-content/10" />
          <div className="h-4 w-px bg-base-content/10" />
          <div className="h-4 w-14 rounded bg-base-content/10" />
        </div>
      </div>
    );
  }

  if (shouldHidePendingRoundStats(snapshot)) {
    return null;
  }

  const voteCount = Number(round.voteCount);
  const minimumRaters = snapshot.minVoters;
  const votesNeeded = Math.max(0, minimumRaters - voteCount);
  const raterTooltip =
    votesNeeded > 0
      ? `${voteCount} of ${minimumRaters} minimum staked raters have committed. ${votesNeeded} more staked private or revealed signal${votesNeeded === 1 ? "" : "s"} needed.`
      : `${voteCount} staked raters have committed, meeting the ${minimumRaters}-rater minimum.`;
  const statItems: RoundStatMetric[] = [
    {
      label: "Staked",
      value: formatLrepAmount(round.totalStake),
      tooltip: "Total LREP committed in the current round.",
    },
    {
      label: "Staked Raters",
      value: formatRaterProgress(voteCount, minimumRaters),
      tooltip: `${raterTooltip} Zero-LREP advisory votes do not count toward this settlement quorum on this ${contentLabel}.`,
    },
  ];

  return (
    <div className="flex flex-col gap-1.5 text-base text-base-content/60">
      <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
        {statItems.map((item, index) => (
          <React.Fragment key={item.label}>
            {index > 0 ? <RoundStatSeparator /> : null}
            <RoundStatItem {...item} />
          </React.Fragment>
        ))}
      </div>

      {phase === "voting" && isRoundFull && (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-warning/80">
            Round full ({voteCount} / {maxVoters} staked raters)
            <InfoTooltip
              text="This round has reached the maximum rater limit. New signals cannot be added until a new round starts."
              position="bottom"
            />
          </span>
        </div>
      )}
    </div>
  );
}
