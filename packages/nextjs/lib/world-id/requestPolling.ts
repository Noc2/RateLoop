import type { IDKitResult } from "@worldcoin/idkit";

export const WORLD_ID_POLL_INTERVAL_MS = 1_000;
export const WORLD_ID_REQUEST_TIMEOUT_MS = 15 * 60_000;

type WorldIdPollingStatus =
  | { type: "waiting_for_connection" }
  | { type: "awaiting_confirmation" }
  | { type: "confirmed"; result?: IDKitResult }
  | { type: "failed"; error?: string };

export type WorldIdPollRequest = {
  pollOnce: () => Promise<WorldIdPollingStatus>;
};

type WorldIdPollingOptions = {
  onAwaitingConfirmation: (value: boolean) => void;
  pollIntervalMs?: number;
  signal: AbortSignal;
  timeoutMs?: number;
};

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const timeoutId = globalThis.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timeoutId);
        resolve();
      },
      { once: true },
    );
  });
}

export async function pollWorldIdRequest(request: WorldIdPollRequest, options: WorldIdPollingOptions) {
  const pollIntervalMs = options.pollIntervalMs ?? WORLD_ID_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? WORLD_ID_REQUEST_TIMEOUT_MS;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    if (options.signal.aborted) {
      return { success: false as const, error: "cancelled" };
    }

    const status = await request.pollOnce();
    if (status.type === "confirmed" && status.result) {
      return { success: true as const, result: status.result };
    }
    if (status.type === "failed") {
      return { success: false as const, error: status.error ?? "generic_error" };
    }

    options.onAwaitingConfirmation(status.type === "awaiting_confirmation");
    await sleep(pollIntervalMs, options.signal);
  }

  return { success: false as const, error: "timeout" };
}
