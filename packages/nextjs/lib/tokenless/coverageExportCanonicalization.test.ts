import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import test from "node:test";
import { __adaptiveCoverageExportTestUtils } from "~~/lib/tokenless/adaptiveCoverageExport";
import { __assuranceWormTestUtils } from "~~/lib/tokenless/assuranceWormExports";

test("node-utils, the v2 coverage producer, and the WORM v2 verifier share exact RFC 8785 bytes", () => {
  const payload = {
    schemaVersion: "rateloop.assurance-coverage-export.v2" as const,
    workspaceId: "wsp_rfc8785_fixture",
    unicodeOrdering: {
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u20ac": "Euro Sign",
      "\u00f6": "Latin Small Letter O With Diaeresis",
    },
    numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27],
  };
  const canonical = canonicalizeRfc8785(payload);
  const digest = sha256Rfc8785(payload);

  assert.equal(__adaptiveCoverageExportTestUtils.canonicalJson(payload), canonical);
  assert.equal(__adaptiveCoverageExportTestUtils.sha256(payload), digest);
  assert.equal(__assuranceWormTestUtils.canonicalizeCoverageV2(payload), canonical);
  assert.equal(__assuranceWormTestUtils.coverageV2Digest(payload), digest);
  assert.equal(
    __assuranceWormTestUtils.canonicalizeWormArtifact("rateloop.assurance-coverage-export.v2", {
      ...payload,
      exportDigest: digest,
    }),
    canonicalizeRfc8785({ ...payload, exportDigest: digest }),
  );
  assert.equal(
    __assuranceWormTestUtils.artifactSchema("coverage_export", { ...payload, exportDigest: digest }),
    "rateloop.assurance-coverage-export.v2",
  );
});

test("WORM keeps v1 verification on its legacy canonicalizer", () => {
  const payload = {
    schemaVersion: "rateloop.assurance-coverage-export.v1" as const,
    workspaceId: "wsp_legacy_fixture",
    unicodeOrdering: { "\ufb33": 1, "\ud83d\ude00": 2, "\u20ac": 3, "\u00f6": 4 },
  };
  const legacyDigest = __assuranceWormTestUtils.sha256(__assuranceWormTestUtils.canonicalJson(payload));

  assert.notEqual(__assuranceWormTestUtils.canonicalJson(payload), canonicalizeRfc8785(payload));
  assert.equal(
    __assuranceWormTestUtils.artifactSchema("coverage_export", { ...payload, exportDigest: legacyDigest }),
    "rateloop.assurance-coverage-export.v1",
  );
  assert.throws(
    () =>
      __assuranceWormTestUtils.artifactSchema("coverage_export", {
        ...payload,
        schemaVersion: "rateloop.assurance-coverage-export.v2",
        exportDigest: legacyDigest,
      }),
    /Coverage export digest is invalid/u,
  );
});
