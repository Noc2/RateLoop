import { parseWorldIdProof, parseWorldIdV4Proof } from "./onchainProof";
import type { IDKitResult } from "@worldcoin/idkit";
import { hashSignal } from "@worldcoin/idkit/hashing";
import assert from "node:assert/strict";
import test from "node:test";
import { toHex } from "viem";

const TEST_SIGNAL = "0x63cada40e8acf7a1d47229af5be35b78b16035fa";
const TEST_V4_PROOF = [11n, 12n, 13n, 14n, 42n] as const;

function makeV4Result(signal = TEST_SIGNAL, identifier = "proof_of_human"): IDKitResult {
  return {
    protocol_version: "4.0",
    nonce: "0x1234",
    action: "rateloop-test",
    environment: "production",
    responses: [
      {
        identifier,
        signal_hash: hashSignal(signal),
        proof: [...TEST_V4_PROOF].map(value => toHex(value)),
        nullifier: "0x1234",
        issuer_schema_id: 1,
        expires_at_min: 1_800_000_000,
      },
    ],
  };
}

function makeLegacyResult(): IDKitResult {
  return {
    protocol_version: "3.0",
    nonce: "0x1234",
    action: "rateloop-test",
    environment: "production",
    responses: [],
  };
}

test("parses World ID v4 proofs for on-chain attestation", () => {
  const parsed = parseWorldIdV4Proof(makeV4Result(), {
    expectedAction: "rateloop-test",
    expectedCredential: "proof_of_human",
    expectedSignal: TEST_SIGNAL,
  });

  assert.equal(parsed.protocolVersion, "4.0");
  assert.equal(parsed.nullifierHash, 0x1234n);
  assert.deepEqual(parsed.proof, [...TEST_V4_PROOF]);
  assert.equal(parsed.nonce, 0x1234n);
  assert.equal(parsed.issuerSchemaId, 1);
  assert.equal(parsed.expiresAtMin, 1_800_000_000);
  assert.equal(parsed.signalHash, hashSignal(TEST_SIGNAL));
});

test("rejects legacy World ID proofs", () => {
  assert.throws(
    () =>
      parseWorldIdProof(makeLegacyResult(), {
        expectedAction: "rateloop-test",
        expectedCredential: "proof_of_human",
        expectedSignal: TEST_SIGNAL,
      }),
    /World ID 4.0/,
  );
});

test("rejects v4 proofs with the wrong credential identifier", () => {
  assert.throws(
    () =>
      parseWorldIdProof(makeV4Result(TEST_SIGNAL, "passport"), {
        expectedAction: "rateloop-test",
        expectedCredential: "proof_of_human",
        expectedSignal: TEST_SIGNAL,
      }),
    /requested v4 on-chain proof/,
  );
});

test("rejects proofs bound to a different wallet signal", () => {
  assert.throws(
    () =>
      parseWorldIdV4Proof(makeV4Result("0x0000000000000000000000000000000000000001"), {
        expectedAction: "rateloop-test",
        expectedCredential: "proof_of_human",
        expectedSignal: TEST_SIGNAL,
      }),
    /not bound to the connected wallet/,
  );
});
