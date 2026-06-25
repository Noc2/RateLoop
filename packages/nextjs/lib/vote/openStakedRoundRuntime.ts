import { deriveRoundCommitTargetRound } from "./roundVoteRuntime";
import type { RoundVoteContractCall } from "./roundVoteTransactionPlan";
import { deriveCommitVoteRuntimeNowMs } from "./tlockCommitTiming";
import type { Address, PublicClient } from "viem";

export const PREPARING_ROUND_VOTE_MESSAGE = "Preparing vote. Try again in a moment.";

const DEFAULT_OPEN_STAKED_ROUND_RETRY_DELAYS_MS = [250, 500, 1_000, 1_500] as const;

type OpenableStakedRoundRuntime = {
  requiresOpenRound: boolean;
};

export type RoundVoteBatchPreflightResult = {
  failedCallFunctionName?: string;
  failedCallIndex?: number;
  failedCallKind?: RoundVoteContractCall["kind"];
  failureReason?: "per-call-simulation-error" | "simulate-calls-error" | "simulate-calls-result-failed";
  includesOpenRound: boolean;
  message?: string;
  passed: boolean;
  resultStatus?: string;
  simulateCallsAvailable: boolean;
  simulateCallsFailureMessage?: string;
  simulateCallsFailureReason?: "simulate-calls-error";
  strategy: "per-call" | "simulate-calls";
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getSimulateCallsResultMessage(result: unknown) {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  const error = record.error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  if (typeof record.message === "string") return record.message;
  return undefined;
}

export async function preflightRoundVoteBatchCalls(params: {
  account: Address;
  calls: RoundVoteContractCall[];
  publicClient: PublicClient;
  simulatePlannedCall: (call: RoundVoteContractCall) => Promise<void>;
}): Promise<RoundVoteBatchPreflightResult> {
  const includesOpenRound = params.calls.some(call => call.kind === "openRound");
  const simulateCallsAvailable = typeof params.publicClient.simulateCalls === "function";
  let simulateCallsFailureMessage: string | undefined;

  if (includesOpenRound && simulateCallsAvailable) {
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

      const failedCallIndex = results.findIndex(result => result.status !== "success");
      if (failedCallIndex === -1) {
        return {
          includesOpenRound,
          passed: true,
          simulateCallsAvailable,
          strategy: "simulate-calls",
        };
      }

      const failedCall = params.calls[failedCallIndex];
      const failedResult = results[failedCallIndex];
      return {
        failedCallFunctionName: failedCall?.functionName,
        failedCallIndex,
        failedCallKind: failedCall?.kind,
        failureReason: "simulate-calls-result-failed",
        includesOpenRound,
        message: getSimulateCallsResultMessage(failedResult),
        passed: false,
        resultStatus: String(failedResult?.status ?? "unknown"),
        simulateCallsAvailable,
        strategy: "simulate-calls",
      };
    } catch (error) {
      simulateCallsFailureMessage = getErrorMessage(error);
      // Fall through to per-call simulateContract checks.
    }
  }

  let perCallIndex = 0;
  try {
    for (; perCallIndex < params.calls.length; perCallIndex += 1) {
      const call = params.calls[perCallIndex];
      await params.simulatePlannedCall(call);
    }
    return {
      includesOpenRound,
      passed: true,
      simulateCallsAvailable,
      ...(simulateCallsFailureMessage
        ? {
            simulateCallsFailureMessage,
            simulateCallsFailureReason: "simulate-calls-error" as const,
          }
        : {}),
      strategy: "per-call",
    };
  } catch (error) {
    const failedCall = params.calls[perCallIndex];
    return {
      failedCallFunctionName: failedCall?.functionName,
      failedCallIndex: perCallIndex,
      failedCallKind: failedCall?.kind,
      failureReason: "per-call-simulation-error",
      includesOpenRound,
      message: getErrorMessage(error),
      passed: false,
      simulateCallsAvailable,
      ...(simulateCallsFailureMessage
        ? {
            simulateCallsFailureMessage,
            simulateCallsFailureReason: "simulate-calls-error" as const,
          }
        : {}),
      strategy: "per-call",
    };
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
