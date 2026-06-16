import { parseWorldIdLegacyProof, parseWorldIdProof, parseWorldIdV4Proof } from "./onchainProof";
import type { IDKitResult } from "@worldcoin/idkit";
import { hashSignal } from "@worldcoin/idkit/hashing";
import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, toHex } from "viem";

const TEST_SIGNAL = "0x63cada40e8acf7a1d47229af5be35b78b16035fa";
const TEST_LEGACY_PROOF = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n] as const;
const TEST_V4_PROOF = [11n, 12n, 13n, 14n, 42n] as const;

type WorldIdV4TestResult = IDKitResult & {
  protocol_version: "4.0";
  action: string;
  responses: Array<{
    identifier: string;
    signal_hash: string;
    proof: string[];
    nullifier: string;
    issuer_schema_id: number;
    expires_at_min: number;
  }>;
};

function makeV4Result(signal = TEST_SIGNAL, identifier = "proof_of_human"): WorldIdV4TestResult {
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

function makeDecimalV4Result(): WorldIdV4TestResult {
  return {
    ...makeV4Result(),
    nonce: "4660",
    responses: [
      {
        identifier: "proof_of_human",
        signal_hash: hashSignal(TEST_SIGNAL),
        proof: [...TEST_V4_PROOF].map(value => value.toString()),
        nullifier: "4660",
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
    responses: [
      {
        identifier: "orb",
        proof: encodeAbiParameters([{ type: "uint256[8]" }], [[...TEST_LEGACY_PROOF]]),
        merkle_root: "0x2a",
        nullifier: "0x1234",
        signal_hash: hashSignal(TEST_SIGNAL),
      },
    ],
  };
}

test("parses legacy World ID proofs for on-chain attestation", () => {
  const parsed = parseWorldIdLegacyProof(makeLegacyResult(), {
    expectedAction: "rateloop-test",
    expectedSignal: TEST_SIGNAL,
  });

  assert.equal(parsed.protocolVersion, "3.0");
  assert.equal(parsed.root, 42n);
  assert.equal(parsed.nullifierHash, 0x1234n);
  assert.deepEqual(parsed.proof, [...TEST_LEGACY_PROOF]);
  assert.equal(parsed.signalHash, hashSignal(TEST_SIGNAL));
});

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

test("parses decimal World ID v4 proof fields for on-chain attestation", () => {
  const parsed = parseWorldIdV4Proof(makeDecimalV4Result(), {
    expectedAction: "rateloop-test",
    expectedCredential: "proof_of_human",
    expectedSignal: TEST_SIGNAL,
  });

  assert.equal(parsed.nullifierHash, 4660n);
  assert.deepEqual(parsed.proof, [...TEST_V4_PROOF]);
  assert.equal(parsed.nonce, 4660n);
});

test("dispatches legacy proofs in legacy mode", () => {
  const parsed = parseWorldIdProof(makeLegacyResult(), {
    expectedAction: "rateloop-test",
    expectedSignal: TEST_SIGNAL,
    proofMode: "legacy",
  });

  assert.equal(parsed.protocolVersion, "3.0");
});

test("rejects legacy World ID proofs in v4-only mode", () => {
  assert.throws(
    () =>
      parseWorldIdProof(makeLegacyResult(), {
        expectedAction: "rateloop-test",
        expectedSignal: TEST_SIGNAL,
        proofMode: "v4",
      }),
    /v4-only/,
  );
});

test("rejects malformed World ID v4 proof fields", () => {
  const result = makeV4Result();
  result.responses[0]!.proof[0] = "not-a-proof-limb";

  assert.throws(
    () =>
      parseWorldIdProof(result, {
        expectedAction: "rateloop-test",
        expectedCredential: "proof_of_human",
        expectedSignal: TEST_SIGNAL,
        proofMode: "v4",
      }),
    /invalid v4 proof item 0/,
  );
});

test("rejects v4 proofs with the wrong credential identifier", () => {
  assert.throws(
    () =>
      parseWorldIdProof(makeV4Result(TEST_SIGNAL, "passport"), {
        expectedAction: "rateloop-test",
        expectedCredential: "proof_of_human",
        expectedSignal: TEST_SIGNAL,
        proofMode: "v4",
      }),
    /requested v4 on-chain proof/,
  );
});

test("rejects v4 proofs in legacy mode", () => {
  assert.throws(
    () =>
      parseWorldIdProof(makeV4Result(), {
        expectedAction: "rateloop-test",
        expectedCredential: "proof_of_human",
        expectedSignal: TEST_SIGNAL,
        proofMode: "legacy",
      }),
    /legacy proof mode/,
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
