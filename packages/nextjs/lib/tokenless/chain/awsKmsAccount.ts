import { evmKmsSigningLedger } from "./kmsSigningLedger";
import { GetPublicKeyCommand, KMSClient, type KMSClientConfig, SignCommand } from "@aws-sdk/client-kms";
import { parseAwsKmsDerSignature, parseAwsKmsSecp256k1PublicKey } from "@rateloop/node-utils/aws-kms-secp256k1";
import {
  type EvmKmsSignerRole,
  EvmKmsSigningError,
  type EvmKmsSigningLedger,
  type EvmKmsSigningPurpose,
  awsKmsRequestId,
  normalizeEvmKmsSigningError,
} from "@rateloop/node-utils/aws-kms-signing-audit";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { randomUUID } from "node:crypto";
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
const KMS_KEY_ARN_PATTERN = /^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[0-9a-f-]{36}$/u;

type KmsClient = Pick<KMSClient, "send">;

export type AwsKmsEthereumAccountConfiguration = Readonly<{
  expectedAddress: Address;
  keyResource: string;
  oidcAudience?: string;
  region: string;
  roleArn?: string;
  signerRole: Exclude<EvmKmsSignerRole, "keeper">;
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
  throw new EvmKmsSigningError(
    "Managed EVM signer returned a signature that cannot be recovered.",
    "malformed_response_or_recovery",
  );
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KMS_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } catch (error) {
    throw normalizeEvmKmsSigningError(error);
  } finally {
    clearTimeout(timeout);
  }
}

export function createAwsKmsEthereumAccount(input: {
  client?: KmsClient;
  configuration: AwsKmsEthereumAccountConfiguration;
  ledger?: EvmKmsSigningLedger;
}): LocalAccount {
  const expectedAddress = getAddress(input.configuration.expectedAddress);
  if (!KMS_KEY_ARN_PATTERN.test(input.configuration.keyResource)) {
    throw new Error("Managed EVM signing requires an exact AWS KMS key ARN.");
  }
  let client = input.client;
  let exactKeyResource: string | null = null;
  const ledger = input.ledger ?? evmKmsSigningLedger;
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
      throw new EvmKmsSigningError("Managed EVM signer key configuration is invalid.", "access_or_key_configuration", {
        awsRequestId: awsKmsRequestId(response),
      });
    }
    if (response.KeyId !== input.configuration.keyResource) {
      throw new EvmKmsSigningError(
        "Managed EVM signer returned a different key resource.",
        "access_or_key_configuration",
        { awsRequestId: awsKmsRequestId(response) },
      );
    }
    let address: Address;
    try {
      address = publicKeyToAddress(parseAwsKmsSecp256k1PublicKey(response.PublicKey));
    } catch (error) {
      throw new EvmKmsSigningError(
        "Managed EVM signer returned a malformed public key.",
        "malformed_response_or_recovery",
        { cause: error, awsRequestId: awsKmsRequestId(response) },
      );
    }
    if (getAddress(address) !== expectedAddress) {
      throw new EvmKmsSigningError(
        "Managed EVM signer key does not match the configured role address.",
        "access_or_key_configuration",
        { awsRequestId: awsKmsRequestId(response) },
      );
    }
    exactKeyResource = response.KeyId;
    return exactKeyResource;
  }

  async function appendLedger(event: Parameters<EvmKmsSigningLedger["append"]>[0]) {
    try {
      await ledger.append(event);
    } catch (error) {
      throw new EvmKmsSigningError("Managed EVM signing audit ledger is unavailable.", "outage", { cause: error });
    }
  }

  function serviceError(error: EvmKmsSigningError) {
    const codes = {
      timeout: "managed_signer_timeout",
      throttling: "managed_signer_throttled",
      access_or_key_configuration: "managed_signer_configuration",
      malformed_response_or_recovery: "managed_signer_response_invalid",
      outage: "managed_signer_outage",
    } as const;
    const unavailable = new TokenlessServiceError(
      "Managed signer is unavailable.",
      503,
      codes[error.errorClass],
      error.retryable,
    );
    unavailable.cause = error;
    return unavailable;
  }

  async function signDigest<T>(operation: {
    hash: Hash;
    purpose: EvmKmsSigningPurpose;
    project(signature: Signature): Promise<{
      result: T;
      signatureHash: Hash;
      transactionHash: Hash | null;
    }>;
  }): Promise<T> {
    const startedAt = new Date();
    const attemptId = `kms_att_${randomUUID().replaceAll("-", "")}`;
    const baseEvent = {
      attemptId,
      signerRole: input.configuration.signerRole,
      keyArn: input.configuration.keyResource,
      digest: operation.hash,
      purpose: operation.purpose,
      startedAt,
    } as const;
    try {
      await appendLedger({
        ...baseEvent,
        eventId: `kms_evt_${randomUUID().replaceAll("-", "")}`,
        outcome: "attempted",
        awsRequestId: null,
        errorClass: null,
        retryable: null,
        signatureHash: null,
        transactionHash: null,
        completedAt: null,
        recordedAt: new Date(),
      });

      let requestId: string | null = null;
      try {
        const signature = await withTimeout(async signal => {
          const keyResource = await verifyKey(signal);
          const response = await getClient().send(
            new SignCommand({
              KeyId: keyResource,
              Message: Buffer.from(operation.hash.slice(2), "hex"),
              MessageType: "DIGEST",
              SigningAlgorithm: "ECDSA_SHA_256",
            }),
            { abortSignal: signal },
          );
          requestId = awsKmsRequestId(response);
          if (
            !response.Signature ||
            response.KeyId !== keyResource ||
            response.SigningAlgorithm !== "ECDSA_SHA_256" ||
            !requestId
          ) {
            throw new EvmKmsSigningError(
              "Managed EVM signer returned incomplete signing evidence.",
              "malformed_response_or_recovery",
              { awsRequestId: requestId },
            );
          }
          let parsed: ReturnType<typeof parseAwsKmsDerSignature>;
          try {
            parsed = parseAwsKmsDerSignature(response.Signature);
          } catch (error) {
            throw new EvmKmsSigningError(
              "Managed EVM signer returned a malformed signature.",
              "malformed_response_or_recovery",
              { cause: error, awsRequestId: requestId },
            );
          }
          try {
            return await recoverSignature({ address: expectedAddress, hash: operation.hash, ...parsed });
          } catch (error) {
            throw normalizeEvmKmsSigningError(error, {
              errorClass: "malformed_response_or_recovery",
              awsRequestId: requestId,
            });
          }
        });
        let projected: Awaited<ReturnType<typeof operation.project>>;
        try {
          projected = await operation.project(signature);
        } catch (error) {
          throw new EvmKmsSigningError(
            "Managed EVM signer result could not be serialized.",
            "malformed_response_or_recovery",
            { cause: error, awsRequestId: requestId },
          );
        }
        const completedAt = new Date();
        await appendLedger({
          ...baseEvent,
          eventId: `kms_evt_${randomUUID().replaceAll("-", "")}`,
          outcome: "succeeded",
          awsRequestId: requestId,
          errorClass: null,
          retryable: null,
          signatureHash: projected.signatureHash,
          transactionHash: projected.transactionHash,
          completedAt,
          recordedAt: completedAt,
        });
        return projected.result;
      } catch (error) {
        const failure = normalizeEvmKmsSigningError(error, { awsRequestId: requestId });
        const completedAt = new Date();
        await appendLedger({
          ...baseEvent,
          eventId: `kms_evt_${randomUUID().replaceAll("-", "")}`,
          outcome: "failed",
          awsRequestId: failure.awsRequestId,
          errorClass: failure.errorClass,
          retryable: failure.retryable,
          signatureHash: null,
          transactionHash: null,
          completedAt,
          recordedAt: completedAt,
        });
        throw failure;
      }
    } catch (error) {
      throw serviceError(normalizeEvmKmsSigningError(error));
    }
  }

  return toAccount({
    address: expectedAddress,
    async sign({ hash }) {
      return signDigest({
        hash,
        purpose: "raw_hash",
        async project(signature) {
          const serialized = serializeSignature(signature);
          return { result: serialized, signatureHash: keccak256(serialized), transactionHash: null };
        },
      });
    },
    async signMessage({ message }) {
      return signDigest({
        hash: hashMessage(message),
        purpose: "eip191_message",
        async project(signature) {
          const serialized = serializeSignature(signature);
          return { result: serialized, signatureHash: keccak256(serialized), transactionHash: null };
        },
      });
    },
    async signTransaction(transaction, options) {
      const serializer = options?.serializer ?? serializeTransaction;
      const unsigned = await serializer(transaction);
      return signDigest({
        hash: keccak256(unsigned),
        purpose: "evm_transaction",
        async project(signature) {
          const serializedSignature = serializeSignature(signature);
          const signed = await serializer(transaction, signature);
          return {
            result: signed,
            signatureHash: keccak256(serializedSignature),
            transactionHash: keccak256(signed),
          };
        },
      });
    },
    async signTypedData(typedData) {
      return signDigest({
        hash: hashTypedData(typedData),
        purpose: "eip712_typed_data",
        async project(signature) {
          const serialized = serializeSignature(signature);
          return { result: serialized, signatureHash: keccak256(serialized), transactionHash: null };
        },
      });
    },
  });
}

