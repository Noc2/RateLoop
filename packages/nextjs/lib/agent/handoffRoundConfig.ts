type HandoffRoundDurationDraft = {
  roundBlindSeconds: string;
  roundMaxDurationSeconds: string;
  roundMaxDurationOverridden: boolean;
};

function secondsToHandoffDurationInput(value: bigint): string {
  return value > 0n ? value.toString() : "1";
}

export function readHandoffRoundDurationDraft(epochDuration: bigint): HandoffRoundDurationDraft {
  const roundBlindSeconds = secondsToHandoffDurationInput(epochDuration);

  return {
    roundBlindSeconds,
    roundMaxDurationSeconds: roundBlindSeconds,
    roundMaxDurationOverridden: false,
  };
}

export function syncHandoffMaxDurationForBlindChange(blindSeconds: number): string {
  return String(Math.max(1, Math.floor(blindSeconds)));
}

export function resolveHandoffSubmittedMaxDurationSeconds(blindSeconds: bigint): bigint {
  return blindSeconds;
}
