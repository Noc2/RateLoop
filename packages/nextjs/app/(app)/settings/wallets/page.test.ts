import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("wallet settings use the shared page heading without a duplicate eyebrow", () => {
  assert.match(source, /<PageHeading/);
  assert.match(source, /heading="Wallets"/);
  assert.match(source, /subtitle="Add a wallet only when you need to pay for an ask or receive reviewer earnings/);
  assert.doesNotMatch(source, /tracking-\[0\.22em\][^>]*>\s*Account settings\s*</);
});
