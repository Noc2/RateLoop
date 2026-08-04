import { parseAttestationVerificationKeyring } from "./assuranceAttestationConfiguration.mjs";
import {
  configuredDecisionPacketVerificationKeys,
  parseDecisionPacketVerificationKeys,
  projectPublicEvidenceTrustedKeyHistory,
  projectWorkspaceEvidenceSigningKeyHistory,
} from "./evidenceSigningKeys";
import { resolveRequiredEvidenceTrustConfiguration } from "./evidenceTrustConfiguration.mjs";
import {
  __setHumanReviewGateEvidenceConfigForTests,
  projectHumanReviewGateTrustedKeyHistory,
} from "./humanReviewGateEvidence";
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

test("public trust history includes configured decision-packet pins without a workspace session", () => {
  const current = ed25519Entry();
  const attestation = ed25519Entry();
  const retired = historicalP256Entry();
  const gate = generateKeyPairSync("ed25519");
  __setHumanReviewGateEvidenceConfigForTests({
    signingPrivateKey: gate.privateKey,
    verificationKeys: [{ publicKey: gate.publicKey, status: "current" }],
  });
  try {
    const history = projectPublicEvidenceTrustedKeyHistory({
      TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS: JSON.stringify([current, retired]),
      TOKENLESS_ATTESTATION_VERIFICATION_KEYS: JSON.stringify([attestation]),
    });
    assert.equal(history.schemaVersion, "rateloop.evidence-public-trusted-keys.v1");
    assert.deepEqual(
      history.keys
        .filter(key => key.uses.includes("decision_packet"))
        .map(key => ({ algorithm: key.algorithm, keyId: key.keyId, status: key.status })),
      [
        { algorithm: "Ed25519", keyId: current.keyId, status: "current" },
        { algorithm: "ECDSA-SHA256", keyId: retired.keyId, status: "retired" },
      ],
    );
    assert.deepEqual(
      history.keys
        .filter(key => key.uses.includes("external_attestation"))
        .map(key => ({ keyId: key.keyId, uses: key.uses })),
      [{ keyId: attestation.keyId, uses: ["external_attestation"] }],
    );
    assert.equal(history.keys.find(key => key.keyId === attestation.keyId)?.uses.includes("human_review_gate"), false);
  } finally {
    __setHumanReviewGateEvidenceConfigForTests(null);
  }
});

test("public and workspace trust histories merge a shared review-gate and decision-packet key", () => {
  const signer = generateKeyPairSync("ed25519");
  const publicKey = signer.publicKey.export({ format: "der", type: "spki" });
  const current = {
    algorithm: "Ed25519",
    keyId: `ed25519:${createHash("sha256").update(publicKey).digest("hex").slice(0, 24)}`,
    publicKey: publicKey.toString("base64url"),
    status: "current",
  } as const;
  __setHumanReviewGateEvidenceConfigForTests({
    signingPrivateKey: signer.privateKey,
    verificationKeys: [{ publicKey: signer.publicKey, status: "current" }],
  });
  try {
    const env = { TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS: JSON.stringify([current]) };
    const publicHistory = projectPublicEvidenceTrustedKeyHistory(env);
    const workspaceHistory = projectWorkspaceEvidenceSigningKeyHistory({
      workspaceId: "workspace-1",
      gateKeys: projectHumanReviewGateTrustedKeyHistory().keys,
      decisionKeys: configuredDecisionPacketVerificationKeys(env),
      packetRows: [
        {
          signing_key_id: current.keyId,
          signing_public_key: current.publicKey,
          first_seen_at: "2026-08-01T00:00:00.000Z",
          last_seen_at: "2026-08-02T00:00:00.000Z",
          packet_count: 3,
        },
      ],
    });

    assert.deepEqual(
      publicHistory.keys.filter(key => key.keyId === current.keyId).map(key => key.uses),
      [["human_review_gate", "decision_packet"]],
    );
    assert.deepEqual(
      workspaceHistory.keys.filter(key => key.keyId === current.keyId).map(key => key.uses),
      [["human_review_gate", "decision_packet"]],
    );
    assert.equal(workspaceHistory.keys.find(key => key.keyId === current.keyId)?.packetCount, 3);
    assert.equal(workspaceHistory.untrustedPacketKeyCount, 0);
  } finally {
    __setHumanReviewGateEvidenceConfigForTests(null);
  }
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

test("readiness and runtime consumers share strict decision-packet keyring validation", () => {
  const signer = generateKeyPairSync("ed25519");
  const publicKey = signer.publicKey.export({ format: "der", type: "spki" });
  const current = {
    algorithm: "Ed25519",
    keyId: `ed25519:${createHash("sha256").update(publicKey).digest("hex").slice(0, 24)}`,
    publicKey: publicKey.toString("base64url"),
    status: "current",
  } as const;
  const retired = ed25519Entry("retired");
  const encoded = JSON.stringify([current, retired, retired]);
  const env = {
    TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY: signer.privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url"),
    TOKENLESS_EVIDENCE_SIGNING_KEY_ID: current.keyId,
    TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS: encoded,
  };

  assert.throws(() => parseDecisionPacketVerificationKeys(encoded), /verification keys are invalid/u);
  assert.throws(
    () => resolveRequiredEvidenceTrustConfiguration(env),
    /Decision-packet verification keys must publish exactly one current Ed25519 evidence key/u,
  );
});

test("readiness and the public trust projection reject historical cross-purpose attestation keys", () => {
  const signer = generateKeyPairSync("ed25519");
  const publicKey = signer.publicKey.export({ format: "der", type: "spki" });
  const current = {
    algorithm: "Ed25519",
    keyId: `ed25519:${createHash("sha256").update(publicKey).digest("hex").slice(0, 24)}`,
    publicKey: publicKey.toString("base64url"),
    status: "current",
  } as const;
  const attestationCurrent = ed25519Entry();
  const attestationKeyring = JSON.stringify([attestationCurrent, { ...current, status: "retired" }]);
  const env = {
    TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY: signer.privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url"),
    TOKENLESS_EVIDENCE_SIGNING_KEY_ID: current.keyId,
    TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS: JSON.stringify([current]),
    TOKENLESS_ATTESTATION_VERIFICATION_KEYS: attestationKeyring,
  };
  const attestationVerificationKeys = parseAttestationVerificationKeyring(attestationKeyring);
  const gate = generateKeyPairSync("ed25519");
  __setHumanReviewGateEvidenceConfigForTests({
    signingPrivateKey: gate.privateKey,
    verificationKeys: [{ publicKey: gate.publicKey, status: "current" }],
  });

  try {
    assert.throws(
      () => resolveRequiredEvidenceTrustConfiguration(env, { attestationVerificationKeys }),
      /Attestation verification keys must remain purpose-bound/u,
    );
    assert.throws(
      () => projectPublicEvidenceTrustedKeyHistory(env),
      /Attestation verification keys must remain purpose-bound/u,
    );
  } finally {
    __setHumanReviewGateEvidenceConfigForTests(null);
  }
});
