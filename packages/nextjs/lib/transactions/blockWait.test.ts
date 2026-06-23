import { readLatestBlockNumber, waitForNextObservedBlock } from "./blockWait";
import assert from "node:assert/strict";
import test from "node:test";

test("readLatestBlockNumber returns null when the client is unavailable", async () => {
  assert.equal(await readLatestBlockNumber(null), null);
});

test("waitForNextObservedBlock resolves after a newer block is observed", async () => {
  const blocks = [7n, 7n, 8n];
  const advanced = await waitForNextObservedBlock(
    {
      getBlockNumber: async () => blocks.shift() ?? 8n,
    },
    { afterBlockNumber: 7n, pollMs: 10, timeoutMs: 500 },
  );

  assert.equal(advanced, true);
});

test("waitForNextObservedBlock gives up after the timeout", async () => {
  const advanced = await waitForNextObservedBlock(
    {
      getBlockNumber: async () => 7n,
    },
    { afterBlockNumber: 7n, pollMs: 10, timeoutMs: 50 },
  );

  assert.equal(advanced, false);
});
