import { normalizeWorldIdNullifierHash } from "./attestation";
import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, padHex, toBytes, toHex } from "viem";

test("normalizes World ID hex nullifiers to bytes32", () => {
  assert.equal(normalizeWorldIdNullifierHash("0xabcdef"), padHex("0xabcdef", { size: 32 }));
});

test("normalizes World ID decimal nullifiers to bytes32", () => {
  assert.equal(normalizeWorldIdNullifierHash("42"), toHex(42n, { size: 32 }));
});

test("hashes non-numeric World ID nullifier strings", () => {
  assert.equal(normalizeWorldIdNullifierHash("world-id-nullifier"), keccak256(toBytes("world-id-nullifier")));
});

test("rejects empty World ID nullifiers", () => {
  assert.equal(normalizeWorldIdNullifierHash(""), null);
  assert.equal(normalizeWorldIdNullifierHash(null), null);
});
