import {
  __awsKmsEvidenceSignerTestUtils,
  createAwsKmsEvidenceSigner,
  loadAwsKmsEvidenceSignerConfiguration,
} from "./awsKmsEvidenceSigner";
import { GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { test } from "node:test";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const KEY_ARN = "arn:aws:kms:eu-central-1:123456789012:key/11111111-1111-1111-1111-111111111111";
const DOCUMENT = Buffer.from("canonical RateLoop evidence packet");
const KEY_PAIR = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PUBLIC_KEY = createPublicKey(KEY_PAIR.privateKey).export({ format: "der", type: "spki" });
const EXPECTED_KEY_ID = __awsKmsEvidenceSignerTestUtils.keyId(PUBLIC_KEY);

function configuration() {
  return {
    expectedKeyId: EXPECTED_KEY_ID,
    keyResource: "alias/rateloop-evidence",
    region: "eu-central-1",
  };
}

test("AWS KMS evidence signer pins its P-256 key and signs the canonical document digest", async () => {
  const calls: unknown[] = [];
  const signer = createAwsKmsEvidenceSigner({
    client: {
      async send(command: unknown) {
        calls.push(command);
        if (command instanceof GetPublicKeyCommand) {
          return {
            KeyId: KEY_ARN,
            KeySpec: "ECC_NIST_P256",
            KeyUsage: "SIGN_VERIFY",
            PublicKey: PUBLIC_KEY,
            SigningAlgorithms: ["ECDSA_SHA_256"],
          };
        }
        if (command instanceof SignCommand) {
          assert.equal(command.input.KeyId, KEY_ARN);
          assert.equal(command.input.MessageType, "DIGEST");
          assert.deepEqual(command.input.Message, createHash("sha256").update(DOCUMENT).digest());
          return {
            KeyId: KEY_ARN,
            Signature: sign("sha256", DOCUMENT, KEY_PAIR.privateKey),
            SigningAlgorithm: "ECDSA_SHA_256",
          };
        }
        throw new Error("unexpected command");
      },
    } as never,
    configuration: configuration(),
  });

  const metadata = await signer.metadata();
  assert.deepEqual(metadata, {
    algorithm: "ECDSA-SHA256",
    keyId: EXPECTED_KEY_ID,
    publicKey: Buffer.from(PUBLIC_KEY).toString("base64url"),
  });
  const signature = Buffer.from(await signer.sign(DOCUMENT), "base64url");
  assert.equal(verify("sha256", DOCUMENT, KEY_PAIR.publicKey, signature), true);
  assert.equal(calls.filter(call => call instanceof GetPublicKeyCommand).length, 1);
});

test("AWS KMS evidence signer rejects a configured fingerprint mismatch before signing", async () => {
  const signer = createAwsKmsEvidenceSigner({
    client: {
      async send(command: unknown) {
        if (command instanceof GetPublicKeyCommand) {
          return {
            KeyId: KEY_ARN,
            KeySpec: "ECC_NIST_P256",
            KeyUsage: "SIGN_VERIFY",
            PublicKey: PUBLIC_KEY,
            SigningAlgorithms: ["ECDSA_SHA_256"],
          };
        }
        assert.fail("sign must not run for an unpinned key");
      },
    } as never,
    configuration: { ...configuration(), expectedKeyId: "p256:000000000000000000000000" },
  });
  await assert.rejects(
    () => signer.sign(DOCUMENT),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "assurance_evidence_signing_unavailable",
  );
});

test("AWS KMS evidence configuration is fail-closed", () => {
  assert.throws(
    () => loadAwsKmsEvidenceSignerConfiguration({} as NodeJS.ProcessEnv),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "assurance_evidence_signing_unavailable",
  );
});
