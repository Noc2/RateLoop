import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = [
  readFileSync(new URL("./ReviewerEarningsClient.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../../messages/en/human.json", import.meta.url), "utf8"),
].join("\n");

test("reviewers can see historical earnings, outcomes, payouts, and deadlines", () => {
  assert.match(source, /Reviewer earnings/u);
  assert.match(source, /<InfoPopover label=\{t\("about"\)\}>\{t\("description"\)\}<\/InfoPopover>/u);
  assert.match(source, /\/api\/rater\/earnings/u);
  assert.match(source, /Earned/u);
  assert.match(source, /Paid/u);
  assert.match(source, /Ready to claim/u);
  assert.match(source, /Your vote/u);
  assert.match(source, /Panel verdict/u);
  assert.match(source, /Claim deadline/u);
  assert.match(source, /Claim transaction/u);
  assert.match(source, /Open payment recovery/u);
});
