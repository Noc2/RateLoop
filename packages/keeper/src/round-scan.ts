let nextHistoricalRoundId = 0n;
let highestObservedRoundId = 0n;
let singleSlotHistoryTurn = false;

export function resetRoundScanStateForTests() {
  nextHistoricalRoundId = 0n;
  highestObservedRoundId = 0n;
  singleSlotHistoryTurn = false;
}

/**
 * Selects a bounded mix of the newest tip and a persistent historical sweep.
 * New arrivals may be adversarially unbounded, so for budgets above one they
 * can consume at most half the tick. A one-slot worker alternates lanes when
 * both have work. The tip is selected newest-first; new IDs skipped by that
 * bounded lane remain reachable by the historical cursor.
 */
export function scanRoundIds(nextRoundId: bigint, maxRounds: number) {
  const total = nextRoundId - 1n;
  if (total <= 0n || maxRounds <= 0) return [];
  const count = Math.min(maxRounds, Number(total));
  const ids: bigint[] = [];
  const selected = new Set<bigint>();

  if (highestObservedRoundId === 0n) {
    ids.push(total);
    selected.add(total);
    highestObservedRoundId = total;
    nextHistoricalRoundId = total === 1n ? 1n : total - 1n;
    singleSlotHistoryTurn = true;
  } else {
    const hasNewRounds = total > highestObservedRoundId;
    const tipQuota =
      !hasNewRounds || (count === 1 && singleSlotHistoryTurn)
        ? 0
        : count === 1
          ? 1
          : Math.floor(count / 2);

    for (let offset = 0; offset < tipQuota; offset += 1) {
      const candidate = total - BigInt(offset);
      if (candidate <= highestObservedRoundId) break;
      ids.push(candidate);
      selected.add(candidate);
    }
    if (tipQuota > 0) {
      highestObservedRoundId = total;
      singleSlotHistoryTurn = true;
    } else if (hasNewRounds && count === 1) {
      singleSlotHistoryTurn = false;
    } else if (!hasNewRounds) {
      singleSlotHistoryTurn = false;
    }
  }

  if (nextHistoricalRoundId === 0n || nextHistoricalRoundId > total) {
    nextHistoricalRoundId = total;
  }
  let historicalCandidatesChecked = 0n;
  while (ids.length < count && historicalCandidatesChecked < total) {
    const candidate = nextHistoricalRoundId;
    nextHistoricalRoundId = candidate === 1n ? total : candidate - 1n;
    historicalCandidatesChecked += 1n;
    if (!selected.has(candidate)) {
      ids.push(candidate);
      selected.add(candidate);
    }
  }

  return ids;
}
