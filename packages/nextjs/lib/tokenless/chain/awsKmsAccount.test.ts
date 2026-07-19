import { createAwsKmsEthereumAccount, parseAwsKmsDerSignature } from "./awsKmsAccount";
import { GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Hex, hashMessage, parseSignature, recoverMessageAddress, serializeTransaction, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const PRIVATE_KEY = `0x${"31".repeat(32)}` as const;
const LOCAL = privateKeyToAccount(PRIVATE_KEY);
const KEY_ARN = "arn:aws:kms:eu-central-1:123456789012:key/11111111-1111-1111-1111-111111111111";
const SPKI_PREFIX = Buffer.from("3056301006072a8648ce3d020106052b8104000a034200", "hex");

function derInteger(hex: Hex) {
  let bytes = Buffer.from(hex.slice(2).replace(/^00+/u, ""), "hex");
  if (bytes.length === 0) bytes = Buffer.from([0]);
  if ((bytes[0]! & 0x80) !== 0) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
}

async function derSignature(hash: Hex) {
  const signature = parseSignature(await LOCAL.sign({ hash }));
  const r = derInteger(signature.r);
  const s = derInteger(signature.s);
  return Buffer.concat([Buffer.from([0x30, r.length + s.length]), r, s]);
}

function kmsClient(publicKey = LOCAL.publicKey) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      async send(command: unknown) {
        calls.push(command);
        if (command instanceof GetPublicKeyCommand) {
          return {
            KeyId: KEY_ARN,
            KeySpec: "ECC_SECG_P256K1",
            KeyUsage: "SIGN_VERIFY",
            PublicKey: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey.slice(2), "hex")]),
            SigningAlgorithms: ["ECDSA_SHA_256"],
          };
        }
        if (command instanceof SignCommand) {
          return {
            KeyId: KEY_ARN,
            Signature: await derSignature(toHex(command.input.Message!)),
            SigningAlgorithm: "ECDSA_SHA_256",
          };
        }
        throw new Error("unexpected command");
      },
    },
  };
}

test("AWS KMS account verifies its public key and signs recoverable Ethereum messages", async () => {
  const kms = kmsClient();
  const account = createAwsKmsEthereumAccount({
    client: kms.client as never,
    configuration: {
      expectedAddress: LOCAL.address,
      keyResource: "alias/credential-issuer",
      region: "eu-central-1",
    },
  });
  const message = "RateLoop managed signing";
  const signature = await account.signMessage({ message });
  assert.equal(await recoverMessageAddress({ message, signature }), LOCAL.address);
  assert.equal(kms.calls.filter(call => call instanceof GetPublicKeyCommand).length, 1);
  assert.equal(kms.calls.filter(call => call instanceof SignCommand).length, 1);
});

test("AWS KMS account signs serialized transactions without exporting key material", async () => {
  const kms = kmsClient();
  const account = createAwsKmsEthereumAccount({
    client: kms.client as never,
    configuration: {
      expectedAddress: LOCAL.address,
      keyResource: "alias/relayer",
      region: "eu-central-1",
    },
  });
  const transaction = {
    chainId: 84532,
    gas: 21_000n,
    maxFeePerGas: 2n,
    maxPriorityFeePerGas: 1n,
    nonce: 7,
    to: "0x1111111111111111111111111111111111111111" as const,
    type: "eip1559" as const,
    value: 1n,
  };
  const signed = await account.signTransaction(transaction);
  assert.notEqual(signed, await serializeTransaction(transaction));
});

test("AWS KMS account refuses a key whose address differs from the configured role", async () => {
  const other = privateKeyToAccount(`0x${"32".repeat(32)}`);
  const kms = kmsClient(other.publicKey);
  const account = createAwsKmsEthereumAccount({
    client: kms.client as never,
    configuration: {
      expectedAddress: LOCAL.address,
      keyResource: "alias/wrong-key",
      region: "eu-central-1",
    },
  });
  await assert.rejects(
    () => account.signMessage({ message: "must fail" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "managed_signer_unavailable",
  );
  assert.equal(
    kms.calls.some(call => call instanceof SignCommand),
    false,
  );
});

test("AWS KMS DER parser rejects malformed and out-of-range signatures", () => {
  assert.throws(() => parseAwsKmsDerSignature(Uint8Array.from([0x30, 0x00])), /integer/iu);
  assert.throws(() => parseAwsKmsDerSignature(Uint8Array.from([0x31, 0x00])), /sequence/iu);
  assert.equal(hashMessage("stable").length, 66);
});
