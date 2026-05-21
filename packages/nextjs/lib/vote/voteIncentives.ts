import { BPS_SCALE, EPOCH_WEIGHT_BPS, REWARD_SPLIT_BPS } from "@rateloop/contracts/protocol";
import type { RoundSnapshot } from "~~/lib/contracts/roundVotingEngine";

const VOTER_POOL_SHARE_BPS = REWARD_SPLIT_BPS.voter;
type ProgressTone = "primary" | "warning" | "success" | "neutral";

type IncentiveSnapshot = Pick<
  RoundSnapshot,
  | "phase"
  | "isEpoch1"
  | "epoch1Remaining"
  | "readyToSettle"
  | "thresholdReachedAt"
  | "voteCount"
  | "revealedCount"
  | "minVoters"
  | "upPool"
  | "downPool"
  | "weightedUpPool"
  | "weightedDownPool"
>;

interface RoundProgressMessaging {
  badgeLabel: string;
  badgeTone: ProgressTone;
  detailLabel: string | null;
  detailTone: ProgressTone;
  tooltip: string;
}

interface VoteReturnEstimate {
  effectiveStakeMicro: bigint;
  projectedVoterPoolMicro: bigint;
  projectedPoolShareMicro: bigint;
  estimatedGrossReturnMicro: bigint;
  belowMeanFloorMicro: bigint;
}

function formatPreciseDuration(seconds: number): string {
  if (seconds <= 0) return "00:00";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function formatLrepAmount(amountMicro: bigint | number, maximumFractionDigits = 1): string {
  const value = typeof amountMicro === "bigint" ? Number(amountMicro) / 1e6 : amountMicro;
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

export function describeOpenRoundActivity(
  snapshot: Pick<RoundSnapshot, "minVoters" | "revealedCount" | "totalStake" | "voteCount">,
) {
  const revealsNeeded = Math.max(0, snapshot.minVoters - snapshot.revealedCount);
  if (revealsNeeded > 0) {
    return `${formatLrepAmount(snapshot.totalStake)} LREP active · ${revealsNeeded} more revealed signal${revealsNeeded === 1 ? "" : "s"} to settle.`;
  }

  return `${formatLrepAmount(snapshot.totalStake)} LREP active · Settlement threshold is in reach.`;
}

export function getRoundProgressMessaging(snapshot: IncentiveSnapshot): RoundProgressMessaging | null {
  if (snapshot.phase !== "voting") {
    return null;
  }

  if (snapshot.isEpoch1) {
    const urgencyLabel =
      snapshot.epoch1Remaining > 0 ? `${formatPreciseDuration(snapshot.epoch1Remaining)} left` : "Predict early";

    return {
      badgeLabel: "Blind",
      badgeTone: "primary",
      detailLabel: urgencyLabel,
      detailTone: snapshot.epoch1Remaining <= 15 * 60 ? "warning" : "primary",
      tooltip:
        "Blind signals stay hidden and earn full reward weight. Open-phase signals use 25% informed weight, so early raters keep the 4x advantage.",
    };
  }

  const revealsNeeded = Math.max(0, snapshot.minVoters - snapshot.revealedCount);

  if (snapshot.readyToSettle || snapshot.thresholdReachedAt > 0) {
    return {
      badgeLabel: "Open",
      badgeTone: "warning",
      detailLabel: "Near settlement",
      detailTone: "success",
      tooltip:
        "Open signals can see live pools and revealed signal. Informed signals use 25% weight, but they help push rounds to settlement faster.",
    };
  }

  if (revealsNeeded > 0) {
    return {
      badgeLabel: "Open",
      badgeTone: "warning",
      detailLabel: `${revealsNeeded} more revealed signal${revealsNeeded === 1 ? "" : "s"} to settle`,
      detailTone: revealsNeeded === 1 ? "success" : "warning",
      tooltip:
        "Open signals can use the revealed market signal. Settlement starts once enough signals are revealed and past-epoch checks clear.",
    };
  }

  return {
    badgeLabel: "Open",
    badgeTone: "warning",
    detailLabel: "Help settle this round",
    detailTone: "success",
    tooltip:
      "Open signals can use the revealed market signal. Informed signals use 25% weight, but they often help rounds close faster.",
  };
}

function getEpochWeightBps(isEpoch1: boolean) {
  return isEpoch1 ? EPOCH_WEIGHT_BPS.blind : EPOCH_WEIGHT_BPS.informed;
}

export function estimateVoteReturn(
  snapshot: Pick<IncentiveSnapshot, "isEpoch1" | "upPool" | "downPool" | "weightedUpPool" | "weightedDownPool">,
  isUp: boolean,
  stakeAmount: number,
): VoteReturnEstimate {
  const stakeMicro = BigInt(Math.round(stakeAmount * 1e6));
  const effectiveStakeMicro = (stakeMicro * BigInt(getEpochWeightBps(snapshot.isEpoch1))) / BigInt(BPS_SCALE);
  const losingPoolMicro = isUp ? snapshot.downPool : snapshot.upPool;
  const currentWinningWeightedMicro = isUp ? snapshot.weightedUpPool : snapshot.weightedDownPool;
  const projectedWinningWeightedMicro = currentWinningWeightedMicro + effectiveStakeMicro;
  const projectedVoterPoolMicro = (losingPoolMicro * BigInt(VOTER_POOL_SHARE_BPS)) / BigInt(BPS_SCALE);
  const projectedPoolShareMicro =
    projectedWinningWeightedMicro > 0n
      ? (effectiveStakeMicro * projectedVoterPoolMicro) / projectedWinningWeightedMicro
      : 0n;
  const estimatedGrossReturnMicro = stakeMicro + projectedPoolShareMicro;

  return {
    effectiveStakeMicro,
    projectedVoterPoolMicro,
    projectedPoolShareMicro,
    estimatedGrossReturnMicro,
    belowMeanFloorMicro: 0n,
  };
}
