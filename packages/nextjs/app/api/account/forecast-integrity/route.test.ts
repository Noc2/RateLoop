import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("forecast integrity counters and appeals are account-bound and private", () => {
  assert.match(route, /requireBrowserSession\(request\)/u);
  assert.match(route, /requireBrowserSession\(request, \{ mutation: true \}\)/u);
  assert.match(route, /listPrincipalForecastIntegrity\(session\.principalId\)/u);
  assert.match(route, /openPrincipalForecastAppeal/u);
  assert.match(route, /private, no-store/u);
});
