import { __awsKmsWalletJwtSignerTestUtils, createAwsKmsWalletJwtSigner } from "./awsKmsWalletJwtSigner";
import { GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { test } from "node:test";
import { AuthError } from "~~/lib/auth/session";

const KEY_ARN = "arn:aws:kms:eu-central-1:123456789012:key/11111111-1111-1111-1111-111111111111";
const KEY = generateKeyPairSync("ed25519");
const PUBLIC_KEY = KEY.publicKey.export({ format: "der", type: "spki" });
const KEY_ID = __awsKmsWalletJwtSignerTestUtils.fingerprint(PUBLIC_KEY);
const PAYLOAD = Buffer.from("header.payload");

test("AWS KMS wallet signer pins Ed25519 metadata and signs JWT input without exporting the key", async () => {
  const calls: unknown[] = [];
  const signer = createAwsKmsWalletJwtSigner({
    client: {
      async send(command: unknown) {
        calls.push(command);
        if (command instanceof GetPublicKeyCommand) {
          return {
            KeyId: KEY_ARN,
            KeySpec: "ECC_NIST_EDWARDS25519",
            KeyUsage: "SIGN_VERIFY",
            PublicKey: PUBLIC_KEY,
            SigningAlgorithms: ["ED25519_SHA_512"],
          };
        }
        if (command instanceof SignCommand) {
          assert.equal(command.input.KeyId, KEY_ARN);
          assert.equal(command.input.MessageType, "RAW");
          assert.deepEqual(command.input.Message, PAYLOAD);
          return {
            KeyId: KEY_ARN,
            Signature: sign(null, PAYLOAD, KEY.privateKey),
            SigningAlgorithm: "ED25519_SHA_512",
          };
        }
        throw new Error("unexpected command");
      },
    } as never,
    configuration: { expectedKeyId: KEY_ID, keyResource: "alias/wallet", region: "eu-central-1" },
  });
  const metadata = await signer.metadata();
  assert.equal(metadata.keyId, KEY_ID);
  assert.equal(metadata.publicJwk.kty, "OKP");
  const signature = await signer.sign(PAYLOAD);
  assert.equal(verify(null, PAYLOAD, KEY.publicKey, signature), true);
  assert.equal(calls.filter(call => call instanceof GetPublicKeyCommand).length, 1);
});

test("AWS KMS wallet signer refuses an unexpected key fingerprint before signing", async () => {
  const signer = createAwsKmsWalletJwtSigner({
    client: {
      async send(command: unknown) {
        if (command instanceof GetPublicKeyCommand) {
          return {
            KeyId: KEY_ARN,
            KeySpec: "ECC_NIST_EDWARDS25519",
            KeyUsage: "SIGN_VERIFY",
            PublicKey: PUBLIC_KEY,
            SigningAlgorithms: ["ED25519_SHA_512"],
          };
        }
        assert.fail("sign must not run");
      },
    } as never,
    configuration: {
      expectedKeyId: `ed25519:${"00".repeat(12)}`,
      keyResource: "alias/wallet",
      region: "eu-central-1",
    },
  });
  await assert.rejects(
    () => signer.sign(PAYLOAD),
    (error: unknown) => error instanceof AuthError && error.status === 503,
  );
});
