import { getBlockWithRetry, readLatestBlockNumber, waitForNextObservedBlock } from "./blockWait";
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

test("getBlockWithRetry retries transient block-not-found errors", async () => {
  let attempts = 0;
  const block = await getBlockWithRetry(
    {
      getBlock: async params => {
        attempts += 1;
        if ("blockNumber" in params && attempts === 1) {
          throw new Error('BlockNotFoundError: Block at number "47757385" could not be found.');
        }
        return { number: 47757385n, timestamp: 10n };
      },
    },
    { blockNumber: 47757385n },
    { pollMs: 10, timeoutMs: 500 },
  );

  assert.equal(block.timestamp, 10n);
  assert.equal(attempts, 2);
});

test("getBlockWithRetry rethrows non-block-not-found errors immediately", async () => {
  await assert.rejects(
    () =>
      getBlockWithRetry(
        {
          getBlock: async () => {
            throw new Error("RPC unavailable");
          },
        },
        { blockTag: "latest" },
        { pollMs: 10, timeoutMs: 500 },
      ),
    /RPC unavailable/,
  );
});
