import { RESERVATION_REVEAL_WALL_CLOCK_BUFFER_MS, waitForReservationRevealReady } from "./reservationRevealWait";
import assert from "node:assert/strict";
import test from "node:test";

test("waitForReservationRevealReady returns immediately when latest block is old enough", async () => {
  const calls: unknown[] = [];

  await waitForReservationRevealReady({
    client: {
      getBlock: async params => {
        calls.push(params);
        return "blockNumber" in params ? { timestamp: 10n } : { timestamp: 11n };
      },
    },
    pollingIntervalMs: 200,
    receipt: { blockNumber: 7n },
    sleepMs: async () => {
      throw new Error("sleep should not run");
    },
  });

  assert.deepEqual(calls, [{ blockNumber: 7n }, { blockTag: "latest" }]);
});

test("waitForReservationRevealReady waits wall-clock time when automine has not advanced the latest block", async () => {
  const sleeps: number[] = [];

  await waitForReservationRevealReady({
    client: {
      getBlock: async params => {
        if ("blockNumber" in params) return { timestamp: 10n };
        return { timestamp: 10n };
      },
    },
    pollingIntervalMs: 200,
    receipt: { blockNumber: 7n },
    sleepMs: async ms => {
      sleeps.push(ms);
    },
  });

  assert.deepEqual(sleeps, [1_000 + RESERVATION_REVEAL_WALL_CLOCK_BUFFER_MS]);
});

test("waitForReservationRevealReady uses a one-second fallback without a receipt block", async () => {
  const sleeps: number[] = [];

  await waitForReservationRevealReady({
    client: {
      getBlock: async () => {
        throw new Error("block lookup should not run");
      },
    },
    pollingIntervalMs: 200,
    receipt: {},
    sleepMs: async ms => {
      sleeps.push(ms);
    },
  });

  assert.deepEqual(sleeps, [1_000]);
});
