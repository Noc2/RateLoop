import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { keccak256 } from "viem";
import {
  assertSafeScryptParams,
  decryptKeystoreJson,
  resolveKeystorePath,
} from "./keystore";

function fixture(password = "correct horse battery staple") {
  const privateKey = Buffer.alloc(32, 0x11);
  const salt = Buffer.alloc(32, 0x22);
  const iv = Buffer.alloc(16, 0x33);
  const kdfparams = { dklen: 32, n: 1024, p: 1, r: 8 };
  const derivedKey = crypto.scryptSync(Buffer.from(password), salt, kdfparams.dklen, {
    N: kdfparams.n,
    r: kdfparams.r,
    p: kdfparams.p,
    maxmem: 32 * 1024 * 1024,
  });
  const cipher = crypto.createCipheriv("aes-128-ctr", derivedKey.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey), cipher.final()]);
  const macInput = Buffer.concat([derivedKey.subarray(16, 32), ciphertext]);
  const mac = keccak256(`0x${macInput.toString("hex")}`).slice(2);
  return {
    json: JSON.stringify({
      version: 3,
      crypto: {
        cipher: "aes-128-ctr",
        ciphertext: ciphertext.toString("hex"),
        cipherparams: { iv: iv.toString("hex") },
        kdf: "scrypt",
        kdfparams: { ...kdfparams, salt: salt.toString("hex") },
        mac,
      },
    }),
    password,
    privateKey: `0x${privateKey.toString("hex")}`,
  };
}

test("resolveKeystorePath rejects traversal and nested names", () => {
  assert.throws(() => resolveKeystorePath("../keeper"), /Invalid keystore account name/);
  assert.throws(() => resolveKeystorePath("nested/keeper"), /Invalid keystore account name/);
  assert.throws(() => resolveKeystorePath("keeper profile"), /Invalid keystore account name/);
  assert.throws(() => resolveKeystorePath("x".repeat(129)), /Invalid keystore account name/);

  assert.match(
    resolveKeystorePath("keeper-prod_1.json"),
    /\/\.foundry\/keystores\/keeper-prod_1\.json$/,
  );
});

test("decryptKeystoreJson validates a complete V3 envelope before returning the key", () => {
  const keystore = fixture();
  assert.equal(decryptKeystoreJson(keystore.json, keystore.password), keystore.privateKey);
  assert.throws(() => decryptKeystoreJson(keystore.json, "wrong password"), /MAC mismatch/);
});

test("decryptKeystoreJson rejects malformed JSON and cryptographic field lengths", () => {
  assert.throws(() => decryptKeystoreJson("not-json", "password"), /valid JSON/);

  const keystore = fixture();
  const parsed = JSON.parse(keystore.json) as {
    crypto: { cipherparams: { iv: string }; ciphertext: string; mac: string };
  };
  parsed.crypto.cipherparams.iv = "00";
  assert.throws(() => decryptKeystoreJson(JSON.stringify(parsed), keystore.password), /IV must be exactly 16 bytes/);

  const shortCiphertext = JSON.parse(keystore.json) as { crypto: { ciphertext: string } };
  shortCiphertext.crypto.ciphertext = "00";
  assert.throws(
    () => decryptKeystoreJson(JSON.stringify(shortCiphertext), keystore.password),
    /ciphertext must be exactly 32 bytes/,
  );
});

test("assertSafeScryptParams accepts bounded Foundry-style costs", () => {
  assert.doesNotThrow(() =>
    assertSafeScryptParams({
      dklen: 32,
      n: 262_144,
      p: 1,
      r: 8,
    }),
  );
});

test("assertSafeScryptParams rejects expensive or malformed costs", () => {
  assert.throws(
    () =>
      assertSafeScryptParams({
        dklen: 32,
        n: 2 ** 24,
        p: 1,
        r: 8,
      }),
    /memory cost is too high/,
  );
  assert.throws(
    () =>
      assertSafeScryptParams({
        dklen: 32,
        n: 262_145,
        p: 1,
        r: 8,
      }),
    /power of two/,
  );
  assert.throws(
    () =>
      assertSafeScryptParams({
        dklen: 32,
        n: 262_144,
        p: 32,
        r: 8,
      }),
    /parallelization is too high/,
  );
  assert.throws(
    () =>
      assertSafeScryptParams({
        dklen: 1024,
        n: 262_144,
        p: 1,
        r: 8,
      }),
    /Invalid keystore scrypt parameters/,
  );
});

test("assertSafeScryptParams rejects dklen below the 32-byte V3 minimum", () => {
  for (const dklen of [16, 31]) {
    assert.throws(
      () =>
        assertSafeScryptParams({
          dklen,
          n: 262_144,
          p: 1,
          r: 8,
        }),
      /Invalid keystore scrypt parameters/,
    );
  }
});
