"use client";

import { type ReactNode } from "react";
import {
  CheckIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  LockClosedIcon,
  MinusIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import type { RoundSnapshot } from "~~/hooks/useRoundSnapshot";
import { getRoundProgressMessaging } from "~~/lib/vote/voteIncentives";

interface RoundProgressProps {
  snapshot: RoundSnapshot;
}

const TERMINAL_ROUND_TOOLTIPS = {
  settlementPending:
    "The public verdict is closed. LREP stake rewards wait for a finalized RBTS correlation snapshot before they can be claimed.",
  settled: "The round settled successfully. LREP rewards are ready when the wallet has an eligible revealed signal.",
  cancelled:
    "The round expired before enough signals were committed. All stakes are refunded. Check the round details below for stake and rater counts.",
  tied: "The round ended in a tie. All stakes are returned to raters.",
  revealFailed:
    "Commit quorum was reached, but not enough signals were revealed before the final reveal grace deadline. Revealed raters can claim refunds; unrevealed signals forfeit.",
} as const;

type RoundStatusChipTone = "success" | "warning" | "primary" | "muted";

const COLORED_STATUS_INFO_ICON_CLASS_NAME = "[&>svg]:text-[#050505]/70 [&>svg]:hover:text-[#050505]";
const MUTED_STATUS_INFO_ICON_CLASS_NAME = "[&>svg]:text-base-content/50 [&>svg]:hover:text-base-content/75";

function getRoundStatusChipClassName(tone: RoundStatusChipTone) {
  switch (tone) {
    case "success":
      return "reward-chip-brand-green";
    case "warning":
      return "reward-chip-brand-yellow";
    case "primary":
      return "reward-chip-brand-blue";
    case "muted":
    default:
      return "reward-chip-muted";
  }
}

function getRoundStatusInfoIconClassName(tone: RoundStatusChipTone) {
  return tone === "muted" ? MUTED_STATUS_INFO_ICON_CLASS_NAME : COLORED_STATUS_INFO_ICON_CLASS_NAME;
}

function RoundStatusChip({
  label,
  tooltip,
  tone,
  icon,
}: {
  label: string;
  tooltip: string;
  tone: RoundStatusChipTone;
  icon: ReactNode;
}) {
  return (
    <span className={`reward-chip reward-chip-label ${getRoundStatusChipClassName(tone)}`}>
      {icon}
      <span className="inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-0.5">{label}</span>
      <InfoTooltip text={tooltip} position="bottom" className={getRoundStatusInfoIconClassName(tone)} />
    </span>
  );
}

/**
 * Displays compact round progress for a content item.
 *
 * Active round shows the phase badge:
 * - Blind phase: Full reward weight (100%) — signals encrypted
 * - Open phase: Reduced reward weight (25%) — blind phase results now visible
 *
 * Terminal states: Resolved / Cancelled / Tied / Reveal failed
 */
export function RoundProgress({ snapshot }: RoundProgressProps) {
  const { phase, hasRound, isReady, readyToSettle, thresholdReachedAt, voteCount, minVoters } = snapshot;
  const progressMessaging = getRoundProgressMessaging(snapshot);

  if (!isReady && !hasRound) {
    return (
      <div className="flex items-center gap-2 text-base text-base-content/60">
        <span className="loading loading-spinner loading-xs" />
        <span>Loading round...</span>
      </div>
    );
  }

  if (phase === "none") {
    return null;
  }

  if (phase === "settled") {
    return (
      <RoundStatusChip
        label="Rewards ready"
        tooltip={TERMINAL_ROUND_TOOLTIPS.settled}
        tone="success"
        icon={<CheckIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      />
    );
  }

  if (phase === "settlementPending") {
    return (
      <RoundStatusChip
        label="Settlement pending"
        tooltip={TERMINAL_ROUND_TOOLTIPS.settlementPending}
        tone="primary"
        icon={<ClockIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      />
    );
  }

  if (phase === "cancelled") {
    return (
      <RoundStatusChip
        label="Cancelled"
        tooltip={TERMINAL_ROUND_TOOLTIPS.cancelled}
        tone="warning"
        icon={<XMarkIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      />
    );
  }

  if (phase === "tied") {
    return (
      <RoundStatusChip
        label="Tied"
        tooltip={TERMINAL_ROUND_TOOLTIPS.tied}
        tone="muted"
        icon={<MinusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      />
    );
  }

  if (phase === "revealFailed") {
    return (
      <RoundStatusChip
        label="Reveal failed"
        tooltip={TERMINAL_ROUND_TOOLTIPS.revealFailed}
        tone="warning"
        icon={<ExclamationTriangleIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      />
    );
  }

  return (
    <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap text-base text-base-content/75">
      {progressMessaging ? (
        <div className="flex items-center gap-1.5">
          <RoundStatusChip
            label={progressMessaging.badgeLabel}
            tooltip={progressMessaging.tooltip}
            tone={progressMessaging.badgeTone === "primary" ? "primary" : "warning"}
            icon={
              progressMessaging.badgeTone === "primary" ? (
                <LockClosedIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <EyeIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )
            }
          />
          {progressMessaging.detailLabel ? (
            <span
              className={`tabular-nums text-base ${
                progressMessaging.detailTone === "success"
                  ? "text-success"
                  : progressMessaging.detailTone === "warning"
                    ? "text-warning"
                    : progressMessaging.detailTone === "primary"
                      ? "text-primary/90"
                      : "text-base-content/75"
              }`}
            >
              {progressMessaging.detailLabel}
            </span>
          ) : null}
        </div>
      ) : null}

      {readyToSettle || thresholdReachedAt > 0 ? (
        <RoundStatusChip
          label="Ready to resolve"
          tooltip="Enough signals are revealed. Settlement is available once past-epoch reveal checks are satisfied."
          tone="warning"
          icon={<CheckIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        />
      ) : voteCount >= minVoters ? (
        <RoundStatusChip
          label="Waiting for reveals"
          tooltip="Enough signals are committed. Settlement follows once enough signals are revealed and past-epoch checks clear."
          tone="muted"
          icon={<EyeIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        />
      ) : null}
    </div>
  );
}
