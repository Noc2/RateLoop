import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ForecastIntegrityClient.tsx", import.meta.url), "utf8");

test("reviewers see payout-neutral counters and can appeal a hard finding", () => {
  assert.match(source, /Brier skill/u);
  assert.match(source, /Payment effect/u);
  assert.match(source, />None</u);
  assert.match(source, /Open appeal/u);
  assert.match(source, /Assignment consequences are suspended/u);
});
