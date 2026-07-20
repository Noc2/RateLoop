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
  throw new Error("KMS signature does not recover the configured account.");
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KMS_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } catch (error) {
    throw new Error("Managed keeper signer is unavailable.", { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

export function createAwsKmsKeeperAccount(input: {
  client?: KmsClient;
  configuration: AwsKmsKeeperAccountConfiguration;
}): AwsKmsKeeperAccount {
  const expectedAddress = getAddress(input.configuration.expectedAddress);
  let client = input.client;
  let exactKeyResource: string | null = null;
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
      throw new Error("KMS key is not a secp256k1 signing key.");
    }
    if (response.KeyId !== input.configuration.keyResource) {
      throw new Error("KMS returned a different key resource.");
    }
    const address = publicKeyToAddress(
      parseAwsKmsSecp256k1PublicKey(response.PublicKey),
    );
    if (getAddress(address) !== expectedAddress) {
      throw new Error("KMS public key does not match the keeper address.");
    }
    exactKeyResource = response.KeyId;
    return exactKeyResource;
  }

  async function signHash(hash: Hash) {
    return withTimeout(async (signal) => {
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
      if (
        !response.Signature ||
        response.KeyId !== keyResource ||
        response.SigningAlgorithm !== "ECDSA_SHA_256"
      ) {
        throw new Error("KMS returned incomplete signing evidence.");
      }
      return recoverSignature({
        address: expectedAddress,
        hash,
        ...parseAwsKmsDerSignature(response.Signature),
      });
    });
  }

  const account = toAccount({
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
      return serializer(transaction, signature);
    },
    async signTypedData(typedData) {
      return serializeSignature(await signHash(hashTypedData(typedData)));
    },
  });
  return Object.assign(account, {
    async validate() {
      await withTimeout(async (signal) => {
        await verifyKey(signal);
      });
    },
  });
}

export { parseAwsKmsDerSignature, parseAwsKmsSecp256k1PublicKey };
