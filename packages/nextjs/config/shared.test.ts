import {
  BASE_POLLING_INTERVAL,
  BASE_PRECONF_POLLING_INTERVAL,
  DEFAULT_POLLING_INTERVAL,
  DEFAULT_TRANSACTION_RECEIPT_POLLING_INTERVAL,
  getPollingIntervalForChainId,
  getTransactionReceiptPollingInterval,
} from "./shared";
import assert from "node:assert/strict";
import test from "node:test";

test("Base mainnet uses the Flashblocks polling interval", () => {
  assert.equal(getPollingIntervalForChainId(8453), BASE_POLLING_INTERVAL);
});

test("Base preconfirmation clients use the tighter polling interval", () => {
  assert.equal(BASE_PRECONF_POLLING_INTERVAL, 200);
  assert.equal(
    getPollingIntervalForChainId(8453, DEFAULT_POLLING_INTERVAL, { preconfirmation: true }),
    BASE_PRECONF_POLLING_INTERVAL,
  );
});

test("non-Base chains keep the configured polling interval", () => {
  assert.equal(getPollingIntervalForChainId(999999), DEFAULT_POLLING_INTERVAL);
  assert.equal(getPollingIntervalForChainId(999998, 12_000), 12_000);
});

test("transaction receipt polling defaults to the responsive wallet interval", () => {
  assert.equal(getTransactionReceiptPollingInterval(undefined), DEFAULT_TRANSACTION_RECEIPT_POLLING_INTERVAL);
  assert.equal(getTransactionReceiptPollingInterval(999999), DEFAULT_TRANSACTION_RECEIPT_POLLING_INTERVAL);
  assert.equal(getTransactionReceiptPollingInterval(8453), BASE_POLLING_INTERVAL);
  assert.equal(
    getTransactionReceiptPollingInterval(999998, { preconfirmation: true }),
    DEFAULT_TRANSACTION_RECEIPT_POLLING_INTERVAL,
  );
  assert.equal(getTransactionReceiptPollingInterval(null, { fallback: 2_500 }), 2_500);
});
