import {
  EvmSigningError,
  type EvmSigningFailureClass,
  type EvmSigningLedger,
  type EvmSigningPurpose,
  type EvmSignerRole,
  appendOrReconcileEvmSigningTerminalEvent,
  normalizeEvmSigningError,
} from "./evm-signing-audit";
import { randomUUID } from "node:crypto";
import {
  type Address,
  type Hash,
  type Hex,
  type Signature,
  getAddress,
  hashMessage,
  hashTypedData,
  keccak256,
  parseSignature,
  serializeSignature,
  serializeTransaction,
} from "viem";
import {
  type LocalAccount,
  privateKeyToAccount,
  toAccount,
} from "viem/accounts";

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const KEY_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export type PlatformSecretEvmAccountConfiguration = Readonly<{
  expectedAddress: Address;
  keyVersion: string;
  privateKey: Hex;
  signerRole: EvmSignerRole;
}>;

export type AuditedPlatformSecretEvmAccount = LocalAccount & {
  validate: () => Promise<void>;
};

export function platformSecretKeyId(
  configuration: Pick<
    PlatformSecretEvmAccountConfiguration,
    "keyVersion" | "signerRole"
  >,
) {
  return `platform-secret:${configuration.signerRole}:${configuration.keyVersion}`;
}

export function createAuditedPlatformSecretEvmAccount(input: {
  configuration: PlatformSecretEvmAccountConfiguration;
  ledger: EvmSigningLedger;
  mapError?: (error: EvmSigningError) => Error;
  onFailure?: (errorClass: EvmSigningFailureClass) => void;
}): AuditedPlatformSecretEvmAccount {
  if (!PRIVATE_KEY_PATTERN.test(input.configuration.privateKey)) {
    throw new EvmSigningError(
      "Platform-secret EVM private key must be a 32-byte hex value.",
      "access_or_key_configuration",
    );
  }
  if (!KEY_VERSION_PATTERN.test(input.configuration.keyVersion)) {
    throw new EvmSigningError(
      "Platform-secret EVM key version is invalid.",
      "access_or_key_configuration",
    );
  }

  const expectedAddress = getAddress(input.configuration.expectedAddress);
  let sourceAccount: ReturnType<typeof privateKeyToAccount>;
  try {
    sourceAccount = privateKeyToAccount(input.configuration.privateKey);
  } catch (error) {
    throw new EvmSigningError(
      "Platform-secret EVM private key is invalid.",
      "access_or_key_configuration",
      { cause: error },
    );
  }
  if (getAddress(sourceAccount.address) !== expectedAddress) {
    throw new EvmSigningError(
      "Platform-secret EVM key does not match the configured role address.",
      "access_or_key_configuration",
    );
  }

  const keyId = platformSecretKeyId(input.configuration);
  const mapError = input.mapError ?? ((error: EvmSigningError) => error);

  async function appendLedger(
    event: Parameters<EvmSigningLedger["append"]>[0],
  ) {
    try {
      await input.ledger.append(event);
    } catch (error) {
      throw new EvmSigningError(
        "Managed EVM signing audit ledger is unavailable.",
        "outage",
        { cause: error },
      );
    }
  }

  async function signDigest<T>(operation: {
    hash: Hash;
    purpose: EvmSigningPurpose;
    project(signature: Signature): Promise<{
      result: T;
      signatureHash: Hash;
      transactionHash: Hash | null;
    }>;
  }): Promise<T> {
    const startedAt = new Date();
    const attemptId = `sig_att_${randomUUID().replaceAll("-", "")}`;
    const baseEvent = {
      attemptId,
      signerRole: input.configuration.signerRole,
      provider: "platform-secret",
      keyId,
      digest: operation.hash,
      purpose: operation.purpose,
      startedAt,
    } as const;

    try {
      await appendLedger({
        ...baseEvent,
        eventId: `sig_evt_${randomUUID().replaceAll("-", "")}`,
        outcome: "attempted",
        providerRequestId: null,
        errorClass: null,
        retryable: null,
        signatureHash: null,
        transactionHash: null,
        completedAt: null,
        recordedAt: new Date(),
      });

      let projected: Awaited<ReturnType<typeof operation.project>>;
      try {
        const serializedSignature = await sourceAccount.sign({
          hash: operation.hash,
        });
        projected = await operation.project(
          parseSignature(serializedSignature),
        );
      } catch (error) {
        const failure = normalizeEvmSigningError(error, {
          errorClass: "malformed_response_or_recovery",
          message: "Platform-secret EVM signing failed.",
        });
        const completedAt = new Date();
        await appendOrReconcileEvmSigningTerminalEvent(input.ledger, {
          ...baseEvent,
          eventId: `sig_evt_${randomUUID().replaceAll("-", "")}`,
          outcome: "failed",
          providerRequestId: null,
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
      await appendOrReconcileEvmSigningTerminalEvent(input.ledger, {
        ...baseEvent,
        eventId: `sig_evt_${randomUUID().replaceAll("-", "")}`,
        outcome: "succeeded",
        providerRequestId: null,
        errorClass: null,
        retryable: null,
        signatureHash: projected.signatureHash,
        transactionHash: projected.transactionHash,
        completedAt,
        recordedAt: completedAt,
      });
      return projected.result;
    } catch (error) {
      const failure = normalizeEvmSigningError(error);
      input.onFailure?.(failure.errorClass);
      throw mapError(failure);
    }
  }

  return Object.assign(
    toAccount({
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
    }),
    {
      async validate() {
        if (getAddress(sourceAccount.address) !== expectedAddress) {
          throw new EvmSigningError(
            "Platform-secret EVM key no longer matches the configured role address.",
            "access_or_key_configuration",
          );
        }
      },
    },
  );
}
