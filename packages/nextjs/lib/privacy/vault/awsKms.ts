import type { KeyWrappingProvider, WrappedDataKey } from "./index";
import {
  DecryptCommand,
  DescribeKeyCommand,
  EncryptCommand,
  KMSClient,
  type KMSClientConfig,
} from "@aws-sdk/client-kms";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { createHash } from "node:crypto";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const AWS_KMS_PROVIDER = "aws-kms";
const KMS_TIMEOUT_MS = 8_000;
const KEY_RESOURCE_TEMPLATE_FIELDS = ["{workspaceId}", "{projectId}"] as const;
const ARTIFACT_AAD_PATTERN =
  /^customer_artifact:(?<workspaceId>[A-Za-z0-9_-]{1,160}):(?<projectId>[A-Za-z0-9_-]{1,160}):(?<artifactId>[A-Za-z0-9_-]{1,160}):(?<keyVersion>[A-Za-z0-9._:-]{1,120})$/u;

type KmsClient = Pick<KMSClient, "send">;

type AwsKmsProviderConfiguration = Readonly<{
  keyResourceTemplate: string;
  keyVersion: string;
  oidcAudience?: string;
  region: string;
  roleArn?: string;
}>;

function required(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new TokenlessServiceError(`${name} is required for managed KMS.`, 503, "invalid_managed_kms");
  }
  return normalized;
}

function parseArtifactAad(aad: Uint8Array) {
  const value = Buffer.from(aad).toString("utf8");
  const match = ARTIFACT_AAD_PATTERN.exec(value);
  if (!match?.groups) {
    throw new TokenlessServiceError("Artifact KMS context is invalid.", 500, "invalid_artifact_key_metadata");
  }
  return {
    aadHash: createHash("sha256").update(aad).digest("hex"),
    artifactId: match.groups.artifactId!,
    keyVersion: match.groups.keyVersion!,
    projectId: match.groups.projectId!,
    workspaceId: match.groups.workspaceId!,
  };
}

function resolveKeyResource(template: string, context: ReturnType<typeof parseArtifactAad>) {
  if (!KEY_RESOURCE_TEMPLATE_FIELDS.some(field => template.includes(field))) {
    throw new TokenlessServiceError(
      "Managed artifact KMS must use a workspace- or project-scoped key resource template.",
      503,
      "tenant_kms_key_required",
    );
  }
  const resolved = template
    .replaceAll("{workspaceId}", context.workspaceId)
    .replaceAll("{projectId}", context.projectId);
  if (resolved.includes("{") || resolved.includes("}")) {
    throw new TokenlessServiceError("Managed artifact KMS template is invalid.", 503, "invalid_managed_kms");
  }
  return resolved;
}

function encryptionContext(context: ReturnType<typeof parseArtifactAad>) {
  return {
    "rateloop:aad-sha256": context.aadHash,
    "rateloop:artifact-id": context.artifactId,
    "rateloop:key-version": context.keyVersion,
    "rateloop:project-id": context.projectId,
    "rateloop:workspace-id": context.workspaceId,
  };
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KMS_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (error instanceof TokenlessServiceError) throw error;
    const unavailable = new TokenlessServiceError("Managed KMS is unavailable.", 503, "vault_key_unavailable", true);
    unavailable.cause = error;
    throw unavailable;
  } finally {
    clearTimeout(timeout);
  }
}

function kmsClientConfiguration(input: AwsKmsProviderConfiguration): KMSClientConfig {
  if (!input.roleArn) return { region: input.region };
  return {
    credentials: awsCredentialsProvider({
      roleArn: input.roleArn,
      ...(input.oidcAudience ? { audience: input.oidcAudience } : {}),
    }),
    region: input.region,
  };
}

export function loadAwsKmsProviderConfiguration(env: NodeJS.ProcessEnv = process.env): AwsKmsProviderConfiguration {
  if (required(env.TOKENLESS_KMS_PROVIDER, "TOKENLESS_KMS_PROVIDER") !== AWS_KMS_PROVIDER) {
    throw new TokenlessServiceError(
      "The configured managed KMS provider has no production adapter.",
      503,
      "artifact_kms_adapter_unavailable",
    );
  }
  const roleArn = env.TOKENLESS_AWS_KMS_ROLE_ARN?.trim();
  if (env.VERCEL === "1" && !roleArn) {
    throw new TokenlessServiceError(
      "TOKENLESS_AWS_KMS_ROLE_ARN is required for Vercel workload identity.",
      503,
      "invalid_managed_kms",
    );
  }
  return {
    keyResourceTemplate: required(env.TOKENLESS_KMS_KEY_RESOURCE, "TOKENLESS_KMS_KEY_RESOURCE"),
    keyVersion: required(env.TOKENLESS_ARTIFACT_KEY_VERSION, "TOKENLESS_ARTIFACT_KEY_VERSION"),
    ...(env.TOKENLESS_AWS_OIDC_AUDIENCE?.trim() ? { oidcAudience: env.TOKENLESS_AWS_OIDC_AUDIENCE.trim() } : {}),
    region: required(env.TOKENLESS_AWS_KMS_REGION, "TOKENLESS_AWS_KMS_REGION"),
    ...(roleArn ? { roleArn } : {}),
  };
}

