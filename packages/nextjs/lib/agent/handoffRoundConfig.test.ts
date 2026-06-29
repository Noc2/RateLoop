import {
  readHandoffRoundDurationDraft,
  resolveHandoffSubmittedMaxDurationSeconds,
  syncHandoffMaxDurationForBlindChange,
} from "./handoffRoundConfig";
import assert from "node:assert/strict";
import test from "node:test";

test("fresh handoffs normalize max duration to the blind window", () => {
  const draft = readHandoffRoundDurationDraft(3_600n, 86_400n, 0);

  assert.equal(draft.roundBlindSeconds, "3600");
  assert.equal(draft.roundMaxDurationSeconds, "3600");
  assert.equal(draft.roundMaxDurationOverridden, false);
});

test("saved drafts also normalize max duration to the blind window", () => {
  const draft = readHandoffRoundDurationDraft(3_600n, 86_400n, 1);

  assert.equal(draft.roundBlindSeconds, "3600");
  assert.equal(draft.roundMaxDurationSeconds, "3600");
  assert.equal(draft.roundMaxDurationOverridden, false);
});

test("saved drafts without override keep max duration matched to blind", () => {
  const draft = readHandoffRoundDurationDraft(3_600n, 3_600n, 2);

  assert.equal(draft.roundMaxDurationOverridden, false);
  assert.equal(draft.roundMaxDurationSeconds, "3600");
});

test("syncHandoffMaxDurationForBlindChange mirrors blind when not overridden", () => {
  const next = syncHandoffMaxDurationForBlindChange(7_200, "3600", false, { min: 3_600, max: 86_400 });

  assert.equal(next, "7200");
});

test("syncHandoffMaxDurationForBlindChange ignores override state", () => {
  const next = syncHandoffMaxDurationForBlindChange(3_600, "86400", true, { min: 3600, max: 86400 });

  assert.equal(next, "3600");
});

test("resolveHandoffSubmittedMaxDurationSeconds uses blind when not overridden", () => {
  assert.equal(resolveHandoffSubmittedMaxDurationSeconds(3_600n, "86400", false), 3_600n);
});

test("resolveHandoffSubmittedMaxDurationSeconds ignores override state", () => {
  assert.equal(resolveHandoffSubmittedMaxDurationSeconds(3_600n, "86400", true), 3_600n);
});