export function loadAwsKmsEthereumAccountConfiguration(input: {
  env?: NodeJS.ProcessEnv;
  role: "CREDENTIAL_ISSUER" | "PREPAID_FUNDER" | "SURPRISE_BONUS_FUNDER" | "X402_RELAYER";
}) {
  const env = input.env ?? process.env;
  const prefix = `TOKENLESS_${input.role}_KMS`;
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required for managed signing.`);
    return value;
  };
  const expectedAddress = required(`${prefix}_EXPECTED_ADDRESS`);
  const keyResource = required(`${prefix}_KEY_RESOURCE`);
  if (!KMS_KEY_ARN_PATTERN.test(keyResource)) {
    throw new Error(`${prefix}_KEY_RESOURCE must be an exact AWS KMS key ARN.`);
  }
  const roles = {
    CREDENTIAL_ISSUER: "credential_issuer",
    PREPAID_FUNDER: "prepaid_funder",
    SURPRISE_BONUS_FUNDER: "surprise_bonus_funder",
    X402_RELAYER: "x402_relayer",
  } as const;
  return {
    expectedAddress: getAddress(expectedAddress),
    keyResource,
    ...(env[`${prefix}_OIDC_AUDIENCE`]?.trim() ? { oidcAudience: env[`${prefix}_OIDC_AUDIENCE`]!.trim() } : {}),
    region: required(`${prefix}_REGION`),
    ...(env[`${prefix}_ROLE_ARN`]?.trim() ? { roleArn: env[`${prefix}_ROLE_ARN`]!.trim() } : {}),
    signerRole: roles[input.role],
  } satisfies AwsKmsEthereumAccountConfiguration;
}

export { parseAwsKmsDerSignature, parseAwsKmsSecp256k1PublicKey };
