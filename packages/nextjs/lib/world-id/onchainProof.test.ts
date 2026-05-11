import { parseWorldIdLegacyProof } from "./onchainProof";
import type { IDKitResult } from "@worldcoin/idkit";
import { hashSignal } from "@worldcoin/idkit/hashing";
import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters } from "viem";

const TEST_SIGNAL = "0x63cada40e8acf7a1d47229af5be35b78b16035fa";
const TEST_PROOF = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n] as const;

function makeLegacyResult(signal = TEST_SIGNAL): IDKitResult {
  return {
    protocol_version: "3.0",
    nonce: "0x1234",
    action: "rateloop-test",
    environment: "production",
    responses: [
      {
        identifier: "orb",
        signal_hash: hashSignal(signal),
        proof: encodeAbiParameters([{ type: "uint256[8]" }], [[...TEST_PROOF]]),
        merkle_root: "0x2a",
        nullifier: "0x1234",
      },
    ],
  };
}

test("parses World ID legacy proofs for on-chain attestation", () => {
  const parsed = parseWorldIdLegacyProof(makeLegacyResult(), {
    expectedAction: "rateloop-test",
    expectedSignal: TEST_SIGNAL,
  });

  assert.equal(parsed.root, 42n);
  assert.equal(parsed.nullifierHash, 0x1234n);
  assert.deepEqual(parsed.proof, [...TEST_PROOF]);
  assert.equal(parsed.signalHash, hashSignal(TEST_SIGNAL));
});

test("rejects non-legacy World ID proofs", () => {
  assert.throws(
    () =>
      parseWorldIdLegacyProof(
        {
          protocol_version: "4.0",
          nonce: "0x1234",
          action: "rateloop-test",
          environment: "production",
          responses: [],
        } as any,
        { expectedAction: "rateloop-test", expectedSignal: TEST_SIGNAL },
      ),
    /requires a World ID 3.0 legacy proof/,
  );
});

test("rejects proofs bound to a different wallet signal", () => {
  assert.throws(
    () =>
      parseWorldIdLegacyProof(makeLegacyResult("0x0000000000000000000000000000000000000001"), {
        expectedAction: "rateloop-test",
        expectedSignal: TEST_SIGNAL,
      }),
    /not bound to the connected wallet/,
  );
});
