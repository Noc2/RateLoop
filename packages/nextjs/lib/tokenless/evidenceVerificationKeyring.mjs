import { createHash, createPublicKey } from "node:crypto";

const KEY_ID = /^ed25519:[0-9a-f]{24}$/u;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{59}$/u;

function exactEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid key");
  const keys = Object.keys(value).sort();
  if (keys.join("\0") !== ["algorithm", "keyId", "publicKey", "status"].sort().join("\0")) {
    throw new Error("invalid key");
  }
  return value;
}

export function evidenceVerificationKeyId(publicKeyDer) {
  return `ed25519:${createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24)}`;
}

export function parseEvidenceVerificationKeyring(encoded) {
  if (!encoded?.trim()) return [];
  const value = JSON.parse(encoded);
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new Error("invalid keyring");
  const seen = new Set();
  return value.map(raw => {
    const entry = exactEntry(raw);
    if (
      entry.algorithm !== "Ed25519" ||
      (entry.status !== "current" && entry.status !== "retired") ||
      typeof entry.keyId !== "string" ||
      !KEY_ID.test(entry.keyId) ||
      typeof entry.publicKey !== "string" ||
      !PUBLIC_KEY.test(entry.publicKey)
    ) {
      throw new Error("invalid key");
    }
    const sourcePublicKeyDer = Buffer.from(entry.publicKey, "base64url");
    const publicKey = createPublicKey({ key: sourcePublicKeyDer, format: "der", type: "spki" });
    const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
    if (
      publicKey.asymmetricKeyType !== "ed25519" ||
      !publicKeyDer.equals(sourcePublicKeyDer) ||
      publicKeyDer.toString("base64url") !== entry.publicKey ||
      evidenceVerificationKeyId(publicKeyDer) !== entry.keyId
    ) {
      throw new Error("key ID mismatch");
    }
    const identity = `${entry.keyId}\0${entry.publicKey}`;
    if (seen.has(identity)) throw new Error("duplicate key");
    seen.add(identity);
    return { keyId: entry.keyId, publicKey, publicKeyDer, status: entry.status };
  });
}
