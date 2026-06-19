import assert from "node:assert/strict";
import test from "node:test";
import {
  durationAmountToMinutes,
  formatHumanDuration,
  formatHumanDurationFromMinutes,
  getBestDurationInputPartsFromMinutes,
  normalizeDurationAmountInput,
  parseDurationAmountInput,
} from "~~/lib/humanDuration";

test("formatHumanDurationFromMinutes translates large minute counts", () => {
  assert.equal(formatHumanDurationFromMinutes("1440"), "1 day");
  assert.equal(formatHumanDurationFromMinutes("10080"), "7 days");
  assert.equal(formatHumanDurationFromMinutes(60), "1 hour");
});

test("formatHumanDuration keeps useful mixed-unit labels", () => {
  assert.equal(formatHumanDuration(90 * 60), "1 hour 30 minutes");
  assert.equal(formatHumanDuration(2 * 86_400 + 3 * 3_600 + 5 * 60), "2 days, 3 hours 5 minutes");
  assert.equal(formatHumanDuration(45), "45 seconds");
});

test("getBestDurationInputPartsFromMinutes chooses readable exact units", () => {
  assert.deepEqual(getBestDurationInputPartsFromMinutes("1440"), { amount: "1", unit: "days" });
  assert.deepEqual(getBestDurationInputPartsFromMinutes("10080"), { amount: "7", unit: "days" });
  assert.deepEqual(getBestDurationInputPartsFromMinutes("120"), { amount: "2", unit: "hours" });
  assert.deepEqual(getBestDurationInputPartsFromMinutes("90"), { amount: "90", unit: "minutes" });
});

test("durationAmountToMinutes converts unit input back to protocol minutes", () => {
  assert.equal(durationAmountToMinutes("7", "days"), 10_080);
  assert.equal(durationAmountToMinutes("2", "hours"), 120);
  assert.equal(durationAmountToMinutes("20", "minutes"), 20);
});

test("duration amount parsing only accepts whole numeric input", () => {
  assert.equal(normalizeDurationAmountInput("123"), "123");
  assert.equal(normalizeDurationAmountInput(""), "");
  assert.equal(normalizeDurationAmountInput("1.5"), null);
  assert.equal(parseDurationAmountInput("abc"), 0);
});
