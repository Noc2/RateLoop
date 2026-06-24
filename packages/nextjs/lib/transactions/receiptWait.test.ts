import { waitForPublicClientTransactionReceiptWithRetry } from "./receiptWait";
import assert from "node:assert/strict";
import test from "node:test";

test("waitForPublicClientTransactionReceiptWithRetry retries transient block-not-found errors", async () => {
  let attempts = 0;
  const receipt = await waitForPublicClientTransactionReceiptWithRetry(
    {
      waitForTransactionReceipt: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('BlockNotFoundError: Block at number "47757385" could not be found.');
        }
        return { status: "success" as const, blockNumber: 47757385n, transactionHash: "0xabc" };
      },
    } as never,
    { hash: "0xabc" },
  );

  assert.equal(receipt.status, "success");
  assert.equal(attempts, 2);
});

test("waitForPublicClientTransactionReceiptWithRetry rethrows non-block-not-found errors immediately", async () => {
  await assert.rejects(
    () =>
      waitForPublicClientTransactionReceiptWithRetry(
        {
          waitForTransactionReceipt: async () => {
            throw new Error("RPC unavailable");
          },
        } as never,
        { hash: "0xabc" },
      ),
    /RPC unavailable/,
  );
});
