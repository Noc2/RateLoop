import { type QuestionRoundConfigBounds, getQuestionRoundMaxDurationForEpoch } from "~~/lib/questionRoundConfig";

export type HandoffRoundDurationDraft = {
  roundBlindSeconds: string;
  roundMaxDurationSeconds: string;
  roundMaxDurationOverridden: boolean;
};

function parseWholeNumberInput(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return 0;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export function secondsToHandoffDurationInput(value: bigint): string {
  return value > 0n ? value.toString() : "1";
}

export function getHandoffRoundMaxDurationSecondBoundsForBlind(
  blindSeconds: number,
  bounds: QuestionRoundConfigBounds,
) {
  const normalizedBlindSeconds = Math.max(1, Math.floor(blindSeconds));
  const maxDurationSeconds = getQuestionRoundMaxDurationForEpoch(normalizedBlindSeconds, bounds.maxRoundDuration);
  const min = Math.max(bounds.minRoundDuration, normalizedBlindSeconds);
  const max = Math.max(min, Math.floor(maxDurationSeconds));
  return { min, max };
}

/**
 * Fresh agent handoffs normalize max duration to the blind window. Saved browser drafts
 * preserve an explicit max duration override once draftRevision > 0.
 */
export function readHandoffRoundDurationDraft(
  epochDuration: bigint,
  maxDuration: bigint,
  draftRevision: number,
): HandoffRoundDurationDraft {
  const roundBlindSeconds = secondsToHandoffDurationInput(epochDuration);
  const hasSavedDraft = draftRevision > 0;
  const roundMaxDurationOverridden = hasSavedDraft && maxDuration !== epochDuration;
  const roundMaxDurationSeconds = roundMaxDurationOverridden
    ? secondsToHandoffDurationInput(maxDuration)
    : roundBlindSeconds;

  return {
    roundBlindSeconds,
    roundMaxDurationSeconds,
    roundMaxDurationOverridden,
  };
}

export function syncHandoffMaxDurationForBlindChange(
  blindSeconds: number,
  currentMaxDurationSeconds: string,
  maxDurationOverridden: boolean,
  bounds: { min: number; max: number },
): string {
  const parsedCurrent = parseWholeNumberInput(currentMaxDurationSeconds);
  const currentValue = !maxDurationOverridden ? blindSeconds : parsedCurrent;
  return String(Math.min(Math.max(currentValue, bounds.min), bounds.max));
}

export function resolveHandoffSubmittedMaxDurationSeconds(
  blindSeconds: bigint,
  maxDurationSeconds: string,
  maxDurationOverridden: boolean,
): bigint {
  if (!maxDurationOverridden) {
    return blindSeconds;
  }

  const parsed = parseWholeNumberInput(maxDurationSeconds);
  if (parsed <= 0) {
    return blindSeconds;
  }

  return BigInt(parsed);
}
