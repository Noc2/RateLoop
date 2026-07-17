import { clearReviewDraft, loadReviewDraft, saveReviewDraft } from "./reviewDrafts";
import assert from "node:assert/strict";
import test from "node:test";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function isDraft(value: unknown): value is { answer: string } {
  return Boolean(value && typeof value === "object" && typeof (value as { answer?: unknown }).answer === "string");
}

test("review drafts are versioned, bounded, restored, and cleared", () => {
  const storage = memoryStorage();
  assert.equal(saveReviewDraft("public", "round-1", { answer: "yes" }, storage), true);
  assert.deepEqual(loadReviewDraft("public", "round-1", isDraft, storage), { answer: "yes" });
  assert.equal(saveReviewDraft("public", "too-large", { rationale: "x".repeat(70 * 1024) }, storage), false);
  clearReviewDraft("public", "round-1", storage);
  assert.equal(loadReviewDraft("public", "round-1", isDraft, storage), null);
});

test("review draft storage retains only the latest twenty records", () => {
  const storage = memoryStorage();
  for (let index = 0; index < 24; index += 1)
    saveReviewDraft("private", `assignment-${index}`, { answer: "A" }, storage);
  assert.equal(storage.length, 20);
  assert.deepEqual(loadReviewDraft("private", "assignment-23", isDraft, storage), { answer: "A" });
  assert.equal(loadReviewDraft("private", "assignment-0", isDraft, storage), null);
});
