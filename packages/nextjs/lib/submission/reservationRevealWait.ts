export const RESERVED_SUBMISSION_MIN_AGE_SECONDS = 1n;
export const RESERVATION_REVEAL_READY_TIMEOUT_MS = 30_000;
export const RESERVATION_REVEAL_WALL_CLOCK_BUFFER_MS = 250;

export type ReservationRevealWaitReceipt = {
  blockNumber?: bigint | null;
};

export type ReservationRevealWaitClient = {
  getBlock: (params: { blockNumber: bigint } | { blockTag: "latest" }) => Promise<{ timestamp: bigint }>;
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForReservationRevealReady(params: {
  client: ReservationRevealWaitClient;
  minAgeSeconds?: bigint;
  pollingIntervalMs: number;
  receipt: ReservationRevealWaitReceipt;
  sleepMs?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}) {
  const blockNumber = params.receipt.blockNumber;
  const minAgeSeconds = params.minAgeSeconds ?? RESERVED_SUBMISSION_MIN_AGE_SECONDS;
  const pollMs = Math.max(50, Math.floor(params.pollingIntervalMs));
  const sleepFn = params.sleepMs ?? sleep;

  if (typeof blockNumber !== "bigint") {
    await sleepFn(Number(minAgeSeconds) * 1_000);
    return;
  }

  const reserveBlock = await params.client.getBlock({ blockNumber });
  const revealReadyTimestamp = reserveBlock.timestamp + minAgeSeconds;
  const timeoutMs = params.timeoutMs ?? RESERVATION_REVEAL_READY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const latestBlock = await params.client.getBlock({ blockTag: "latest" });
    if (latestBlock.timestamp >= revealReadyTimestamp) return;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error("Timed out waiting for the reserved submission reveal window.");
    }

    const timestampShortfallMs = Number(revealReadyTimestamp - latestBlock.timestamp) * 1_000;
    const revealWaitMs = Math.max(pollMs, timestampShortfallMs + RESERVATION_REVEAL_WALL_CLOCK_BUFFER_MS);
    if (remainingMs < revealWaitMs) {
      await sleepFn(remainingMs);
      throw new Error("Timed out waiting for the reserved submission reveal window.");
    }

    await sleepFn(revealWaitMs);
    return;
  }
}