export function createAwsKmsKeyWrappingProvider(input: {
  client?: KmsClient;
  configuration: AwsKmsProviderConfiguration;
}): KeyWrappingProvider {
  let client = input.client;
  const getClient = () => (client ??= new KMSClient(kmsClientConfiguration(input.configuration)));
  const resolvedKeys = new Map<string, string>();

  async function resolveExactKeyResource(keyResource: string, signal: AbortSignal) {
    const cached = resolvedKeys.get(keyResource);
    if (cached) return cached;
    const described = await getClient().send(new DescribeKeyCommand({ KeyId: keyResource }), { abortSignal: signal });
    const arn = described.KeyMetadata?.Arn?.trim();
    if (!arn || described.KeyMetadata?.KeyUsage !== "ENCRYPT_DECRYPT") {
      throw new Error("Managed artifact key is missing or cannot encrypt data keys.");
    }
    resolvedKeys.set(keyResource, arn);
    return arn;
  }

  return {
    keyResource: input.configuration.keyResourceTemplate,
    keyVersion: input.configuration.keyVersion,
    provider: AWS_KMS_PROVIDER,
    async wrap(dataKey, aad): Promise<WrappedDataKey> {
      const context = parseArtifactAad(aad);
      if (context.keyVersion !== input.configuration.keyVersion) {
        throw new TokenlessServiceError("Artifact key version is invalid.", 500, "invalid_artifact_key_metadata");
      }
      const alias = resolveKeyResource(input.configuration.keyResourceTemplate, context);
      return withTimeout(async signal => {
        const exactKeyResource = await resolveExactKeyResource(alias, signal);
        const encrypted = await getClient().send(
          new EncryptCommand({
            EncryptionContext: encryptionContext(context),
            KeyId: exactKeyResource,
            Plaintext: dataKey,
          }),
          { abortSignal: signal },
        );
        if (!encrypted.CiphertextBlob || encrypted.KeyId !== exactKeyResource) {
          throw new Error("Managed KMS returned incomplete wrapping evidence.");
        }
        return {
          authTag: null,
          ciphertext: Buffer.from(encrypted.CiphertextBlob).toString("base64url"),
          keyResource: exactKeyResource,
          keyVersion: input.configuration.keyVersion,
          nonce: null,
          provider: AWS_KMS_PROVIDER,
        };
      });
    },
    async unwrap(wrapped, aad) {
      const context = parseArtifactAad(aad);
      if (
        wrapped.provider !== AWS_KMS_PROVIDER ||
        wrapped.keyVersion !== input.configuration.keyVersion ||
        wrapped.nonce !== null ||
        wrapped.authTag !== null
      ) {
        throw new TokenlessServiceError(
          "Wrapped artifact key metadata is invalid.",
          500,
          "invalid_artifact_key_metadata",
        );
      }
      const alias = resolveKeyResource(input.configuration.keyResourceTemplate, context);
      return withTimeout(async signal => {
        const exactKeyResource = await resolveExactKeyResource(alias, signal);
        if (wrapped.keyResource !== exactKeyResource) {
          throw new TokenlessServiceError(
            "Wrapped artifact key belongs to another tenant key.",
            403,
            "vault_context_mismatch",
          );
        }
        const decrypted = await getClient().send(
          new DecryptCommand({
            CiphertextBlob: Buffer.from(wrapped.ciphertext, "base64url"),
            EncryptionContext: encryptionContext(context),
            KeyId: exactKeyResource,
          }),
          { abortSignal: signal },
        );
        if (!decrypted.Plaintext || decrypted.KeyId !== exactKeyResource) {
          throw new Error("Managed KMS returned incomplete unwrapping evidence.");
        }
        return new Uint8Array(decrypted.Plaintext);
      });
    },
  };
}

export function createConfiguredAwsKmsKeyWrappingProvider(env: NodeJS.ProcessEnv = process.env) {
  return createAwsKmsKeyWrappingProvider({ configuration: loadAwsKmsProviderConfiguration(env) });
}

export const __awsKmsTestUtils = { encryptionContext, parseArtifactAad, resolveKeyResource };
