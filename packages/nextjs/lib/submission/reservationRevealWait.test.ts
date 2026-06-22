import { waitForReservationRevealReady } from "./reservationRevealWait";
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

test("waitForReservationRevealReady polls until the next block timestamp satisfies the reservation age", async () => {
  const sleeps: number[] = [];
  const latestTimestamps = [10n, 10n, 11n];

  await waitForReservationRevealReady({
    client: {
      getBlock: async params => {
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

  assert.deepEqual(sleeps, [200, 200]);
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
