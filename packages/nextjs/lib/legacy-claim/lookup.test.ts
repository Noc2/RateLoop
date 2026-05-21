import { lookupLegacyClaim, normalizeLegacyClaimAddress } from "./lookup";
import assert from "node:assert/strict";
import test from "node:test";

test("normalizes valid legacy claim addresses", () => {
  assert.equal(
    normalizeLegacyClaimAddress("0x000000000000000000000000000000000000bEEF"),
    "0x000000000000000000000000000000000000bEEF",
  );
});

test("rejects invalid legacy claim addresses", () => {
  assert.equal(normalizeLegacyClaimAddress("not-an-address"), null);
  assert.equal(lookupLegacyClaim("not-an-address"), null);
});

test("reports unpublished manifest until the legacy root is configured", () => {
  assert.deepEqual(lookupLegacyClaim("0x000000000000000000000000000000000000bEEF"), {
    status: "not_published",
    merkleRoot: null,
    allocationTotal: "0",
    generatedAt: null,
  });
});
