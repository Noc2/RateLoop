import { assertTransactionReceiptSucceeded } from "./useTransactor";
import assert from "node:assert/strict";
import test from "node:test";

test("assertTransactionReceiptSucceeded accepts successful receipts", () => {
  assert.doesNotThrow(() => assertTransactionReceiptSucceeded({ status: "success" }));
});

test("assertTransactionReceiptSucceeded rejects reverted receipts", () => {
  assert.throws(() => assertTransactionReceiptSucceeded({ status: "reverted" }), /Transaction reverted/);
});
