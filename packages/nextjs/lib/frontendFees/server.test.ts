import {
  __observeClaimableFrontendFeeRefreshForTests,
  isClaimableFrontendFeeSnapshot,
  normalizeFrontendFeeDisposition,
} from "./server";
import assert from "node:assert/strict";
import { test } from "node:test";

test("normalizeFrontendFeeDisposition accepts uint8 values decoded as numbers", () => {
  assert.equal(normalizeFrontendFeeDisposition(0), 0n);
  assert.equal(normalizeFrontendFeeDisposition(1), 1n);
  assert.equal(normalizeFrontendFeeDisposition(2), 2n);
});

test("isClaimableFrontendFeeSnapshot keeps number dispositions claimable", () => {
  assert.equal(isClaimableFrontendFeeSnapshot(10n, 1, false), true);
  assert.equal(isClaimableFrontendFeeSnapshot(10n, 2, false), false);
  assert.equal(isClaimableFrontendFeeSnapshot(10n, 1n, true), false);
});

test("claimable frontend fee background refresh failures are observed", async () => {
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    __observeClaimableFrontendFeeRefreshForTests(Promise.reject(new Error("ponder timeout")));
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.[0], "Failed to refresh claimable frontend fee cache:");
  assert.match(warnings[0]?.[1] instanceof Error ? warnings[0][1].message : "", /ponder timeout/);
});
