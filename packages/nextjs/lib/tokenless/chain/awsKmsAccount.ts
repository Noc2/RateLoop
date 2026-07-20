import { GetPublicKeyCommand, KMSClient, type KMSClientConfig, SignCommand } from "@aws-sdk/client-kms";
import { parseAwsKmsDerSignature, parseAwsKmsSecp256k1PublicKey } from "@rateloop/node-utils/aws-kms-secp256k1";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import "server-only";
import {
  type Address,
  type Hash,
  type Signature,
  getAddress,
  hashMessage,
  hashTypedData,
  keccak256,
  recoverAddress,
  serializeSignature,
  serializeTransaction,
  toHex,
} from "viem";
import { type LocalAccount, publicKeyToAddress, toAccount } from "viem/accounts";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const KMS_TIMEOUT_MS = 8_000;

type KmsClient = Pick<KMSClient, "send">;

export type AwsKmsEthereumAccountConfiguration = Readonly<{
  expectedAddress: Address;
  keyResource: string;
  oidcAudience?: string;
  region: string;
  roleArn?: string;
}>;

function kmsClientConfiguration(input: AwsKmsEthereumAccountConfiguration): KMSClientConfig {
  if (!input.roleArn) return { region: input.region };
  return {
    credentials: awsCredentialsProvider({
      roleArn: input.roleArn,
      ...(input.oidcAudience ? { audience: input.oidcAudience } : {}),
    }),
    region: input.region,
  };
}

async function recoverSignature(input: { address: Address; hash: Hash; r: bigint; s: bigint }): Promise<Signature> {
  const r = toHex(input.r, { size: 32 });
  const s = toHex(input.s, { size: 32 });
  for (const yParity of [0, 1] as const) {
    const recovered = await recoverAddress({ hash: input.hash, signature: { r, s, yParity } });
    if (getAddress(recovered) === input.address) return { r, s, yParity };
  }
  throw new Error("KMS signature does not recover the configured account.");
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KMS_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } catch (error) {
    const unavailable = new TokenlessServiceError(
      "Managed signer is unavailable.",
      503,
      "managed_signer_unavailable",
      true,
    );
    unavailable.cause = error;
    throw unavailable;
  } finally {
    clearTimeout(timeout);
  }
}

export function createAwsKmsEthereumAccount(input: {
  client?: KmsClient;
  configuration: AwsKmsEthereumAccountConfiguration;
}): LocalAccount {
  const expectedAddress = getAddress(input.configuration.expectedAddress);
  let client = input.client;
  let exactKeyResource: string | null = null;
  const getClient = () => (client ??= new KMSClient(kmsClientConfiguration(input.configuration)));

  async function verifyKey(signal: AbortSignal) {
    if (exactKeyResource) return exactKeyResource;
    const response = await getClient().send(new GetPublicKeyCommand({ KeyId: input.configuration.keyResource }), {
      abortSignal: signal,
    });
    if (
      !response.KeyId ||
      !response.PublicKey ||
      response.KeyUsage !== "SIGN_VERIFY" ||
      response.KeySpec !== "ECC_SECG_P256K1" ||
      !response.SigningAlgorithms?.includes("ECDSA_SHA_256")
    ) {
      throw new Error("KMS key is not an enabled secp256k1 signing key.");
    }
    const address = publicKeyToAddress(parseAwsKmsSecp256k1PublicKey(response.PublicKey));
    if (getAddress(address) !== expectedAddress)
      throw new Error("KMS public key does not match the configured role address.");
    exactKeyResource = response.KeyId;
    return exactKeyResource;
  }

  async function signHash(hash: Hash) {
    return withTimeout(async signal => {
      const keyResource = await verifyKey(signal);
      const response = await getClient().send(
        new SignCommand({
          KeyId: keyResource,
          Message: Buffer.from(hash.slice(2), "hex"),
          MessageType: "DIGEST",
          SigningAlgorithm: "ECDSA_SHA_256",
        }),
        { abortSignal: signal },
      );
      if (!response.Signature || response.KeyId !== keyResource || response.SigningAlgorithm !== "ECDSA_SHA_256") {
        throw new Error("KMS returned incomplete signing evidence.");
      }
      return recoverSignature({ address: expectedAddress, hash, ...parseAwsKmsDerSignature(response.Signature) });
    });
  }

  return toAccount({
    address: expectedAddress,
    async sign({ hash }) {
      return serializeSignature(await signHash(hash));
    },
    async signMessage({ message }) {
      return serializeSignature(await signHash(hashMessage(message)));
    },
    async signTransaction(transaction, options) {
      const serializer = options?.serializer ?? serializeTransaction;
      const unsigned = await serializer(transaction);
      const signature = await signHash(keccak256(unsigned));
      return await serializer(transaction, signature);
    },
    async signTypedData(typedData) {
      return serializeSignature(await signHash(hashTypedData(typedData)));
    },
  });
}

export function loadAwsKmsEthereumAccountConfiguration(input: {
  env?: NodeJS.ProcessEnv;
  role: "CREDENTIAL_ISSUER" | "EVIDENCE" | "PREPAID_FUNDER" | "SURPRISE_BONUS_FUNDER" | "X402_RELAYER";
}) {
  const env = input.env ?? process.env;
  const prefix = `TOKENLESS_${input.role}_KMS`;
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required for managed signing.`);
    return value;
  };
  const expectedAddress = required(`${prefix}_EXPECTED_ADDRESS`);
  return {
    expectedAddress: getAddress(expectedAddress),
    keyResource: required(`${prefix}_KEY_RESOURCE`),
    ...(env[`${prefix}_OIDC_AUDIENCE`]?.trim() ? { oidcAudience: env[`${prefix}_OIDC_AUDIENCE`]!.trim() } : {}),
    region: required(`${prefix}_REGION`),
    ...(env[`${prefix}_ROLE_ARN`]?.trim() ? { roleArn: env[`${prefix}_ROLE_ARN`]!.trim() } : {}),
  } satisfies AwsKmsEthereumAccountConfiguration;
}

export { parseAwsKmsDerSignature, parseAwsKmsSecp256k1PublicKey };
