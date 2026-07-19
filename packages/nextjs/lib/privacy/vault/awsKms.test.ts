import { createAwsKmsKeyWrappingProvider, loadAwsKmsProviderConfiguration } from "./awsKms";
import { DecryptCommand, DescribeKeyCommand, EncryptCommand } from "@aws-sdk/client-kms";
import assert from "node:assert/strict";
import { test } from "node:test";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const KEY_ARN = "arn:aws:kms:eu-central-1:123456789012:key/11111111-1111-1111-1111-111111111111";
const OTHER_KEY_ARN = "arn:aws:kms:eu-central-1:123456789012:key/22222222-2222-2222-2222-222222222222";
const AAD = Buffer.from("customer_artifact:ws_workspace1:project_1:art_1:artifact-v2");

function configuration() {
  return {
    keyResourceTemplate: "arn:aws:kms:eu-central-1:123456789012:alias/rateloop/{workspaceId}/{projectId}",
    keyVersion: "artifact-v2",
    region: "eu-central-1",
  };
}

test("AWS KMS configuration requires workload identity in Vercel", () => {
  assert.throws(
    () =>
      loadAwsKmsProviderConfiguration({
        TOKENLESS_ARTIFACT_KEY_VERSION: "artifact-v2",
        TOKENLESS_AWS_KMS_REGION: "eu-central-1",
        TOKENLESS_KMS_KEY_RESOURCE: "arn:aws:kms:eu-central-1:123:alias/rateloop/{workspaceId}",
        TOKENLESS_KMS_PROVIDER: "aws-kms",
        VERCEL: "1",
      } as unknown as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_managed_kms",
  );
});

test("AWS KMS wraps data keys with exact tenant key and authenticated context", async () => {
  const calls: unknown[] = [];
  const client = {
    async send(command: unknown) {
      calls.push(command);
      if (command instanceof DescribeKeyCommand) {
        assert.equal(
          command.input.KeyId,
          "arn:aws:kms:eu-central-1:123456789012:alias/rateloop/ws_workspace1/project_1",
        );
        return { KeyMetadata: { Arn: KEY_ARN, KeyUsage: "ENCRYPT_DECRYPT" } };
      }
      if (command instanceof EncryptCommand) {
        assert.equal(command.input.KeyId, KEY_ARN);
        assert.deepEqual(command.input.EncryptionContext, {
          "rateloop:aad-sha256": "1037dd48374887667cca8573b791deaa8dac55d0f39d4b773452c9d94736ebd4",
          "rateloop:artifact-id": "art_1",
          "rateloop:key-version": "artifact-v2",
          "rateloop:project-id": "project_1",
          "rateloop:workspace-id": "ws_workspace1",
        });
        return { CiphertextBlob: Uint8Array.from([4, 5, 6]), KeyId: KEY_ARN };
      }
      throw new Error("unexpected command");
    },
  };
  const provider = createAwsKmsKeyWrappingProvider({ client: client as never, configuration: configuration() });
  const wrapped = await provider.wrap(Uint8Array.from([1, 2, 3]), AAD);
  assert.equal(wrapped.keyResource, KEY_ARN);
  assert.equal(wrapped.ciphertext, "BAUG");
  assert.equal(calls.length, 2);
});

test("AWS KMS unwrap rejects a ciphertext recorded under another tenant key", async () => {
  const client = {
    async send(command: unknown) {
      if (command instanceof DescribeKeyCommand) {
        return { KeyMetadata: { Arn: OTHER_KEY_ARN, KeyUsage: "ENCRYPT_DECRYPT" } };
      }
      if (command instanceof DecryptCommand) assert.fail("decrypt must not run for another tenant key");
      throw new Error("unexpected command");
    },
  };
  const provider = createAwsKmsKeyWrappingProvider({ client: client as never, configuration: configuration() });
  await assert.rejects(
    () =>
      provider.unwrap(
        {
          authTag: null,
          ciphertext: "BAUG",
          keyResource: KEY_ARN,
          keyVersion: "artifact-v2",
          nonce: null,
          provider: "aws-kms",
        },
        AAD,
      ),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "vault_context_mismatch",
  );
});

test("AWS KMS managed artifact configuration refuses a shared key resource", async () => {
  const provider = createAwsKmsKeyWrappingProvider({
    client: { send: async () => assert.fail("KMS must not be called") } as never,
    configuration: { ...configuration(), keyResourceTemplate: KEY_ARN },
  });
  await assert.rejects(
    () => provider.wrap(Uint8Array.from([1, 2, 3]), AAD),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "tenant_kms_key_required",
  );
});
