import { parseDecisionPacketVerificationKeys } from "./evidenceSigningKeys";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

function p256Entry(status: "current" | "retired" = "current") {
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = key.publicKey.export({ format: "der", type: "spki" });
  return {
    algorithm: "ECDSA-SHA256",
    keyId: `p256:${createHash("sha256").update(publicKey).digest("hex").slice(0, 24)}`,
    publicKey: publicKey.toString("base64url"),
    status,
  };
}

test("decision packet trust history accepts one current P-256 key and retired predecessors", () => {
  const current = p256Entry();
  const retired = p256Entry("retired");
  const parsed = parseDecisionPacketVerificationKeys(JSON.stringify([current, retired]));
  assert.deepEqual(
    parsed.map(key => ({ algorithm: key.algorithm, keyId: key.keyId, status: key.status })),
    [
      { algorithm: "ECDSA-SHA256", keyId: current.keyId, status: "current" },
      { algorithm: "ECDSA-SHA256", keyId: retired.keyId, status: "retired" },
    ],
  );
  assert.equal(parsed[0]?.publicKeyJwk.kty, "EC");
  assert.equal(parsed[0]?.publicKeyJwk.crv, "P-256");
});

test("decision packet trust history rejects unpinned fingerprints and ambiguous current keys", () => {
  const first = p256Entry();
  assert.throws(() =>
    parseDecisionPacketVerificationKeys(JSON.stringify([{ ...first, keyId: `p256:${"00".repeat(12)}` }])),
  );
  assert.throws(() => parseDecisionPacketVerificationKeys(JSON.stringify([first, p256Entry()])));
});
