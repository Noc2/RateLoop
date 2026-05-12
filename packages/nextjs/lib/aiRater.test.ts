import {
  buildAiChallengeEvidenceHash,
  computeBondReleaseAt,
  computeChallengeExpiresAt,
  hashAiRaterField,
} from "./aiRater";
import assert from "node:assert/strict";
import { test } from "node:test";

test("hashAiRaterField hashes trimmed field values and zeroes empty input", () => {
  assert.equal(
    hashAiRaterField("  openai/gpt-4o-mini  "),
    "0xd2022248140c1b806f69a864f09a5ced8d2646bf7a404d3f016b3b97d8bc20f2",
  );
  assert.equal(hashAiRaterField(""), "0x0000000000000000000000000000000000000000000000000000000000000000");
});

test("buildAiChallengeEvidenceHash stays stable for normalized evidence payloads", () => {
  const first = buildAiChallengeEvidenceHash({
    summary: " Provider mismatch ",
    sourceUrl: "https://example.com/evidence",
    details: "Observed a different endpoint banner.",
  });
  const second = buildAiChallengeEvidenceHash({
    summary: "Provider mismatch",
    sourceUrl: "https://example.com/evidence",
    details: "Observed a different endpoint banner.",
  });

  assert.equal(first, second);
});

test("computeBondReleaseAt derives retired and expired unlock timestamps", () => {
  assert.equal(
    computeBondReleaseAt({
      inactiveReason: "retired",
      retiredAt: "100",
      retiredBondLockSeconds: "20",
    }),
    120n,
  );
  assert.equal(
    computeBondReleaseAt({
      inactiveReason: "expired",
      expiresAtEpoch: "500",
      retiredBondLockSeconds: "30",
    }),
    530n,
  );
  assert.equal(
    computeBondReleaseAt({
      inactiveReason: "challenged",
      expiresAtEpoch: "500",
      retiredBondLockSeconds: "30",
    }),
    null,
  );
});

test("computeChallengeExpiresAt adds the current resolution window", () => {
  assert.equal(computeChallengeExpiresAt("1000", "604800"), 605800n);
});
