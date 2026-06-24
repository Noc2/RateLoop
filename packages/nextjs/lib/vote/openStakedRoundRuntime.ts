import { deriveRoundCommitTargetRound } from "./roundVoteRuntime";
import type { RoundVoteContractCall } from "./roundVoteTransactionPlan";
import { deriveCommitVoteRuntimeNowMs } from "./tlockCommitTiming";
import type { Address, PublicClient } from "viem";

export const PREPARING_ROUND_VOTE_MESSAGE = "Preparing vote. Try again in a moment.";

const DEFAULT_OPEN_STAKED_ROUND_RETRY_DELAYS_MS = [250, 500, 1_000, 1_500] as const;

type OpenableStakedRoundRuntime = {
  requiresOpenRound: boolean;
};

export type PostOpenPredictableRuntime = {
  baseTotalStake: bigint;
  baseVoteCount: bigint;
  drandChainHash: `0x${string}`;
  drandGenesisTimeSeconds: bigint;
  drandPeriodSeconds: bigint;
  epochDuration: number;
  now: () => number;
  requiresOpenRound: boolean;
  roundId: bigint;
  roundReferenceRatingBps: number;
  roundStartTimeSeconds: number | null;
  targetRound?: bigint | number;
};

export function predictPostOpenRoundRuntime<Runtime extends PostOpenPredictableRuntime>(params: {
  latestBlockTimestampSeconds: number;
  runtime: Runtime;
}): Runtime {
  const latestBlockTimestampSeconds = Math.max(0, Math.floor(params.latestBlockTimestampSeconds));
  const predictedRoundStartTimeSeconds = latestBlockTimestampSeconds + 1;
  const runtimeNowMs = deriveCommitVoteRuntimeNowMs({
    latestBlockTimestampSeconds,
    epochDurationSeconds: params.runtime.epochDuration,
    roundStartTimeSeconds: predictedRoundStartTimeSeconds,
  });
  const targetRound = deriveRoundCommitTargetRound({
    drandGenesisTimeSeconds: params.runtime.drandGenesisTimeSeconds,
    drandPeriodSeconds: params.runtime.drandPeriodSeconds,
    epochDurationSeconds: params.runtime.epochDuration,
    roundStartTimeSeconds: predictedRoundStartTimeSeconds,
    runtimeTimestampSeconds: latestBlockTimestampSeconds,
  });

  return {
    ...params.runtime,
    baseTotalStake: 0n,
    baseVoteCount: 0n,
    now: () => runtimeNowMs,
    requiresOpenRound: false,
    roundStartTimeSeconds: predictedRoundStartTimeSeconds,
    ...(targetRound != null ? { targetRound } : {}),
  };
}

export async function preflightRoundVoteBatchCalls(params: {
  account: Address;
  calls: RoundVoteContractCall[];
  publicClient: PublicClient;
  simulatePlannedCall: (call: RoundVoteContractCall) => Promise<void>;
}): Promise<boolean> {
  const includesOpenRound = params.calls.some(call => call.kind === "openRound");

  if (includesOpenRound && typeof params.publicClient.simulateCalls === "function") {
    try {
      const { results } = await params.publicClient.simulateCalls({
        account: params.account,
        calls: params.calls.map(call => {
          if (call.data) {
            return {
              to: call.address,
              data: call.data,
              ...(typeof call.value !== "undefined" ? { value: call.value } : {}),
            };
          }

          return {
            to: call.address,
            abi: call.abi,
            args: call.args as readonly unknown[],
            functionName: call.functionName,
            ...(typeof call.value !== "undefined" ? { value: call.value } : {}),
          };
        }),
      });

      return results.every(result => result.status === "success");
    } catch {
      // Fall through to per-call simulateContract checks.
    }
  }

  try {
    for (const call of params.calls) {
      await params.simulatePlannedCall(call);
    }
    return true;
  } catch {
    return false;
  }
}

const sleep = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));

export async function ensureOpenStakedRoundRuntime<Runtime extends OpenableStakedRoundRuntime>({
  buildOpenedRuntimeFallback,
  openRound,
  resolveRuntime,
  retryDelaysMs = DEFAULT_OPEN_STAKED_ROUND_RETRY_DELAYS_MS,
  wait = sleep,
}: {
  buildOpenedRuntimeFallback?: (runtime: Runtime) => Runtime | null;
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

  const openedRuntimeFallback = buildOpenedRuntimeFallback?.(runtime);
  if (openedRuntimeFallback) {
    return openedRuntimeFallback;
  }

  const error = new Error(PREPARING_ROUND_VOTE_MESSAGE);
  if (lastResolveError) {
    (error as Error & { cause?: unknown }).cause = lastResolveError;
  }
  throw error;
}
