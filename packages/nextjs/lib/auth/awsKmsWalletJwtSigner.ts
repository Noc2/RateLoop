import { GetPublicKeyCommand, KMSClient, type KMSClientConfig, SignCommand } from "@aws-sdk/client-kms";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { createHash, createPublicKey } from "node:crypto";
import "server-only";
import { AuthError } from "~~/lib/auth/session";

const TIMEOUT_MS = 8_000;
type KmsClient = Pick<KMSClient, "send">;

export type ManagedWalletJwtSigner = Readonly<{
  metadata(): Promise<{ keyId: string; publicJwk: JsonWebKey }>;
  sign(payload: Uint8Array): Promise<Uint8Array>;
}>;

type Configuration = Readonly<{
  expectedKeyId: string;
  keyResource: string;
  oidcAudience?: string;
  region: string;
  roleArn?: string;
}>;

function clientConfiguration(input: Configuration): KMSClientConfig {
  return {
    region: input.region,
    ...(input.roleArn
      ? {
          credentials: awsCredentialsProvider({
            roleArn: input.roleArn,
            ...(input.oidcAudience ? { audience: input.oidcAudience } : {}),
          }),
        }
      : {}),
  };
}

function fingerprint(publicKey: Uint8Array) {
  return `ed25519:${createHash("sha256").update(publicKey).digest("hex").slice(0, 24)}`;
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } catch (error) {
    const unavailable = new AuthError("Managed wallet creation is temporarily unavailable.", 503);
    unavailable.cause = error;
    throw unavailable;
  } finally {
    clearTimeout(timeout);
  }
}

export function createAwsKmsWalletJwtSigner(input: {
  client?: KmsClient;
  configuration: Configuration;
}): ManagedWalletJwtSigner {
  let client = input.client;
  let resolved: { exactKeyResource: string; keyId: string; publicJwk: JsonWebKey } | undefined;
  const getClient = () => (client ??= new KMSClient(clientConfiguration(input.configuration)));

  async function metadataWithResource(signal: AbortSignal) {
    if (resolved) return resolved;
    const response = await getClient().send(new GetPublicKeyCommand({ KeyId: input.configuration.keyResource }), {
      abortSignal: signal,
    });
    if (
      !response.KeyId ||
      !response.PublicKey ||
      response.KeyUsage !== "SIGN_VERIFY" ||
      response.KeySpec !== "ECC_NIST_EDWARDS25519" ||
      !response.SigningAlgorithms?.includes("ED25519_SHA_512")
    ) {
      throw new Error("KMS wallet key is not an Ed25519 signing key.");
    }
    const key = createPublicKey({ key: Buffer.from(response.PublicKey), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("KMS wallet public key is invalid.");
    const keyId = fingerprint(response.PublicKey);
    if (keyId !== input.configuration.expectedKeyId) throw new Error("KMS wallet key fingerprint changed.");
    resolved = { exactKeyResource: response.KeyId, keyId, publicJwk: key.export({ format: "jwk" }) };
    return resolved;
  }

  return {
    async metadata() {
      const metadata = await withTimeout(metadataWithResource);
      return { keyId: metadata.keyId, publicJwk: metadata.publicJwk };
    },
    async sign(payload) {
      if (payload.byteLength < 1 || payload.byteLength > 4_096) {
        throw new AuthError("The wallet exchange payload is invalid.", 500);
      }
      return withTimeout(async signal => {
        const metadata = await metadataWithResource(signal);
        const response = await getClient().send(
          new SignCommand({
            KeyId: metadata.exactKeyResource,
            Message: payload,
            MessageType: "RAW",
            SigningAlgorithm: "ED25519_SHA_512",
          }),
          { abortSignal: signal },
        );
        if (
          !response.Signature ||
          response.Signature.byteLength !== 64 ||
          response.KeyId !== metadata.exactKeyResource ||
          response.SigningAlgorithm !== "ED25519_SHA_512"
        ) {
          throw new Error("KMS returned incomplete wallet signing evidence.");
        }
        return response.Signature;
      });
    },
  };
}

export function createConfiguredAwsKmsWalletJwtSigner(env: NodeJS.ProcessEnv = process.env) {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new AuthError("The managed wallet issuer is not configured.", 503);
    return value;
  };
  return createAwsKmsWalletJwtSigner({
    configuration: {
      expectedKeyId: required("TOKENLESS_THIRDWEB_WALLET_KEY_ID"),
      keyResource: required("TOKENLESS_THIRDWEB_WALLET_KMS_KEY_RESOURCE"),
      region: required("TOKENLESS_THIRDWEB_WALLET_KMS_REGION"),
      ...(env.TOKENLESS_THIRDWEB_WALLET_KMS_ROLE_ARN?.trim()
        ? { roleArn: env.TOKENLESS_THIRDWEB_WALLET_KMS_ROLE_ARN.trim() }
        : {}),
      ...(env.TOKENLESS_THIRDWEB_WALLET_KMS_OIDC_AUDIENCE?.trim()
        ? { oidcAudience: env.TOKENLESS_THIRDWEB_WALLET_KMS_OIDC_AUDIENCE.trim() }
        : {}),
    },
  });
}

export const __awsKmsWalletJwtSignerTestUtils = { fingerprint };
