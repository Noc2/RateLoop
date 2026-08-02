import { evidenceVerificationKeyId, parseEvidenceVerificationKeyring } from "./evidenceVerificationKeyring.mjs";
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";

function value(env, name) {
  return env[name]?.trim() ?? "";
}

function keyIdentity(keyId, publicKeyDer) {
  return `${keyId}\0${publicKeyDer.toString("base64url")}`;
}

export function parseDecisionPacketVerificationKeyring(encoded, { allowEmpty = false } = {}) {
  let entries;
  try {
    entries = JSON.parse(encoded);
  } catch {
    throw new Error("invalid decision-packet keyring");
  }
  if (!Array.isArray(entries) || entries.length > 16 || (entries.length === 0 && !allowEmpty)) {
    throw new Error(entries?.length === 0 ? "empty decision-packet keyring" : "invalid decision-packet keyring");
  }
  if (entries.length === 0) return [];
  const seen = new Set();
  let current = 0;
  const parsed = entries.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("invalid decision-packet key");
    if (
      (entry.algorithm !== "Ed25519" && entry.algorithm !== "ECDSA-SHA256") ||
      typeof entry.keyId !== "string" ||
      typeof entry.publicKey !== "string" ||
      (entry.status !== "current" && entry.status !== "retired")
    ) {
      throw new Error("invalid decision-packet key");
    }
    const publicKey = createPublicKey({ key: Buffer.from(entry.publicKey, "base64url"), format: "der", type: "spki" });
    const canonical = publicKey.export({ format: "der", type: "spki" });
    const ed25519 = entry.algorithm === "Ed25519";
    if (
      (ed25519 && (publicKey.asymmetricKeyType !== "ed25519" || !/^ed25519:[0-9a-f]{24}$/u.test(entry.keyId))) ||
      (!ed25519 &&
        (publicKey.asymmetricKeyType !== "ec" ||
          publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
          !/^p256:[0-9a-f]{24}$/u.test(entry.keyId) ||
          entry.status !== "retired"))
    ) {
      throw new Error("invalid decision-packet key type");
    }
    const derivedKeyId = `${ed25519 ? "ed25519" : "p256"}:${createHash("sha256")
      .update(canonical)
      .digest("hex")
      .slice(0, 24)}`;
    if (derivedKeyId !== entry.keyId || canonical.toString("base64url") !== entry.publicKey) {
      throw new Error("invalid decision-packet key identity");
    }
    const identity = keyIdentity(entry.keyId, canonical);
    if (seen.has(identity)) throw new Error("duplicate decision-packet key");
    seen.add(identity);
    if (entry.status === "current") current += 1;
    return {
      algorithm: entry.algorithm,
      keyId: entry.keyId,
      publicKey: entry.publicKey,
      publicKeyDer: canonical,
      publicKeyObject: publicKey,
      status: entry.status,
    };
  });
  if (current !== 1) throw new Error("exactly one current decision-packet key is required");
  return parsed;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{attestationVerificationKeys?: Array<{keyId: string, publicKeyDer: Buffer}>}} [options]
 */
export function resolveRequiredEvidenceTrustConfiguration(env, { attestationVerificationKeys = [] } = {}) {
  if (value(env, "NEXT_PUBLIC_TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY")) {
    throw new Error("Evidence signing keys must never use NEXT_PUBLIC_ variables.");
  }
  let privateKey;
  let publicKeyDer;
  try {
    const encoded = value(env, "TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY");
    privateKey = createPrivateKey(
      encoded.includes("BEGIN PRIVATE KEY")
        ? encoded.replaceAll("\\n", "\n")
        : { key: Buffer.from(encoded, "base64url"), format: "der", type: "pkcs8" },
    );
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    publicKeyDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  } catch {
    throw new Error("Evidence signing key must be a dedicated Ed25519 PKCS#8 private key.");
  }
  const keyId = evidenceVerificationKeyId(publicKeyDer);
  if (value(env, "TOKENLESS_EVIDENCE_SIGNING_KEY_ID") !== keyId) {
    throw new Error("Evidence signing key ID must match its public-key fingerprint.");
  }
  let decisionPacketVerificationKeys;
  try {
    decisionPacketVerificationKeys = parseDecisionPacketVerificationKeyring(
      value(env, "TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS"),
    );
  } catch {
    throw new Error("Decision-packet verification keys must publish exactly one current Ed25519 evidence key.");
  }
  const matchingCurrent = decisionPacketVerificationKeys.filter(
    entry => entry.status === "current" && entry.keyId === keyId && entry.publicKeyDer.equals(publicKeyDer),
  );
  if (matchingCurrent.length !== 1) {
    throw new Error("Decision-packet verification keys must publish exactly one current Ed25519 evidence key.");
  }

  let humanReviewVerificationKeys = [];
  const encodedHumanReviewKeys = value(env, "TOKENLESS_EVIDENCE_VERIFICATION_KEYS");
  if (encodedHumanReviewKeys) {
    try {
      humanReviewVerificationKeys = parseEvidenceVerificationKeyring(encodedHumanReviewKeys);
    } catch {
      throw new Error("The human-review-gate evidence verification keyring is invalid.");
    }
  }
  const evidenceIdentities = new Set([
    keyIdentity(keyId, publicKeyDer),
    ...decisionPacketVerificationKeys.map(entry => keyIdentity(entry.keyId, entry.publicKeyDer)),
    ...humanReviewVerificationKeys.map(entry => keyIdentity(entry.keyId, entry.publicKeyDer)),
  ]);
  if (attestationVerificationKeys.some(entry => evidenceIdentities.has(keyIdentity(entry.keyId, entry.publicKeyDer)))) {
    throw new Error("Attestation verification keys must remain purpose-bound from evidence and review-gate keys.");
  }
  return {
    privateKeyFingerprint: createHash("sha256")
      .update(privateKey.export({ format: "der", type: "pkcs8" }))
      .digest(),
    keyId,
    publicKeyDer,
    decisionPacketVerificationKeys,
    humanReviewVerificationKeys,
  };
}
