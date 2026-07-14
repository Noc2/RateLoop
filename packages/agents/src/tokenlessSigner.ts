import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import { keccak256, parseSignature, type Hex } from "viem";

const KEYSTORE_VERSION = 3;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

type KeystoreV3 = {
  version: 3;
  id: string;
  address: string;
  crypto: {
    cipher: "aes-128-ctr";
    cipherparams: { iv: string };
    ciphertext: string;
    kdf: "scrypt";
    kdfparams: { dklen: 32; n: number; p: number; r: number; salt: string };
    mac: string;
  };
};

function assertPassword(password: string) {
  if (!password.trim()) throw new Error("A non-empty keystore password is required.");
}

function deriveKey(password: string, salt: Buffer) {
  assertPassword(password);
  return scryptSync(password, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 32 * 1024 * 1024,
  });
}

function keystoreFor(privateKey: Hex, password: string, address: string): KeystoreV3 {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const derivedKey = deriveKey(password, salt);
  const cipher = createCipheriv("aes-128-ctr", derivedKey.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(privateKey.slice(2), "hex")), cipher.final()]);
  const mac = keccak256(`0x${Buffer.concat([derivedKey.subarray(16, 32), ciphertext]).toString("hex")}`).slice(2);
  return {
    version: KEYSTORE_VERSION,
    id: randomBytes(16).toString("hex"),
    address: address.slice(2).toLowerCase(),
    crypto: {
      cipher: "aes-128-ctr",
      cipherparams: { iv: iv.toString("hex") },
      ciphertext: ciphertext.toString("hex"),
      kdf: "scrypt",
      kdfparams: { dklen: 32, n: SCRYPT_N, p: SCRYPT_P, r: SCRYPT_R, salt: salt.toString("hex") },
      mac,
    },
  };
}

function privateKeyFromKeystore(raw: string, password: string): Hex {
  let keystore: KeystoreV3;
  try {
    keystore = JSON.parse(raw) as KeystoreV3;
  } catch {
    throw new Error("The agent keystore is not valid JSON.");
  }
  if (keystore.version !== KEYSTORE_VERSION || keystore.crypto?.kdf !== "scrypt" || keystore.crypto?.cipher !== "aes-128-ctr") {
    throw new Error("Unsupported agent keystore format.");
  }
  const params = keystore.crypto.kdfparams;
  if (params.dklen !== 32 || params.n !== SCRYPT_N || params.r !== SCRYPT_R || params.p !== SCRYPT_P) {
    throw new Error("Unsupported or unsafe agent keystore KDF parameters.");
  }
  const derivedKey = deriveKey(password, Buffer.from(params.salt, "hex"));
  const ciphertext = Buffer.from(keystore.crypto.ciphertext, "hex");
  const expectedMac = Buffer.from(keystore.crypto.mac.replace(/^0x/, ""), "hex");
  const actualMac = Buffer.from(keccak256(`0x${Buffer.concat([derivedKey.subarray(16, 32), ciphertext]).toString("hex")}`).slice(2), "hex");
  if (expectedMac.length !== actualMac.length || !timingSafeEqual(expectedMac, actualMac)) {
    throw new Error("Agent keystore MAC mismatch. Check the password.");
  }
  const decipher = createDecipheriv("aes-128-ctr", derivedKey.subarray(0, 16), Buffer.from(keystore.crypto.cipherparams.iv, "hex"));
  const privateKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (privateKey.length !== 32) throw new Error("Agent keystore private key has an invalid length.");
  return `0x${privateKey.toString("hex")}` as Hex;
}

export async function createTokenlessAgentKeystore(input: {
  path: string;
  password: string;
  overwrite?: boolean;
}) {
  const path = resolve(input.path);
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(keystoreFor(privateKey, input.password, account.address), null, 2)}\n`, {
    flag: input.overwrite ? "w" : "wx",
    mode: 0o600,
  });
  await chmod(path, 0o600);
  return { address: account.address, path };
}

export async function loadTokenlessAgentAccount(input: { path: string; password: string }): Promise<PrivateKeyAccount> {
  const path = resolve(input.path);
  const privateKey = privateKeyFromKeystore(await readFile(path, "utf8"), input.password);
  return privateKeyToAccount(privateKey);
}

export function splitTokenlessSignature(signature: Hex) {
  const parsed = parseSignature(signature);
  const v = parsed.v === undefined ? parsed.yParity + 27 : Number(parsed.v);
  if (v !== 27 && v !== 28) throw new Error("The signer returned an unsupported signature recovery value.");
  return { v, r: parsed.r, s: parsed.s };
}
