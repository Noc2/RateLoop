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

test("public review drafts remain versioned, bounded, restored, and cleared", () => {
  const storage = memoryStorage();
  const options = { storage, legacyStorage: null };
  assert.equal(saveReviewDraft("public", "round-1", { answer: "yes" }, options), true);
  assert.deepEqual(loadReviewDraft("public", "round-1", isDraft, options), { answer: "yes" });
  assert.equal(saveReviewDraft("public", "too-large", { rationale: "x".repeat(70 * 1024) }, options), false);
  clearReviewDraft("public", "round-1", options);
  assert.equal(loadReviewDraft("public", "round-1", isDraft, options), null);
});

test("private drafts are session-scoped and purged when the opaque principal changes", () => {
  const storage = memoryStorage();
  const common = { storage, legacyStorage: null, expiresAt: "2030-01-02T00:00:00.000Z" };
  const principalA = { ...common, principalId: "rlp_account_a", now: new Date("2030-01-01T00:00:00.000Z") };
  const principalB = { ...common, principalId: "rlp_account_b", now: new Date("2030-01-01T00:00:01.000Z") };

  assert.equal(saveReviewDraft("private", "assignment-1", { answer: "A" }, principalA), true);
  assert.deepEqual(loadReviewDraft("private", "assignment-1", isDraft, principalA), { answer: "A" });
  assert.equal(loadReviewDraft("private", "assignment-1", isDraft, principalB), null);
  assert.equal(loadReviewDraft("private", "assignment-1", isDraft, principalA), null);
});

test("private drafts expire with their artifact lease and legacy plaintext is purged", () => {
  const storage = memoryStorage();
  const legacyStorage = memoryStorage();
  legacyStorage.setItem("rateloop:review-draft:v1:private:assignment-1", JSON.stringify({ value: { answer: "A" } }));
  const active = {
    storage,
    legacyStorage,
    principalId: "rlp_account_a",
    expiresAt: "2030-01-01T00:01:00.000Z",
    now: new Date("2030-01-01T00:00:00.000Z"),
  };
  assert.equal(saveReviewDraft("private", "assignment-1", { answer: "A" }, active), true);
  assert.equal(legacyStorage.length, 0);
  assert.equal(
    loadReviewDraft("private", "assignment-1", isDraft, {
      ...active,
      now: new Date("2030-01-01T00:01:01.000Z"),
    }),
    null,
  );
});

test("review draft storage retains only the latest twenty records", () => {
  const storage = memoryStorage();
  const options = { storage, legacyStorage: null };
  for (let index = 0; index < 24; index += 1)
    saveReviewDraft("public", `round-${index}`, { answer: "A" }, { ...options, now: new Date(index * 1_000) });
  assert.equal(storage.length, 20);
  assert.deepEqual(loadReviewDraft("public", "round-23", isDraft, options), { answer: "A" });
  assert.equal(loadReviewDraft("public", "round-0", isDraft, options), null);
});
