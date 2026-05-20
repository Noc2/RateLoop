import { assertTransactionReceiptSucceeded, buildTransactionRevertedError } from "./useTransactor";
import assert from "node:assert/strict";
import test from "node:test";
import type { Hash, PublicClient, TransactionReceipt } from "viem";

test("assertTransactionReceiptSucceeded accepts successful receipts", () => {
  assert.doesNotThrow(() => assertTransactionReceiptSucceeded({ status: "success" }));
});

test("assertTransactionReceiptSucceeded rejects reverted receipts", () => {
  assert.throws(() => assertTransactionReceiptSucceeded({ status: "reverted" }), /Transaction reverted/);
});

test("buildTransactionRevertedError replays reverted receipts to recover the contract reason", async () => {
  const transactionHash = "0xabc0000000000000000000000000000000000000000000000000000000000000" as Hash;
  const receipt = {
    blockNumber: 12n,
    status: "reverted",
  } as TransactionReceipt;
  const publicClient = {
    getTransaction: async ({ hash }: { hash: Hash }) => {
      assert.equal(hash, transactionHash);
      return {
        from: "0x0000000000000000000000000000000000000001",
        gas: 123n,
        input: "0x1234",
        to: "0x0000000000000000000000000000000000000002",
        value: 0n,
      };
    },
    call: async ({ blockNumber }: { blockNumber?: bigint }) => {
      assert.equal(blockNumber, 12n);
      throw new Error("AlreadyCommitted");
    },
  } as unknown as PublicClient;

  const error = await buildTransactionRevertedError({
    chainId: 31337,
    publicClient,
    receipt,
    transactionHash,
  });

  assert.equal(error.message, "AlreadyCommitted");
  assert.equal((error as Error & { transactionHash?: Hash }).transactionHash, transactionHash);
});
