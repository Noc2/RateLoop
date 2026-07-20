import {
  GetPublicKeyCommand,
  KMSClient,
  SignCommand,
  type KMSClientConfig,
} from "@aws-sdk/client-kms";
import { fromTokenFile } from "@aws-sdk/credential-provider-web-identity";
import {
  parseAwsKmsDerSignature,
  parseAwsKmsSecp256k1PublicKey,
} from "@rateloop/node-utils/aws-kms-secp256k1";
import {
  EvmKmsSigningError,
  type EvmKmsSigningFailureClass,
  type EvmKmsSigningLedger,
  type EvmKmsSigningPurpose,
  appendOrReconcileEvmKmsSigningTerminalEvent,
  awsKmsRequestId,
  normalizeEvmKmsSigningError,
} from "@rateloop/node-utils/aws-kms-signing-audit";
import { randomUUID } from "node:crypto";
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
import {
  type LocalAccount,
  publicKeyToAddress,
  toAccount,
} from "viem/accounts";
import { recordKmsSigningFailure } from "./metrics.js";

const KMS_TIMEOUT_MS = 8_000;

type KmsClient = Pick<KMSClient, "send">;

export type AwsKmsKeeperAccountConfiguration = Readonly<{
  expectedAddress: Address;
  keyResource: string;
  region: string;
  roleArn: string;
  roleSessionName: string;
  webIdentityTokenFile: string;
}>;

export type AwsKmsKeeperAccount = LocalAccount & {
  validate: () => Promise<void>;
};

function kmsClientConfiguration(
  input: AwsKmsKeeperAccountConfiguration,
): KMSClientConfig {
  return {
    credentials: fromTokenFile({
      clientConfig: { region: input.region },
      roleArn: input.roleArn,
      roleSessionName: input.roleSessionName,
      webIdentityTokenFile: input.webIdentityTokenFile,
    }),
    region: input.region,
  };
}

