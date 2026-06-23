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

test("waitForReservationRevealReady rechecks latest block time after waiting", async () => {
  const sleeps: number[] = [];
  const calls: unknown[] = [];
  const latestTimestamps = [10n, 11n];

  await waitForReservationRevealReady({
    client: {
      getBlock: async params => {
        calls.push(params);
        if ("blockNumber" in params) return { timestamp: 10n };
        return { timestamp: latestTimestamps.shift() ?? 11n };
      },
    },
    pollingIntervalMs: 200,
    receipt: { blockNumber: 7n },
    sleepMs: async ms => {
      sleeps.push(ms);
    },
  });

  assert.deepEqual(sleeps, [1_000 + RESERVATION_REVEAL_WALL_CLOCK_BUFFER_MS]);
  assert.deepEqual(calls, [
    { blockNumber: 7n },
    { blockTag: "latest" },
    { blockTag: "latest" },
  ]);
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
