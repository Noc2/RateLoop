import { GetPublicKeyCommand, KMSClient, type KMSClientConfig, SignCommand } from "@aws-sdk/client-kms";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { createHash } from "node:crypto";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const KMS_TIMEOUT_MS = 8_000;
const ALGORITHM = "ECDSA-SHA256" as const;
type KmsClient = Pick<KMSClient, "send">;

export type ManagedEvidenceSigner = Readonly<{
  kind: "aws-kms";
  metadata(): Promise<{ algorithm: typeof ALGORITHM; keyId: string; publicKey: string }>;
  sign(document: Uint8Array): Promise<string>;
}>;

export type AwsKmsEvidenceSignerConfiguration = Readonly<{
  expectedKeyId: string;
  keyResource: string;
  oidcAudience?: string;
  region: string;
  roleArn?: string;
}>;

function kmsClientConfiguration(input: AwsKmsEvidenceSignerConfiguration): KMSClientConfig {
  if (!input.roleArn) return { region: input.region };
  return {
    credentials: awsCredentialsProvider({
      roleArn: input.roleArn,
      ...(input.oidcAudience ? { audience: input.oidcAudience } : {}),
    }),
    region: input.region,
  };
}

function keyId(publicKey: Uint8Array) {
  return `p256:${createHash("sha256").update(publicKey).digest("hex").slice(0, 24)}`;
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KMS_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } catch (error) {
    const unavailable = new TokenlessServiceError(
      "Evidence packet signing is unavailable.",
      503,
      "assurance_evidence_signing_unavailable",
      true,
    );
    unavailable.cause = error;
    throw unavailable;
  } finally {
    clearTimeout(timeout);
  }
}

export function createAwsKmsEvidenceSigner(input: {
  client?: KmsClient;
  configuration: AwsKmsEvidenceSignerConfiguration;
}): ManagedEvidenceSigner {
  let client = input.client;
  let resolved: { algorithm: typeof ALGORITHM; exactKeyResource: string; keyId: string; publicKey: string } | undefined;
  const getClient = () => (client ??= new KMSClient(kmsClientConfiguration(input.configuration)));

  async function metadataWithResource(signal: AbortSignal) {
    if (resolved) return resolved;
    const response = await getClient().send(new GetPublicKeyCommand({ KeyId: input.configuration.keyResource }), {
      abortSignal: signal,
    });
    if (
      !response.KeyId ||
      !response.PublicKey ||
      response.KeyUsage !== "SIGN_VERIFY" ||
      response.KeySpec !== "ECC_NIST_P256" ||
      !response.SigningAlgorithms?.includes("ECDSA_SHA_256")
    ) {
      throw new Error("KMS evidence key is not a P-256 signing key.");
    }
    const derivedKeyId = keyId(response.PublicKey);
    if (derivedKeyId !== input.configuration.expectedKeyId) {
      throw new Error("KMS evidence key does not match its configured fingerprint.");
    }
    resolved = {
      algorithm: ALGORITHM,
      exactKeyResource: response.KeyId,
      keyId: derivedKeyId,
      publicKey: Buffer.from(response.PublicKey).toString("base64url"),
    };
    return resolved;
  }

  return {
    kind: "aws-kms",
    async metadata() {
      const value = await withTimeout(metadataWithResource);
      return { algorithm: value.algorithm, keyId: value.keyId, publicKey: value.publicKey };
    },
    async sign(document) {
      return withTimeout(async signal => {
        const metadata = await metadataWithResource(signal);
        const response = await getClient().send(
          new SignCommand({
            KeyId: metadata.exactKeyResource,
            Message: createHash("sha256").update(document).digest(),
            MessageType: "DIGEST",
            SigningAlgorithm: "ECDSA_SHA_256",
          }),
          { abortSignal: signal },
        );
        if (
          !response.Signature ||
          response.KeyId !== metadata.exactKeyResource ||
          response.SigningAlgorithm !== "ECDSA_SHA_256"
        ) {
          throw new Error("KMS returned incomplete evidence signing proof.");
        }
        return Buffer.from(response.Signature).toString("base64url");
      });
    },
  };
}

export function loadAwsKmsEvidenceSignerConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): AwsKmsEvidenceSignerConfiguration {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) {
      throw new TokenlessServiceError(
        "Evidence packet signing is unavailable.",
        503,
        "assurance_evidence_signing_unavailable",
        true,
      );
    }
    return value;
  };
  return {
    expectedKeyId: required("TOKENLESS_EVIDENCE_SIGNING_KEY_ID"),
    keyResource: required("TOKENLESS_EVIDENCE_KMS_KEY_RESOURCE"),
    ...(env.TOKENLESS_EVIDENCE_KMS_OIDC_AUDIENCE?.trim()
      ? { oidcAudience: env.TOKENLESS_EVIDENCE_KMS_OIDC_AUDIENCE.trim() }
      : {}),
    region: required("TOKENLESS_EVIDENCE_KMS_REGION"),
    ...(env.TOKENLESS_EVIDENCE_KMS_ROLE_ARN?.trim() ? { roleArn: env.TOKENLESS_EVIDENCE_KMS_ROLE_ARN.trim() } : {}),
  };
}

export function createConfiguredAwsKmsEvidenceSigner(env: NodeJS.ProcessEnv = process.env) {
  const signer = createAwsKmsEvidenceSigner({ configuration: loadAwsKmsEvidenceSignerConfiguration(env) });
  return {
    kind: "aws-kms" as const,
    async metadata() {
      const metadata = await signer.metadata();
      let anchors: unknown;
      try {
        anchors = JSON.parse(env.TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS?.trim() ?? "");
      } catch {
        throw new TokenlessServiceError(
          "Evidence packet signing trust anchors are unavailable.",
          503,
          "assurance_evidence_signing_unavailable",
          true,
        );
      }
      const trusted =
        Array.isArray(anchors) &&
        anchors.some(
          anchor =>
            anchor &&
            typeof anchor === "object" &&
            (anchor as Record<string, unknown>).algorithm === metadata.algorithm &&
            (anchor as Record<string, unknown>).keyId === metadata.keyId &&
            (anchor as Record<string, unknown>).publicKey === metadata.publicKey &&
            (anchor as Record<string, unknown>).status === "current",
        );
      if (!trusted) {
        throw new TokenlessServiceError(
          "The evidence KMS key is not present in the published trust anchors.",
          503,
          "assurance_evidence_signing_unavailable",
          true,
        );
      }
      return metadata;
    },
    async sign(document: Uint8Array) {
      await this.metadata();
      return signer.sign(document);
    },
  } satisfies ManagedEvidenceSigner;
}

export const __awsKmsEvidenceSignerTestUtils = { keyId };