async function recoverSignature(input: {
  address: Address;
  hash: Hash;
  r: bigint;
  s: bigint;
}): Promise<Signature> {
  const r = toHex(input.r, { size: 32 });
  const s = toHex(input.s, { size: 32 });
  for (const yParity of [0, 1] as const) {
    const recovered = await recoverAddress({
      hash: input.hash,
      signature: { r, s, yParity },
    });
    if (getAddress(recovered) === input.address) return { r, s, yParity };
  }
  throw new EvmKmsSigningError(
    "Managed keeper signer returned a signature that cannot be recovered.",
    "malformed_response_or_recovery",
  );
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KMS_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } catch (error) {
    throw normalizeEvmKmsSigningError(error, {
      message: "Managed keeper signer is unavailable.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function createAwsKmsKeeperAccount(input: {
  client?: KmsClient;
  configuration: AwsKmsKeeperAccountConfiguration;
  ledger: EvmKmsSigningLedger;
  onFailure?: (errorClass: EvmKmsSigningFailureClass) => void;
}): AwsKmsKeeperAccount {
  const expectedAddress = getAddress(input.configuration.expectedAddress);
  let client = input.client;
  let exactKeyResource: string | null = null;
  const onFailure = input.onFailure ?? recordKmsSigningFailure;
  const getClient = () =>
    (client ??= new KMSClient(kmsClientConfiguration(input.configuration)));

  async function verifyKey(signal: AbortSignal) {
    if (exactKeyResource) return exactKeyResource;
    const response = await getClient().send(
      new GetPublicKeyCommand({ KeyId: input.configuration.keyResource }),
      { abortSignal: signal },
    );
    if (
      !response.KeyId ||
      !response.PublicKey ||
      response.KeyUsage !== "SIGN_VERIFY" ||
      response.KeySpec !== "ECC_SECG_P256K1" ||
      !response.SigningAlgorithms?.includes("ECDSA_SHA_256")
    ) {
      throw new EvmKmsSigningError(
        "Managed keeper signer key configuration is invalid.",
        "access_or_key_configuration",
        { awsRequestId: awsKmsRequestId(response) },
      );
    }
    if (response.KeyId !== input.configuration.keyResource) {
      throw new EvmKmsSigningError(
        "Managed keeper signer returned a different key resource.",
        "access_or_key_configuration",
        { awsRequestId: awsKmsRequestId(response) },
      );
    }
    let address: Address;
    try {
      address = publicKeyToAddress(
        parseAwsKmsSecp256k1PublicKey(response.PublicKey),
      );
    } catch (error) {
      throw new EvmKmsSigningError(
        "Managed keeper signer returned a malformed public key.",
        "malformed_response_or_recovery",
        { cause: error, awsRequestId: awsKmsRequestId(response) },
      );
    }
    if (getAddress(address) !== expectedAddress) {
      throw new EvmKmsSigningError(
        "Managed keeper signer key does not match the keeper address.",
        "access_or_key_configuration",
        { awsRequestId: awsKmsRequestId(response) },
      );
    }
    exactKeyResource = response.KeyId;
    return exactKeyResource;
  }

  async function appendLedger(
    event: Parameters<EvmKmsSigningLedger["append"]>[0],
  ) {
    try {
      await input.ledger.append(event);
    } catch (error) {
      throw new EvmKmsSigningError(
        "Managed keeper signing audit ledger is unavailable.",
        "outage",
        { cause: error },
      );
    }
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
      signerRole: "keeper" as const,
      keyArn: input.configuration.keyResource,
      digest: operation.hash,
      purpose: operation.purpose,
      startedAt,
    };
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
      let projected: Awaited<ReturnType<typeof operation.project>>;
      try {
        const signature = await withTimeout(async (signal) => {
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
              "Managed keeper signer returned incomplete signing evidence.",
              "malformed_response_or_recovery",
              { awsRequestId: requestId },
            );
          }
          let parsed: ReturnType<typeof parseAwsKmsDerSignature>;
          try {
            parsed = parseAwsKmsDerSignature(response.Signature);
          } catch (error) {
            throw new EvmKmsSigningError(
              "Managed keeper signer returned a malformed signature.",
              "malformed_response_or_recovery",
              { cause: error, awsRequestId: requestId },
            );
          }
          try {
            return await recoverSignature({
              address: expectedAddress,
              hash: operation.hash,
              ...parsed,
            });
          } catch (error) {
            throw normalizeEvmKmsSigningError(error, {
              errorClass: "malformed_response_or_recovery",
              awsRequestId: requestId,
            });
          }
        });
        try {
          projected = await operation.project(signature);
        } catch (error) {
          throw new EvmKmsSigningError(
            "Managed keeper signer result could not be serialized.",
            "malformed_response_or_recovery",
            { cause: error, awsRequestId: requestId },
          );
        }
      } catch (error) {
        const failure = normalizeEvmKmsSigningError(error, {
          awsRequestId: requestId,
        });
        const completedAt = new Date();
        await appendOrReconcileEvmKmsSigningTerminalEvent(input.ledger, {
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
      const completedAt = new Date();
      await appendOrReconcileEvmKmsSigningTerminalEvent(input.ledger, {
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
      const failure = normalizeEvmKmsSigningError(error, {
        message: "Managed keeper signer is unavailable.",
      });
      onFailure(failure.errorClass);
      throw failure;
    }
  }

  const account = toAccount({
    address: expectedAddress,
    async sign({ hash }) {
      return signDigest({
        hash,
        purpose: "raw_hash",
        async project(signature) {
          const serialized = serializeSignature(signature);
          return {
            result: serialized,
            signatureHash: keccak256(serialized),
            transactionHash: null,
          };
        },
      });
    },
    async signMessage({ message }) {
      return signDigest({
        hash: hashMessage(message),
        purpose: "eip191_message",
        async project(signature) {
          const serialized = serializeSignature(signature);
          return {
            result: serialized,
            signatureHash: keccak256(serialized),
            transactionHash: null,
          };
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
          return {
            result: serialized,
            signatureHash: keccak256(serialized),
            transactionHash: null,
          };
        },
      });
    },
  });
  return Object.assign(account, {
    async validate() {
      try {
        await withTimeout(async (signal) => {
          await verifyKey(signal);
        });
      } catch (error) {
        const failure = normalizeEvmKmsSigningError(error, {
          message: "Managed keeper signer is unavailable.",
        });
        onFailure(failure.errorClass);
        throw failure;
      }
    },
  });
}

export { parseAwsKmsDerSignature, parseAwsKmsSecp256k1PublicKey };
