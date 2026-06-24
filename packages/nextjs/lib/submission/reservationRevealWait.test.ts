import { RESERVATION_REVEAL_WALL_CLOCK_BUFFER_MS, waitForReservationRevealReady } from "./reservationRevealWait";
import assert from "node:assert/strict";
import test from "node:test";

test("waitForReservationRevealReady returns immediately when latest block is old enough", async () => {
  const calls: unknown[] = [];

  await waitForReservationRevealReady({
    client: {
      getBlock: async params => {
        calls.push(params);
        return "blockNumber" in params ? { number: 7n, timestamp: 10n } : { number: 8n, timestamp: 11n };
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
  const latestBlocks = [
    { number: 7n, timestamp: 10n },
    { number: 8n, timestamp: 11n },
  ];

  await waitForReservationRevealReady({
    client: {
      getBlock: async params => {
        calls.push(params);
        if ("blockNumber" in params) return { number: 7n, timestamp: 10n };
        return latestBlocks.shift() ?? { number: 8n, timestamp: 11n };
      },
    },
    pollingIntervalMs: 200,
    receipt: { blockNumber: 7n },
    sleepMs: async ms => {
      sleeps.push(ms);
    },
  });

  assert.deepEqual(sleeps, [1_000 + RESERVATION_REVEAL_WALL_CLOCK_BUFFER_MS]);
  assert.deepEqual(calls, [{ blockNumber: 7n }, { blockTag: "latest" }, { blockTag: "latest" }]);
});

test("waitForReservationRevealReady allows the reveal transaction to mine the next block", async () => {
  const sleeps: number[] = [];
  const calls: unknown[] = [];

  await waitForReservationRevealReady({
    client: {
      getBlock: async params => {
        calls.push(params);
        return { number: 7n, timestamp: 10n };
      },
    },
    pollingIntervalMs: 200,
    receipt: { blockNumber: 7n },
    sleepMs: async ms => {
      sleeps.push(ms);
    },
  });

  assert.deepEqual(sleeps, [1_000 + RESERVATION_REVEAL_WALL_CLOCK_BUFFER_MS]);
  assert.deepEqual(calls, [{ blockNumber: 7n }, { blockTag: "latest" }, { blockTag: "latest" }]);
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

test("waitForReservationRevealReady retries when the reserve block is not indexed yet", async () => {
  let reserveBlockAttempts = 0;

  await waitForReservationRevealReady({
    client: {
      getBlock: async params => {
        if ("blockNumber" in params) {
          reserveBlockAttempts += 1;
          if (reserveBlockAttempts === 1) {
            throw new Error('BlockNotFoundError: Block at number "47757385" could not be found.');
          }
          return { number: 47757385n, timestamp: 10n };
        }
        return { number: 47757386n, timestamp: 11n };
      },
    },
    pollingIntervalMs: 10,
    receipt: { blockNumber: 47757385n },
    sleepMs: async () => {
      throw new Error("sleep should not run");
    },
  });

  assert.equal(reserveBlockAttempts, 2);
});
