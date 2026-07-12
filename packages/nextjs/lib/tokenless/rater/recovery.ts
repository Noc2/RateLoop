import { validateTokenlessRaterRoundSecrets } from "./material";
import type { TokenlessRaterRoundSecrets, TokenlessRecoveryPackageV1, TokenlessRevealMaterial } from "./types";
import type { Hex } from "viem";

export const TOKENLESS_RECOVERY_KDF_ITERATIONS = 600_000;
const RECOVERY_SCHEMA = "rateloop.tokenless.rater-recovery.v1" as const;
const RECOVERY_AAD = new TextEncoder().encode(RECOVERY_SCHEMA);
const MAX_RECOVERY_PACKAGE_CHARACTERS = 65_536;

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error("A secure Web Crypto implementation is required for rater recovery.");
  }
  return globalThis.crypto;
}

function validateRecoverySecret(secret: string): void {
  const length = [...secret].length;
  if (length < 12 || length > 1024 || secret.trim().length === 0) {
    throw new Error("Recovery secret must contain between 12 and 1024 characters.");
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string, label: string, expectedLength?: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error(`${label} is not valid base64url.`);
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  } catch {
    throw new Error(`${label} is not valid base64url.`);
  }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new Error(`${label} has the wrong length.`);
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTokenlessRecoveryPackage(serialized: string): TokenlessRecoveryPackageV1 {
  if (serialized.length === 0 || serialized.length > MAX_RECOVERY_PACKAGE_CHARACTERS) {
    throw new Error("Recovery package has an invalid size.");
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Recovery package is not valid JSON.");
  }
  if (!isRecord(value) || !isRecord(value.kdf) || !isRecord(value.cipher)) {
    throw new Error("Recovery package is malformed.");
  }
  if (
    value.schemaVersion !== RECOVERY_SCHEMA ||
    value.kdf.name !== "PBKDF2" ||
    value.kdf.hash !== "SHA-256" ||
    value.kdf.iterations !== TOKENLESS_RECOVERY_KDF_ITERATIONS ||
    typeof value.kdf.salt !== "string" ||
    value.cipher.name !== "AES-GCM" ||
    typeof value.cipher.iv !== "string" ||
    typeof value.cipher.ciphertext !== "string"
  ) {
    throw new Error("Recovery package uses unsupported cryptography or versioning.");
  }
  base64UrlDecode(value.kdf.salt, "KDF salt", 16);
  base64UrlDecode(value.cipher.iv, "AES-GCM IV", 12);
  const ciphertext = base64UrlDecode(value.cipher.ciphertext, "AES-GCM ciphertext");
  if (ciphertext.length < 17 || ciphertext.length > 32_768) {
    throw new Error("AES-GCM ciphertext has an invalid size.");
  }
  return value as unknown as TokenlessRecoveryPackageV1;
}

async function deriveRecoveryKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = webCrypto().subtle;
  const input = await subtle.importKey("raw", new TextEncoder().encode(secret), { name: "PBKDF2" }, false, [
    "deriveKey",
  ]);
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: TOKENLESS_RECOVERY_KDF_ITERATIONS,
    },
    input,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function serializeSecrets(secrets: TokenlessRaterRoundSecrets): Uint8Array {
  const reveal = secrets.reveal;
  return new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: secrets.schemaVersion,
      votePrivateKey: secrets.votePrivateKey,
      payoutPrivateKey: secrets.payoutPrivateKey,
      reveal: { ...reveal, roundId: reveal.roundId.toString(10) },
    }),
  );
}

function deserializeSecrets(plaintext: ArrayBuffer): TokenlessRaterRoundSecrets {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
  } catch {
    throw new Error("Recovery package plaintext is malformed.");
  }
  if (!isRecord(value) || !isRecord(value.reveal)) {
    throw new Error("Recovery package plaintext is malformed.");
  }
  const reveal = value.reveal;
  if (
    value.schemaVersion !== "rateloop.tokenless.rater-secrets.v1" ||
    typeof value.votePrivateKey !== "string" ||
    typeof value.payoutPrivateKey !== "string" ||
    typeof reveal.roundId !== "string" ||
    typeof reveal.voteKey !== "string" ||
    (reveal.vote !== 0 && reveal.vote !== 1) ||
    typeof reveal.predictedUpBps !== "number" ||
    typeof reveal.responseHash !== "string" ||
    typeof reveal.payoutAddress !== "string" ||
    typeof reveal.salt !== "string" ||
    !/^[1-9][0-9]*$/u.test(reveal.roundId)
  ) {
    throw new Error("Recovery package plaintext is malformed.");
  }
  const secrets: TokenlessRaterRoundSecrets = {
    schemaVersion: value.schemaVersion,
    votePrivateKey: value.votePrivateKey as Hex,
    payoutPrivateKey: value.payoutPrivateKey as Hex,
    reveal: {
      roundId: BigInt(reveal.roundId),
      voteKey: reveal.voteKey,
      vote: reveal.vote,
      predictedUpBps: reveal.predictedUpBps,
      responseHash: reveal.responseHash,
      payoutAddress: reveal.payoutAddress,
      salt: reveal.salt,
    } as TokenlessRevealMaterial,
  };
  validateTokenlessRaterRoundSecrets(secrets);
  return secrets;
}

/** Encrypts both one-time keys and self-reveal material locally. */
export async function exportTokenlessRecoveryPackage(
  secrets: TokenlessRaterRoundSecrets,
  recoverySecret: string,
): Promise<string> {
  validateTokenlessRaterRoundSecrets(secrets);
  validateRecoverySecret(recoverySecret);
  const crypto = webCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveRecoveryKey(recoverySecret, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: RECOVERY_AAD, tagLength: 128 },
    key,
    serializeSecrets(secrets),
  );
  const recoveryPackage: TokenlessRecoveryPackageV1 = {
    schemaVersion: RECOVERY_SCHEMA,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: TOKENLESS_RECOVERY_KDF_ITERATIONS,
      salt: base64UrlEncode(salt),
    },
    cipher: {
      name: "AES-GCM",
      iv: base64UrlEncode(iv),
      ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
    },
  };
  return JSON.stringify(recoveryPackage);
}

/** Decrypts an exported package locally and re-validates both key/address bindings. */
export async function importTokenlessRecoveryPackage(
  serialized: string,
  recoverySecret: string,
): Promise<TokenlessRaterRoundSecrets> {
  validateRecoverySecret(recoverySecret);
  const recoveryPackage = parseTokenlessRecoveryPackage(serialized);
  const salt = base64UrlDecode(recoveryPackage.kdf.salt, "KDF salt", 16);
  const iv = base64UrlDecode(recoveryPackage.cipher.iv, "AES-GCM IV", 12);
  const ciphertext = base64UrlDecode(recoveryPackage.cipher.ciphertext, "AES-GCM ciphertext");
  const key = await deriveRecoveryKey(recoverySecret, salt);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await webCrypto().subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: RECOVERY_AAD, tagLength: 128 },
      key,
      ciphertext,
    );
  } catch {
    throw new Error("Recovery package could not be decrypted; the secret or package is incorrect.");
  }
  return deserializeSecrets(plaintext);
}
