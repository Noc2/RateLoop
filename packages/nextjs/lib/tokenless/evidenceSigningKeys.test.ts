import { configuredDecisionPacketVerificationKeys, parseDecisionPacketVerificationKeys } from "./evidenceSigningKeys";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

function ed25519Entry(status: "current" | "retired" = "current") {
  const key = generateKeyPairSync("ed25519");
  const publicKey = key.publicKey.export({ format: "der", type: "spki" });
  return {
    algorithm: "Ed25519",
    keyId: `ed25519:${createHash("sha256").update(publicKey).digest("hex").slice(0, 24)}`,
    publicKey: publicKey.toString("base64url"),
    status,
  };
}

function testSigningPrivateKey() {
  return generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
}

function historicalP256Entry() {
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = key.publicKey.export({ format: "der", type: "spki" });
  return {
    algorithm: "ECDSA-SHA256",
    keyId: `p256:${createHash("sha256").update(publicKey).digest("hex").slice(0, 24)}`,
    publicKey: publicKey.toString("base64url"),
    status: "retired",
  };
}

test("decision packet trust history accepts one current Ed25519 key and retired predecessors", () => {
  const current = ed25519Entry();
  const retired = ed25519Entry("retired");
  const historical = historicalP256Entry();
  const parsed = parseDecisionPacketVerificationKeys(JSON.stringify([current, retired, historical]));
  assert.deepEqual(
    parsed.map(key => ({ algorithm: key.algorithm, keyId: key.keyId, status: key.status })),
    [
      { algorithm: "Ed25519", keyId: current.keyId, status: "current" },
      { algorithm: "Ed25519", keyId: retired.keyId, status: "retired" },
      { algorithm: "ECDSA-SHA256", keyId: historical.keyId, status: "retired" },
    ],
  );
  assert.equal(parsed[0]?.publicKeyJwk.kty, "OKP");
  assert.equal(parsed[0]?.publicKeyJwk.crv, "Ed25519");
});

test("decision packet trust history rejects unpinned fingerprints and ambiguous current keys", () => {
  const first = ed25519Entry();
  assert.throws(() =>
    parseDecisionPacketVerificationKeys(JSON.stringify([{ ...first, keyId: `ed25519:${"00".repeat(12)}` }])),
  );
  assert.throws(() => parseDecisionPacketVerificationKeys(JSON.stringify([first, ed25519Entry()])));
  assert.throws(() =>
    parseDecisionPacketVerificationKeys(JSON.stringify([first, { ...historicalP256Entry(), status: "current" }])),
  );
});

test("platform-secret signer may derive its Ed25519 trust history without a configured keyring", () => {
  const env = { TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY: testSigningPrivateKey() };
  assert.deepEqual(configuredDecisionPacketVerificationKeys(env), []);
  assert.deepEqual(
    configuredDecisionPacketVerificationKeys({
      ...env,
      TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS: "[]",
    }),
    [],
  );
});

test("missing signer still requires a valid non-empty Ed25519 keyring", () => {
  const current = ed25519Entry();
  assert.throws(() => configuredDecisionPacketVerificationKeys({}), /verification keys are unavailable/u);
  assert.deepEqual(
    configuredDecisionPacketVerificationKeys({
      TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS: JSON.stringify([current]),
    }).map(key => key.keyId),
    [current.keyId],
  );
});

test("test signer does not hide a malformed configured keyring", () => {
  assert.throws(
    () =>
      configuredDecisionPacketVerificationKeys({
        TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS: "not-json",
        TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY: testSigningPrivateKey(),
      }),
    /verification keys are invalid/u,
  );
});
