import { formatForecastPercentage } from "./ForecastIntegrityClient";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = [
  readFileSync(new URL("./ForecastIntegrityClient.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../../messages/en/human.json", import.meta.url), "utf8"),
].join("\n");

test("reviewers see quality counters and can open or withdraw a scoped appeal", () => {
  assert.match(source, /Accuracy vs baseline/u);
  assert.match(source, /Outcome separation/u);
  assert.match(source, /higher is better/u);
  assert.doesNotMatch(source, /\bbps\b/u);
  assert.doesNotMatch(source, /Payment effect/u);
  assert.match(source, /Open appeal/u);
  assert.match(source, /Withdraw appeal/u);
  assert.match(source, /Only this finding’s assignment consequence is suspended/u);
});

test("forecast quality basis points are formatted as readable percentages", () => {
  assert.equal(formatForecastPercentage(6_000), "60%");
  assert.equal(formatForecastPercentage(1_225), "12.3%");
  assert.equal(formatForecastPercentage(-250), "-2.5%");
});
