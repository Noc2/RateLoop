import { deadlineLabel } from "./DeadlineChip";
import assert from "node:assert/strict";
import test from "node:test";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");

test("deadline labels stay calm and truthful", () => {
  assert.equal(deadlineLabel("2026-07-17T12:00:01.000Z", NOW), "1 min left");
  assert.equal(deadlineLabel("2026-07-17T13:30:00.000Z", NOW), "2 hr left");
  assert.equal(deadlineLabel("2026-07-20T12:00:00.000Z", NOW), "3 days left");
  assert.equal(deadlineLabel("2026-07-17T11:59:59.000Z", NOW), "Deadline passed");
  assert.equal(deadlineLabel("not-a-date", NOW), "Deadline unavailable");
});
