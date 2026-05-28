export const PREPARING_ROUND_VOTE_MESSAGE = "Preparing vote. Try again in a moment.";

export const DEFAULT_OPEN_STAKED_ROUND_RETRY_DELAYS_MS = [250, 500, 1_000, 1_500] as const;

type OpenableStakedRoundRuntime = {
  requiresOpenRound: boolean;
};

const sleep = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));

export async function ensureOpenStakedRoundRuntime<Runtime extends OpenableStakedRoundRuntime>({
  openRound,
  resolveRuntime,
  retryDelaysMs = DEFAULT_OPEN_STAKED_ROUND_RETRY_DELAYS_MS,
  wait = sleep,
}: {
  openRound: () => Promise<void>;
  resolveRuntime: () => Promise<Runtime>;
  retryDelaysMs?: readonly number[];
  wait?: (delayMs: number) => Promise<void>;
}): Promise<Runtime> {
  const runtime = await resolveRuntime();
  if (!runtime.requiresOpenRound) {
    return runtime;
  }

  await openRound();

  let lastResolveError: unknown;
  const resolveObservedOpenRuntime = async () => {
    try {
      const freshRuntime = await resolveRuntime();
      if (!freshRuntime.requiresOpenRound) {
        return freshRuntime;
      }
    } catch (error) {
      lastResolveError = error;
    }

    return null;
  };

  const immediateRuntime = await resolveObservedOpenRuntime();
  if (immediateRuntime) {
    return immediateRuntime;
  }

  for (const delayMs of retryDelaysMs) {
    await wait(delayMs);
    const delayedRuntime = await resolveObservedOpenRuntime();
    if (delayedRuntime) {
      return delayedRuntime;
    }
  }

  const error = new Error(PREPARING_ROUND_VOTE_MESSAGE);
  if (lastResolveError) {
    (error as Error & { cause?: unknown }).cause = lastResolveError;
  }
  throw error;
}
