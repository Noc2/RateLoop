import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { test } from "node:test";
import { parseAwsKmsDerSignature, parseAwsKmsSecp256k1PublicKey } from "./aws-kms-secp256k1";

test("shared KMS parser accepts randomized canonical secp256k1 signatures", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  let paddedScalars = 0;
  for (let index = 0; index < 512; index += 1) {
    const signature = sign("sha256", randomBytes(32), { dsaEncoding: "der", key: privateKey });
    const parsed = parseAwsKmsDerSignature(signature);
    assert.ok(parsed.r > 0n);
    assert.ok(parsed.s > 0n);
    if (signature.includes(Buffer.from([0x02, 0x21, 0x00]))) paddedScalars += 1;
  }
  assert.ok(paddedScalars > 0, "randomized corpus must exercise DER sign padding");
});

test("shared KMS parser rejects malformed and non-canonical signatures", () => {
  const invalid = [
    [Uint8Array.from([0x30, 0x00]), /integer/iu],
    [Uint8Array.from([0x31, 0x00]), /sequence/iu],
    [Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x80, 0x02, 0x01, 0x01]), /negative/iu],
    [Uint8Array.from([0x30, 0x07, 0x02, 0x02, 0x00, 0x01, 0x02, 0x01, 0x01]), /canonical/iu],
    [Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x00, 0x02, 0x01, 0x01]), /range/iu],
    [Uint8Array.from([0x30, 0x81, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]), /canonical/iu],
  ] as const;
  for (const [signature, pattern] of invalid) assert.throws(() => parseAwsKmsDerSignature(signature), pattern);
  assert.throws(
    () =>
      parseAwsKmsDerSignature(
        Uint8Array.from([0x30, 0x26, 0x02, 0x21, 0x01, ...new Uint8Array(32), 0x02, 0x01, 0x01]),
      ),
    /range/iu,
  );
});

test("shared KMS parser validates the exact SPKI curve", () => {
  const secp256k1 = generateKeyPairSync("ec", { namedCurve: "secp256k1" }).publicKey.export({
    format: "der",
    type: "spki",
  });
  assert.match(parseAwsKmsSecp256k1PublicKey(secp256k1), /^0x04[0-9a-f]{128}$/u);

  const prime256v1 = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({
    format: "der",
    type: "spki",
  });
  assert.throws(() => parseAwsKmsSecp256k1PublicKey(prime256v1), /secp256k1/iu);
  assert.throws(() => parseAwsKmsSecp256k1PublicKey(Uint8Array.from([0x04, ...new Uint8Array(64)])), /SPKI/iu);
  assert.throws(
    () => parseAwsKmsSecp256k1PublicKey(Buffer.concat([secp256k1, Buffer.from([0x00])])),
    /canonical/iu,
  );
});
