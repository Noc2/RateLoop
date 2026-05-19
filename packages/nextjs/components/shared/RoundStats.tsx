"use client";

import React from "react";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { useContentLabel } from "~~/hooks/useCategoryRegistry";
import type { RoundSnapshot } from "~~/hooks/useRoundSnapshot";
import { formatLrepAmount } from "~~/lib/vote/voteIncentives";

interface RoundStatsProps {
  categoryId?: bigint;
  snapshot: RoundSnapshot;
}

interface RoundRevealedBreakdownProps {
  snapshot: RoundSnapshot;
  stacked?: boolean;
}

function formatRoundCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function formatPrivateRoundHint(
  snapshot: Pick<RoundSnapshot, "phase" | "currentEpochRemaining" | "roundTimeRemaining">,
) {
  if (snapshot.phase !== "voting") return null;
  if (snapshot.roundTimeRemaining <= 0) return null;

  const remaining = Math.min(snapshot.currentEpochRemaining, snapshot.roundTimeRemaining);
  if (remaining <= 0) return null;

  return `Private round ends in ${formatRoundCountdown(remaining)}`;
}

export function formatRaterProgress(voteCount: number, minimumRaters: number): string {
  return `${voteCount}/${minimumRaters}`;
}

export function RoundRevealedBreakdown({ snapshot, stacked = false }: RoundRevealedBreakdownProps) {
  const { round, isLoading } = snapshot;

  if (isLoading) return null;

  const revealedCount = round.revealedCount;
  if (revealedCount <= 0) return null;

  const upCount = Number(round.upCount);
  const downCount = Number(round.downCount);

  if (stacked) {
    return (
      <div className="flex w-full max-w-full flex-col gap-1.5 text-base-content/60">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-left">
          <span>Up</span>
          <span className="font-semibold tabular-nums">{formatLrepAmount(round.upPool)} LREP</span>
          <span className="text-sm text-base-content/60">
            {upCount} signal{upCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-left">
          <span>Down</span>
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
        <span className="font-semibold">Up</span>
        <span className="font-semibold tabular-nums">{formatLrepAmount(round.upPool)} LREP</span>
        <span className="text-xs text-base-content/60">
          {upCount} signal{upCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="h-4 w-px shrink-0 bg-base-content/10" />
      <div className="inline-flex min-w-0 flex-1 items-center justify-end gap-2 whitespace-nowrap text-right text-base-content/60">
        <span className="font-semibold">Down</span>
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

  const voteCount = Number(round.voteCount);
  const minimumRaters = snapshot.minVoters;
  const privateRoundHint = formatPrivateRoundHint(snapshot);
  const votesNeeded = Math.max(0, minimumRaters - voteCount);
  const raterTooltip =
    votesNeeded > 0
      ? `${voteCount} of ${minimumRaters} minimum staked raters have committed. ${votesNeeded} more staked private or revealed signal${votesNeeded === 1 ? "" : "s"} needed.`
      : `${voteCount} staked raters have committed, meeting the ${minimumRaters}-rater minimum.`;

  return (
    <div className="flex flex-col gap-1.5 text-base text-base-content/60">
      <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            Staked
            <InfoTooltip text="Total LREP committed in the current round." position="bottom" />
          </span>
          <span className="font-semibold tabular-nums">{formatLrepAmount(round.totalStake)}</span>
        </div>
        <div className="h-4 w-px bg-base-content/10" />
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            Staked Raters
            <InfoTooltip
              text={`${raterTooltip} Zero-LREP advisory votes do not count toward this settlement quorum on this ${contentLabel}.`}
              position="bottom"
            />
          </span>
          <span className="font-semibold tabular-nums">{formatRaterProgress(voteCount, minimumRaters)}</span>
        </div>
        {privateRoundHint ? (
          <>
            <div className="h-4 w-px bg-base-content/10" />
            <span>{privateRoundHint}</span>
          </>
        ) : null}
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

      {phase === "settled" && (
        <div className="flex items-center gap-1 text-success">
          <span>Rewards distributed</span>
          <InfoTooltip
            text="Rewards are proportional to phase-weighted stake. Blind signals earned the 4x early-rater advantage."
            position="bottom"
          />
        </div>
      )}

      {phase === "cancelled" && (
        <div className="flex items-center gap-1 text-warning/80">
          <span>Round expired — full refund available</span>
          <InfoTooltip
            text="The round expired before enough signals were committed. All stakes are refunded."
            position="bottom"
          />
        </div>
      )}

      {phase === "tied" && (
        <div className="flex items-center gap-1 text-base-content/60">
          <span>Tied — all stakes returned</span>
          <InfoTooltip text="The round ended in a tie. All stakes are returned to raters." position="bottom" />
        </div>
      )}

      {phase === "revealFailed" && (
        <div className="flex items-center gap-1 text-warning/80">
          <span>Reveal failed — only revealed signals can refund</span>
          <InfoTooltip
            text="Commit quorum was reached, but not enough signals were revealed before the final reveal grace deadline. Revealed raters can claim refunds; unrevealed signals forfeit."
            position="bottom"
          />
        </div>
      )}
    </div>
  );
}
