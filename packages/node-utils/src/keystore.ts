import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { keccak256 } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

interface ScryptKdfParams {
  dklen: unknown;
  n: unknown;
  p: unknown;
  r: unknown;
}

interface ParsedKeystore {
  cipherparams: { iv: Buffer };
  ciphertext: Buffer;
  kdfparams: { dklen: number; n: number; p: number; r: number; salt: Buffer };
  mac: Buffer;
}

const KEYSTORE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const MAX_SCRYPT_MEMORY_BYTES = 512 * 1024 * 1024;
const MAX_SCRYPT_PARALLELIZATION = 16;
const MIN_SCRYPT_DKLEN = 32;
const MAX_SCRYPT_DKLEN = 64;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function hexBytes(value: unknown, label: string, expectedBytes?: number): Buffer {
  if (typeof value !== "string" || !/^(?:[0-9a-fA-F]{2})+$/u.test(value)) {
    throw new Error(`${label} must be non-empty even-length hex`);
  }
  const result = Buffer.from(value, "hex");
  if (expectedBytes !== undefined && result.length !== expectedBytes) {
    throw new Error(`${label} must be exactly ${expectedBytes} bytes`);
  }
  return result;
}

export function resolveKeystorePath(name: string): string {
  if (!KEYSTORE_NAME_PATTERN.test(name)) {
    throw new Error("Invalid keystore account name");
  }
  const keystoreDir = resolve(homedir(), ".foundry", "keystores");
  const keystorePath = resolve(keystoreDir, name);
  if (!keystorePath.startsWith(`${keystoreDir}${sep}`)) {
    throw new Error("Invalid keystore account path");
  }
  return keystorePath;
}

export function assertSafeScryptParams(params: ScryptKdfParams): asserts params is {
  dklen: number;
  n: number;
  p: number;
  r: number;
} {
  const { n, r, p, dklen } = params;
  if (
    typeof n !== "number" ||
    typeof r !== "number" ||
    typeof p !== "number" ||
    typeof dklen !== "number" ||
    !Number.isSafeInteger(n) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p) ||
    !Number.isSafeInteger(dklen) ||
    n <= 1 ||
    r <= 0 ||
    p <= 0 ||
    dklen < MIN_SCRYPT_DKLEN ||
    dklen > MAX_SCRYPT_DKLEN
  ) {
    throw new Error("Invalid keystore scrypt parameters");
  }
  if ((n & (n - 1)) !== 0) {
    throw new Error("Keystore scrypt N must be a power of two");
  }
  if (p > MAX_SCRYPT_PARALLELIZATION) {
    throw new Error("Keystore scrypt parallelization is too high");
  }
  const memoryBytes = 128 * n * r;
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes > MAX_SCRYPT_MEMORY_BYTES) {
    throw new Error("Keystore scrypt memory cost is too high");
  }
}

function parseKeystore(rawJson: string): ParsedKeystore {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch {
    throw new Error("Keystore must contain valid JSON");
  }
  const root = object(parsed, "Keystore");
  if (root.version !== 3) throw new Error(`Unsupported keystore version: ${String(root.version)}`);
  const encrypted = object(root.crypto, "Keystore crypto");
  if (encrypted.kdf !== "scrypt") throw new Error(`Unsupported KDF: ${String(encrypted.kdf)}`);
  if (encrypted.cipher !== "aes-128-ctr") {
    throw new Error(`Unsupported cipher: ${String(encrypted.cipher)}`);
  }
  const rawKdfparams = object(encrypted.kdfparams, "Keystore scrypt parameters");
  const scryptParams: ScryptKdfParams = {
    dklen: rawKdfparams.dklen,
    n: rawKdfparams.n,
    p: rawKdfparams.p,
    r: rawKdfparams.r,
  };
  assertSafeScryptParams(scryptParams);
  const cipherparams = object(encrypted.cipherparams, "Keystore cipher parameters");
  return {
    cipherparams: { iv: hexBytes(cipherparams.iv, "Keystore IV", 16) },
    ciphertext: hexBytes(encrypted.ciphertext, "Keystore ciphertext", 32),
    kdfparams: {
      ...scryptParams,
      salt: hexBytes(rawKdfparams.salt, "Keystore salt", 32),
    },
    mac: hexBytes(encrypted.mac, "Keystore MAC", 32),
  };
}

export function decryptKeystoreJson(rawJson: string, password: string): `0x${string}` {
  const keystore = parseKeystore(rawJson);
  const { n, r, p, dklen, salt } = keystore.kdfparams;
  const derivedKey = crypto.scryptSync(Buffer.from(password), salt, dklen, {
    N: n,
    r,
    p,
    maxmem: Math.max(32 * 1024 * 1024, 128 * n * r * 2),
  });
  const macInput = Buffer.concat([derivedKey.subarray(16, 32), keystore.ciphertext]);
  const computedMac = Buffer.from(keccak256(`0x${macInput.toString("hex")}`).slice(2), "hex");
  if (!crypto.timingSafeEqual(computedMac, keystore.mac)) {
    throw new Error("Keystore MAC mismatch — wrong password?");
  }

  const decipher = crypto.createDecipheriv("aes-128-ctr", derivedKey.subarray(0, 16), keystore.cipherparams.iv);
  const privateKey = Buffer.concat([decipher.update(keystore.ciphertext), decipher.final()]);
  return `0x${privateKey.toString("hex")}`;
}

export function decryptKeystore(name: string, password: string): `0x${string}` {
  return decryptKeystoreJson(readFileSync(resolveKeystorePath(name), "utf8"), password);
}

export function getKeystoreAccountFromCredentials(name: string, password: string): PrivateKeyAccount {
  return privateKeyToAccount(decryptKeystore(name, password));
}
