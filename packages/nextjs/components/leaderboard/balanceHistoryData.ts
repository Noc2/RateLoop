import type { PonderTokenTransfer } from "~~/services/ponder/client";

interface BalanceHistoryPoint {
  timestamp: number;
  balance: number;
}

const LREP_DECIMALS = 1e6;

/**
 * Reconstruct a bounded transfer window backwards from the live on-chain balance.
 * The Ponder endpoint returns the newest transfers in chronological order, so an
 * address with more events than the endpoint limit cannot be reconstructed from
 * a zero balance.
 */
export function buildBalanceHistoryPoints(params: {
  address?: string;
  currentBalanceRaw?: bigint;
  transfers: readonly PonderTokenTransfer[];
}): BalanceHistoryPoint[] {
  if (!params.address || params.currentBalanceRaw === undefined || params.transfers.length === 0) {
    return [];
  }

  const address = params.address.toLowerCase();
  let balance = params.currentBalanceRaw;
  const newestFirstPoints: BalanceHistoryPoint[] = [];
  let newestTimestamp: number | null = null;

  for (let index = params.transfers.length - 1; index >= 0; index -= 1) {
    const transfer = params.transfers[index];
    const timestamp = Number(transfer.timestamp);
    const amount = BigInt(transfer.amount);

    // When multiple transfers share a timestamp, keep the balance after the
    // final transfer in that group, matching the chart's previous behaviour.
    if (timestamp !== newestTimestamp) {
      newestFirstPoints.push({
        timestamp,
        balance: Number(balance) / LREP_DECIMALS,
      });
      newestTimestamp = timestamp;
    }

    if (transfer.to.toLowerCase() === address) {
      balance -= amount;
    }
    if (transfer.from.toLowerCase() === address) {
      balance += amount;
    }
  }

  return newestFirstPoints.reverse();
}

export function formatLrepBalance(currentBalanceRaw?: bigint) {
  return Number(currentBalanceRaw ?? 0n) / LREP_DECIMALS;
}
