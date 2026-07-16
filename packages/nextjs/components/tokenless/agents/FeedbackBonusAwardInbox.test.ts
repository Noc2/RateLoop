import { formatFeedbackBonusUsdc } from "./FeedbackBonusAwardInbox";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Feedback Bonus inbox preserves the legacy human award interaction", () => {
  const source = readFileSync(new URL("./FeedbackBonusAwardInbox.tsx", import.meta.url), "utf8");
  assert.match(source, /Award Feedback Bonus/u);
  assert.match(source, /Award this feedback/u);
  assert.match(source, /eligible written feedback/u);
  assert.match(source, /The agent cannot make this decision/u);
  assert.match(source, /immutable\s+payout commitment/u);
  assert.doesNotMatch(source, /auto(?:matic)? award/iu);
});

test("Feedback Bonus amounts use exact USDC atomic formatting", () => {
  assert.equal(formatFeedbackBonusUsdc("1"), "0.000001 USDC");
  assert.equal(formatFeedbackBonusUsdc("1250000"), "1.25 USDC");
});
