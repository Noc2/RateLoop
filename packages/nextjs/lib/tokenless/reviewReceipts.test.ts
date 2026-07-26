import { loadReviewReceipt, saveReviewReceipt } from "./reviewReceipts";
import assert from "node:assert/strict";
import test from "node:test";

function receipt(value: unknown): value is { accepted: true; responseCount: number } {
  const candidate = value as { accepted?: unknown; responseCount?: unknown };
  return candidate?.accepted === true && Number.isSafeInteger(candidate.responseCount);
}

test("review receipts survive refresh only for the same principal and expire after seven days", () => {
  const storage = new Map<string, string>();
  const memory = {
    get length() {
      return storage.size;
    },
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => [...storage.keys()][index] ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  } as Storage;
  const now = new Date("2026-07-26T12:00:00.000Z");
  assert.equal(
    saveReviewReceipt(
      "private",
      "assignment-1",
      { accepted: true, responseCount: 2 },
      {
        principalId: "principal-a",
        storage: memory,
        now,
      },
    ),
    true,
  );
  assert.deepEqual(
    loadReviewReceipt("private", "assignment-1", receipt, {
      principalId: "principal-a",
      storage: memory,
      now: new Date("2026-08-01T12:00:00.000Z"),
    }),
    { accepted: true, responseCount: 2 },
  );
  assert.equal(
    loadReviewReceipt("private", "assignment-1", receipt, {
      principalId: "principal-b",
      storage: memory,
      now,
    }),
    null,
  );
  assert.equal(
    loadReviewReceipt("private", "assignment-1", receipt, {
      principalId: "principal-a",
      storage: memory,
      now: new Date("2026-08-03T12:00:00.001Z"),
    }),
    null,
  );
});
