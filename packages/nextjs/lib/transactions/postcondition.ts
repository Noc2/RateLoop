export type TransactionPostconditionWaitOptions = {
  onEvent?: (event: string, extra?: Record<string, unknown>) => void;
  pollingIntervalMs: number;
  shouldStop?: () => boolean;
  slowMs?: number;
  timeoutMs?: number;
};

type TransactionPostconditionRaceResult<T> =
  | { confirmation: "transaction"; result: T }
  | { confirmation: "postcondition"; result: undefined }
  | { confirmation: "transaction-after-postcondition-timeout"; result: T };

type TransactionPostconditionRaceCompletion<T> =
  | { kind: "transaction"; result: T }
  | { kind: "postcondition" }
  | { kind: "timeout" };

const DEFAULT_POSTCONDITION_TIMEOUT_MS = 20_000;
const DEFAULT_POSTCONDITION_SLOW_MS = 4_000;

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForTransactionPostcondition(
  checkPostcondition: () => Promise<boolean>,
  eventPrefix: string,
  options: TransactionPostconditionWaitOptions,
) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_POSTCONDITION_TIMEOUT_MS;
  const slowMs = options.slowMs ?? DEFAULT_POSTCONDITION_SLOW_MS;
  const startedAt = Date.now();
  let pollCount = 0;
  let slowLogged = false;

  options.onEvent?.(`${eventPrefix}-wait-start`);

  for (;;) {
    if (options.shouldStop?.()) {
      return false;
    }

    pollCount += 1;
    try {
      if (await checkPostcondition()) {
        options.onEvent?.(`${eventPrefix}-wait-complete`, { pollCount });
        return true;
      }
    } catch (error) {
      options.onEvent?.(`${eventPrefix}-poll-error`, {
        message: error instanceof Error ? error.message : "Unknown error",
        pollCount,
      });
    }

    const elapsedMs = Date.now() - startedAt;
    if (!slowLogged && elapsedMs >= slowMs) {
      slowLogged = true;
      options.onEvent?.(`${eventPrefix}-wait-slow`, { pollCount });
    }
    if (elapsedMs >= timeoutMs) {
      options.onEvent?.(`${eventPrefix}-wait-timeout`, { pollCount });
      return false;
    }

    await delay(Math.max(200, Math.min(options.pollingIntervalMs, timeoutMs - elapsedMs)));
  }
}

export async function raceTransactionWithPostcondition<T>(params: {
  onPostconditionSuccessThenTransactionError?: (error: unknown) => void;
  transaction: () => Promise<T>;
  waitForPostcondition: (isTransactionSettled: () => boolean) => Promise<boolean>;
}): Promise<TransactionPostconditionRaceResult<T>> {
  let transactionSettled = false;
  let postconditionSatisfied = false;
  const transactionPromise = params.transaction().finally(() => {
    transactionSettled = true;
  });

  void transactionPromise.catch(error => {
    if (postconditionSatisfied) {
      params.onPostconditionSuccessThenTransactionError?.(error);
    }
  });

  const firstCompletion: TransactionPostconditionRaceCompletion<T> = await Promise.race([
    transactionPromise.then(result => ({ kind: "transaction" as const, result })),
    params
      .waitForPostcondition(() => transactionSettled)
      .then(satisfied => ({
        kind: satisfied ? ("postcondition" as const) : ("timeout" as const),
      })),
  ]);

  if (firstCompletion.kind === "postcondition") {
    postconditionSatisfied = true;
    return { confirmation: "postcondition", result: undefined };
  }

  if (firstCompletion.kind === "timeout") {
    const result = await transactionPromise;
    return {
      confirmation: "transaction-after-postcondition-timeout",
      result,
    };
  }

  return {
    confirmation: "transaction",
    result: firstCompletion.result,
  };
}
