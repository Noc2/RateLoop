type HandoffRoundDurationDraft = {
  roundBlindSeconds: string;
  roundMaxDurationSeconds: string;
  roundMaxDurationOverridden: boolean;
};

function secondsToHandoffDurationInput(value: bigint): string {
  return value > 0n ? value.toString() : "1";
}

export function readHandoffRoundDurationDraft(
  epochDuration: bigint,
  _maxDuration: bigint,
  _draftRevision: number,
): HandoffRoundDurationDraft {
  const roundBlindSeconds = secondsToHandoffDurationInput(epochDuration);

  return {
    roundBlindSeconds,
    roundMaxDurationSeconds: roundBlindSeconds,
    roundMaxDurationOverridden: false,
  };
}

export function syncHandoffMaxDurationForBlindChange(
  blindSeconds: number,
  _currentMaxDurationSeconds: string,
  _maxDurationOverridden: boolean,
  _bounds: { min: number; max: number },
): string {
  return String(Math.max(1, Math.floor(blindSeconds)));
}

export function resolveHandoffSubmittedMaxDurationSeconds(
  blindSeconds: bigint,
  _maxDurationSeconds: string,
  _maxDurationOverridden: boolean,
): bigint {
  return blindSeconds;
}
