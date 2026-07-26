import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ForecastIntegrityClient.tsx", import.meta.url), "utf8");

test("reviewers see payout-neutral counters and can open or withdraw a scoped appeal", () => {
  assert.match(source, /Brier skill/u);
  assert.match(source, /Payment effect/u);
  assert.match(source, />None</u);
  assert.match(source, /Open appeal/u);
  assert.match(source, /Withdraw appeal/u);
  assert.match(source, /Only this finding’s assignment consequence is suspended/u);
});
