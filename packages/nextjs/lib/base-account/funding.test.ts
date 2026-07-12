import assert from "node:assert/strict";
import { test } from "node:test";
import type { EIP1193Provider } from "viem";
import { waitForTokenlessRoundTransaction } from "~~/lib/base-account/funding";

test("Base Account call bundles resolve to their mined round transaction", async () => {
  let calls = 0;
  const hash = `0x${"11".repeat(32)}` as const;
  const provider = {
    async request() {
      calls += 1;
      return calls === 1 ? { status: 100, receipts: [] } : { status: 200, receipts: [{ transactionHash: hash }] };
    },
  } as unknown as EIP1193Provider;
  assert.equal(
    await waitForTokenlessRoundTransaction({ provider, callsId: "bundle-1", pollMs: 1, timeoutMs: 100 }),
    hash,
  );
  assert.equal(calls, 2);
});

test("Base Account call bundles fail closed on terminal wallet errors", async () => {
  await assert.rejects(
    () =>
      waitForTokenlessRoundTransaction({
        provider: {
          async request() {
            return { status: 400 };
          },
        } as unknown as EIP1193Provider,
        callsId: "bundle-2",
        pollMs: 1,
        timeoutMs: 100,
      }),
    /funding failed/,
  );
});
