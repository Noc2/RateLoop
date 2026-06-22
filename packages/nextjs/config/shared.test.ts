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

test("Base chains use the Flashblocks polling interval", () => {
  assert.equal(getPollingIntervalForChainId(8453), BASE_POLLING_INTERVAL);
  assert.equal(getPollingIntervalForChainId(84532), BASE_POLLING_INTERVAL);
});

test("Base preconfirmation clients use the tighter polling interval", () => {
  assert.equal(BASE_PRECONF_POLLING_INTERVAL, 200);
  assert.equal(
    getPollingIntervalForChainId(8453, DEFAULT_POLLING_INTERVAL, { preconfirmation: true }),
    BASE_PRECONF_POLLING_INTERVAL,
  );
  assert.equal(
    getPollingIntervalForChainId(84532, DEFAULT_POLLING_INTERVAL, { preconfirmation: true }),
    BASE_PRECONF_POLLING_INTERVAL,
  );
});

test("non-Base chains keep the configured polling interval", () => {
  assert.equal(getPollingIntervalForChainId(480), DEFAULT_POLLING_INTERVAL);
  assert.equal(getPollingIntervalForChainId(4801, 12_000), 12_000);
});

test("transaction receipt polling defaults to the responsive wallet interval", () => {
  assert.equal(getTransactionReceiptPollingInterval(undefined), DEFAULT_TRANSACTION_RECEIPT_POLLING_INTERVAL);
  assert.equal(getTransactionReceiptPollingInterval(480), DEFAULT_TRANSACTION_RECEIPT_POLLING_INTERVAL);
  assert.equal(getTransactionReceiptPollingInterval(8453), BASE_POLLING_INTERVAL);
  assert.equal(getTransactionReceiptPollingInterval(84532, { preconfirmation: true }), BASE_PRECONF_POLLING_INTERVAL);
  assert.equal(getTransactionReceiptPollingInterval(null, { fallback: 2_500 }), 2_500);
});
