import assert from "node:assert/strict";
import test from "node:test";
import { raceTransactionWithPostcondition, waitForTransactionPostcondition } from "~~/lib/transactions/postcondition";

test("waitForTransactionPostcondition resolves when the check becomes true", async () => {
  let attempts = 0;

  const satisfied = await waitForTransactionPostcondition(
    async () => {
      attempts += 1;
      return attempts === 2;
    },
    "test-postcondition",
    {
      pollingIntervalMs: 1,
      timeoutMs: 100,
    },
  );

  assert.equal(satisfied, true);
  assert.equal(attempts, 2);
});

test("raceTransactionWithPostcondition returns early on postcondition success", async () => {
  let resolveTransaction: (value: string) => void = () => {};
  const transaction = new Promise<string>(resolve => {
    resolveTransaction = resolve;
  });

  const result = await raceTransactionWithPostcondition({
    transaction: () => transaction,
    waitForPostcondition: async () => true,
  });

  assert.equal(result.confirmation, "postcondition");
  resolveTransaction("done");
  await transaction;
});

test("raceTransactionWithPostcondition returns the transaction result when it wins", async () => {
  const result = await raceTransactionWithPostcondition({
    transaction: async () => "done",
    waitForPostcondition: async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return false;
    },
  });

  assert.deepEqual(result, { confirmation: "transaction", result: "done" });
});
