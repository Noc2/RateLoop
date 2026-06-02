import crypto from "crypto";
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";

interface KeystoreV3 {
  version: 3;
  crypto: {
    cipher: string;
    ciphertext: string;
    cipherparams: { iv: string };
    kdf: string;
    kdfparams: {
      dklen: number;
      n: number;
      p: number;
      r: number;
      salt: string;
    };
    mac: string;
  };
}

interface ScryptKdfParams {
  dklen: unknown;
  n: unknown;
  p: unknown;
  r: unknown;
}

const KEYSTORE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_SCRYPT_MEMORY_BYTES = 512 * 1024 * 1024;
const MAX_SCRYPT_PARALLELIZATION = 16;
const MIN_SCRYPT_DKLEN = 16;
const MAX_SCRYPT_DKLEN = 64;

export function resolveKeystorePath(name: string): string {
  if (!KEYSTORE_NAME_PATTERN.test(name)) {
    throw new Error("Invalid keystore account name");
  }

  const keystoreDir = resolve(homedir(), ".foundry", "keystores");
  const keystorePath = resolve(keystoreDir, name);
  if (!keystorePath.startsWith(`${keystoreDir}/`) && keystorePath !== keystoreDir) {
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

export function decryptKeystore(name: string, password: string): `0x${string}` {
  const keystorePath = resolveKeystorePath(name);
  const raw = readFileSync(keystorePath, "utf-8");
  const keystore: KeystoreV3 = JSON.parse(raw);

  if (keystore.version !== 3) {
    throw new Error(`Unsupported keystore version: ${keystore.version}`);
  }
  if (keystore.crypto.kdf !== "scrypt") {
    throw new Error(`Unsupported KDF: ${keystore.crypto.kdf}`);
  }
  if (keystore.crypto.cipher !== "aes-128-ctr") {
    throw new Error(`Unsupported cipher: ${keystore.crypto.cipher}`);
  }

  const { n, r, p, dklen, salt } = keystore.crypto.kdfparams;
  assertSafeScryptParams(keystore.crypto.kdfparams);
  const saltBuf = Buffer.from(salt, "hex");
  const ciphertext = Buffer.from(keystore.crypto.ciphertext, "hex");

  const derivedKey = crypto.scryptSync(Buffer.from(password), saltBuf, dklen, {
    N: n,
    r,
    p,
    maxmem: Math.max(32 * 1024 * 1024, 128 * n * r * 2),
  });

  const macInput = Buffer.concat([derivedKey.subarray(16, 32), ciphertext]);
  const computedMac = keccak256(`0x${macInput.toString("hex")}`).slice(2);

  if (computedMac !== keystore.crypto.mac) {
    throw new Error("Keystore MAC mismatch — wrong password?");
  }

  const iv = Buffer.from(keystore.crypto.cipherparams.iv, "hex");
  const decipher = crypto.createDecipheriv("aes-128-ctr", derivedKey.subarray(0, 16), iv);
  const privateKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return `0x${privateKey.toString("hex")}` as `0x${string}`;
}

export function getKeystoreAccountFromCredentials(name: string, password: string): PrivateKeyAccount {
  return privateKeyToAccount(decryptKeystore(name, password));
}
