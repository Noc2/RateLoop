import { GetPublicKeyCommand, KMSClient, type KMSClientConfig, SignCommand } from "@aws-sdk/client-kms";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import "server-only";
import {
  type Address,
  type Hash,
  type Hex,
  type Signature,
  getAddress,
  hashMessage,
  hashTypedData,
  hexToBigInt,
  keccak256,
  recoverAddress,
  serializeSignature,
  serializeTransaction,
  toHex,
} from "viem";
import { type LocalAccount, publicKeyToAddress, toAccount } from "viem/accounts";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const CURVE_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const HALF_CURVE_ORDER = CURVE_ORDER / 2n;
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

function readDerLength(bytes: Uint8Array, cursor: number) {
  const first = bytes[cursor];
  if (first === undefined) throw new Error("DER length is truncated.");
  if ((first & 0x80) === 0) return { cursor: cursor + 1, length: first };
  const octets = first & 0x7f;
  if (octets === 0 || octets > 2 || cursor + octets >= bytes.length) throw new Error("DER length is invalid.");
  let length = 0;
  for (let index = 0; index < octets; index += 1) length = length * 256 + bytes[cursor + 1 + index]!;
  return { cursor: cursor + 1 + octets, length };
}

function readDerInteger(bytes: Uint8Array, cursor: number) {
  if (bytes[cursor] !== 0x02) throw new Error("DER signature integer is missing.");
  const encodedLength = readDerLength(bytes, cursor + 1);
  const end = encodedLength.cursor + encodedLength.length;
  if (encodedLength.length === 0 || end > bytes.length) throw new Error("DER signature integer is invalid.");
  let start = encodedLength.cursor;
  if (bytes[start] === 0) start += 1;
  if (end - start > 32 || (bytes[start]! & 0x80) !== 0) throw new Error("DER signature integer is out of range.");
  const hex = Buffer.from(bytes.slice(start, end)).toString("hex").padStart(64, "0");
  return { cursor: end, value: BigInt(`0x${hex}`) };
}

export function parseAwsKmsDerSignature(bytes: Uint8Array) {
  if (bytes[0] !== 0x30) throw new Error("KMS signature is not a DER sequence.");
  const sequence = readDerLength(bytes, 1);
  if (sequence.cursor + sequence.length !== bytes.length) throw new Error("KMS signature sequence is invalid.");
  const r = readDerInteger(bytes, sequence.cursor);
  const s = readDerInteger(bytes, r.cursor);
  if (s.cursor !== bytes.length || r.value <= 0n || r.value >= CURVE_ORDER || s.value <= 0n || s.value >= CURVE_ORDER) {
    throw new Error("KMS signature scalar is invalid.");
  }
  return { r: r.value, s: s.value > HALF_CURVE_ORDER ? CURVE_ORDER - s.value : s.value };
}

export function parseAwsKmsSecp256k1PublicKey(spki: Uint8Array): Hex {
  if (spki.length < 65) throw new Error("KMS public key is truncated.");
  const key = spki.slice(spki.length - 65);
  if (key[0] !== 0x04) throw new Error("KMS public key is not uncompressed secp256k1.");
  return toHex(key);
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

export const __awsKmsAccountTestUtils = { HALF_CURVE_ORDER, hexToBigInt };
