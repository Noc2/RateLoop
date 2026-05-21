import { lookupLegacyClaim, normalizeLegacyClaimAddress } from "./lookup";
import { legacyClaimManifest } from "./manifest";
import assert from "node:assert/strict";
import test from "node:test";
import { concat, encodeAbiParameters, getAddress, keccak256 } from "viem";

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

test("rejects checksum-invalid mixed-case legacy claim addresses", () => {
  const checksumInvalidAddress = "0x63Cada40E8AcF7A1d47229af5Be35b78b16035fa";

  assert.equal(normalizeLegacyClaimAddress(checksumInvalidAddress), null);
  assert.equal(lookupLegacyClaim(checksumInvalidAddress), null);
});

test("returns not_eligible for a syntactically-valid address absent from the manifest", () => {
  // Manifest is populated; the all-zero-but-beef address is not in it.
  const result = lookupLegacyClaim("0x000000000000000000000000000000000000bEEF");
  assert.ok(result, "lookup should not return null for a valid address");
  if (result?.status === "not_eligible") {
    assert.equal(result.address, "0x000000000000000000000000000000000000bEEF");
    assert.equal(result.merkleRoot, legacyClaimManifest.merkleRoot);
  } else {
    assert.fail(`expected not_eligible, got ${result?.status}`);
  }
});

test("returns eligible status with allocation + proof for a manifest entry", () => {
  // The 25%-share entry (`0x63cada…`) is the one that received curyo referrer rewards.
  const result = lookupLegacyClaim("0x63cada40e8acf7a1d47229af5be35b78b16035fa");
  assert.ok(result);
  if (result?.status === "eligible") {
    assert.equal(result.address, "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa");
    assert.equal(result.allocation, "2250000000000");
    assert.ok(Array.isArray(result.proof) && result.proof.length > 0);
    assert.equal(result.merkleRoot, legacyClaimManifest.merkleRoot);
  } else {
    assert.fail(`expected eligible, got ${result?.status}`);
  }
});

test("lookup is case-insensitive on the input address", () => {
  const lower = lookupLegacyClaim("0x63cada40e8acf7a1d47229af5be35b78b16035fa");
  const upper = lookupLegacyClaim("0x63CADA40E8ACF7A1D47229AF5BE35B78B16035FA");
  assert.equal(lower?.status, "eligible");
  assert.equal(upper?.status, "eligible");
  if (lower?.status === "eligible" && upper?.status === "eligible") {
    assert.equal(lower.allocation, upper.allocation);
    assert.deepEqual(lower.proof, upper.proof);
  }
});

test("every manifest entry's leaf hashes back to the merkle root via its proof", () => {
  // Reproduces the leaf hashing used by LaunchDistributionPool._legacyContributorLeaf:
  // keccak256(bytes.concat(keccak256(abi.encode(account, allocation)))).
  // And the OZ StandardMerkleTree pair-hash: keccak256(concat(sorted(a, b))).
  // If both reproduce the stored merkleRoot, the manifest is consistent with the contract.
  const merkleRoot = legacyClaimManifest.merkleRoot;
  assert.ok(merkleRoot, "manifest must be populated for this test");

  for (const entry of legacyClaimManifest.entries) {
    const inner = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [getAddress(entry.address), BigInt(entry.allocation)],
      ),
    );
    let cursor: `0x${string}` = keccak256(inner);
    for (const sibling of entry.proof) {
      const [lo, hi] = cursor < sibling ? [cursor, sibling] : [sibling, cursor];
      cursor = keccak256(concat([lo, hi]));
    }
    assert.equal(cursor, merkleRoot, `proof for ${entry.address} did not derive the root`);
  }
});

test("manifest entries sum exactly to allocationTotal", () => {
  const sum = legacyClaimManifest.entries.reduce((acc, e) => acc + BigInt(e.allocation), 0n);
  assert.equal(sum.toString(), legacyClaimManifest.allocationTotal);
});
