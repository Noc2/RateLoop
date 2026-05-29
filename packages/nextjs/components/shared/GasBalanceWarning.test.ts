import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowGasWarningTransactionCostsLink } from "~~/components/shared/GasBalanceWarning";

test("shows transaction cost link after verified free transactions are exhausted", () => {
  assert.equal(
    shouldShowGasWarningTransactionCostsLink({
      freeTransactionRemaining: 0,
      freeTransactionVerified: true,
    }),
    true,
  );
});

test("hides transaction cost link while verified free transactions remain", () => {
  assert.equal(
    shouldShowGasWarningTransactionCostsLink({
      freeTransactionRemaining: 1,
      freeTransactionVerified: true,
    }),
    false,
  );
});

test("hides transaction cost link for wallets without verified free transaction allowance", () => {
  assert.equal(
    shouldShowGasWarningTransactionCostsLink({
      freeTransactionRemaining: 0,
      freeTransactionVerified: false,
    }),
    false,
  );
});
