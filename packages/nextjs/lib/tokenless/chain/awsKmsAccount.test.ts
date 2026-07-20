import { createAwsKmsEthereumAccount, parseAwsKmsDerSignature } from "./awsKmsAccount";
import { GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import type { EvmKmsSigningLedgerEvent, EvmKmsSigningTerminalEvent } from "@rateloop/node-utils/aws-kms-signing-audit";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { test } from "node:test";
import {
  type Hex,
  hashMessage,
  keccak256,
  parseSignature,
  recoverMessageAddress,
  serializeTransaction,
  toHex,
} from "viem";
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

async function derSignature(hash: Hex, account = LOCAL) {
  const signature = parseSignature(await account.sign({ hash }));
  const r = derInteger(signature.r);
  const s = derInteger(signature.s);
  return Buffer.concat([Buffer.from([0x30, r.length + s.length]), r, s]);
}

function kmsClient(publicKey = LOCAL.publicKey, signError?: Error, signingAccount = LOCAL) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      async send(command: unknown) {
        calls.push(command);
        if (command instanceof GetPublicKeyCommand) {
          return {
            $metadata: { requestId: "aws-get-public-key-request" },
            KeyId: KEY_ARN,
            KeySpec: "ECC_SECG_P256K1",
            KeyUsage: "SIGN_VERIFY",
            PublicKey: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey.slice(2), "hex")]),
            SigningAlgorithms: ["ECDSA_SHA_256"],
          };
        }
        if (command instanceof SignCommand) {
          if (signError) throw signError;
          return {
            $metadata: { requestId: "aws-sign-request" },
            KeyId: KEY_ARN,
            Signature: await derSignature(toHex(command.input.Message!), signingAccount),
            SigningAlgorithm: "ECDSA_SHA_256",
          };
        }
        throw new Error("unexpected command");
      },
    },
  };
}

function recordingLedger() {
  const events: EvmKmsSigningLedgerEvent[] = [];
  return {
    events,
    ledger: {
      async append(event: EvmKmsSigningLedgerEvent) {
        events.push(event);
      },
      async readTerminal(attemptId: string) {
        return ([...events]
          .reverse()
          .find(
            event => event.attemptId === attemptId && (event.outcome === "succeeded" || event.outcome === "failed"),
          ) ?? null) as EvmKmsSigningTerminalEvent | null;
      },
    },
  };
}

test("AWS KMS account verifies its public key and signs recoverable Ethereum messages", async () => {
  const kms = kmsClient();
  const audit = recordingLedger();
  const account = createAwsKmsEthereumAccount({
    client: kms.client as never,
    ledger: audit.ledger,
    configuration: {
      expectedAddress: LOCAL.address,
      keyResource: KEY_ARN,
      region: "eu-central-1",
      signerRole: "credential_issuer",
    },
  });
  const message = "RateLoop managed signing";
  const signature = await account.signMessage({ message });
  assert.equal(await recoverMessageAddress({ message, signature }), LOCAL.address);
  assert.equal(kms.calls.filter(call => call instanceof GetPublicKeyCommand).length, 1);
  assert.equal(kms.calls.filter(call => call instanceof SignCommand).length, 1);
  assert.deepEqual(
    audit.events.map(event => event.outcome),
    ["attempted", "succeeded"],
  );
  assert.equal(audit.events[1]?.signerRole, "credential_issuer");
  assert.equal(audit.events[1]?.keyArn, KEY_ARN);
  assert.equal(audit.events[1]?.digest, hashMessage(message));
  assert.equal(audit.events[1]?.purpose, "eip191_message");
  assert.equal(audit.events[1]?.awsRequestId, "aws-sign-request");
  assert.match(audit.events[1]?.signatureHash ?? "", /^0x[0-9a-f]{64}$/u);
  assert.equal(audit.events[1]?.transactionHash, null);
});

test("AWS KMS account signs serialized transactions without exporting key material", async () => {
  const kms = kmsClient();
  const audit = recordingLedger();
  const account = createAwsKmsEthereumAccount({
    client: kms.client as never,
    ledger: audit.ledger,
    configuration: {
      expectedAddress: LOCAL.address,
      keyResource: KEY_ARN,
      region: "eu-central-1",
      signerRole: "x402_relayer",
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
  assert.equal(audit.events[1]?.purpose, "evm_transaction");
  assert.equal(audit.events[1]?.transactionHash, keccak256(signed));
});

test("AWS KMS account refuses a key whose address differs from the configured role", async () => {
  const other = privateKeyToAccount(`0x${"32".repeat(32)}`);
  const kms = kmsClient(other.publicKey);
  const audit = recordingLedger();
  const account = createAwsKmsEthereumAccount({
    client: kms.client as never,
    ledger: audit.ledger,
    configuration: {
      expectedAddress: LOCAL.address,
      keyResource: KEY_ARN,
      region: "eu-central-1",
      signerRole: "credential_issuer",
    },
  });
  await assert.rejects(
    () => account.signMessage({ message: "must fail" }),
    (error: unknown) =>
      error instanceof TokenlessServiceError &&
      error.code === "managed_signer_configuration" &&
      error.retryable === false,
  );
  assert.equal(
    kms.calls.some(call => call instanceof SignCommand),
    false,
  );
  assert.deepEqual(
    audit.events.map(event => [event.outcome, event.errorClass, event.retryable]),
    [
      ["attempted", null, null],
      ["failed", "access_or_key_configuration", false],
    ],
  );
});

test("AWS KMS account preserves retryable throttling class and failed request identity", async () => {
  const providerError = Object.assign(new Error("provider detail"), {
    name: "ThrottlingException",
    $metadata: { requestId: "aws-throttled-request" },
  });
  const kms = kmsClient(LOCAL.publicKey, providerError);
  const audit = recordingLedger();
  const account = createAwsKmsEthereumAccount({
    client: kms.client as never,
    ledger: audit.ledger,
    configuration: {
      expectedAddress: LOCAL.address,
      keyResource: KEY_ARN,
      region: "eu-central-1",
      signerRole: "prepaid_funder",
    },
  });

  await assert.rejects(
    () => account.signMessage({ message: "retry later" }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "managed_signer_throttled" && error.retryable === true,
  );
  assert.deepEqual(
    audit.events.map(event => [event.outcome, event.awsRequestId, event.errorClass, event.retryable]),
    [
      ["attempted", null, null, null],
      ["failed", "aws-throttled-request", "throttling", true],
    ],
  );
});

test("AWS KMS account preserves the request ID when signature recovery fails", async () => {
  const other = privateKeyToAccount(`0x${"32".repeat(32)}`);
  const kms = kmsClient(LOCAL.publicKey, undefined, other);
  const audit = recordingLedger();
  const account = createAwsKmsEthereumAccount({
    client: kms.client as never,
    ledger: audit.ledger,
    configuration: {
      expectedAddress: LOCAL.address,
      keyResource: KEY_ARN,
      region: "eu-central-1",
      signerRole: "credential_issuer",
    },
  });

  await assert.rejects(
    () => account.signMessage({ message: "wrong recovered signer" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "managed_signer_response_invalid",
  );
  assert.deepEqual(
    audit.events.map(event => [event.outcome, event.awsRequestId, event.errorClass]),
    [
      ["attempted", null, null],
      ["failed", "aws-sign-request", "malformed_response_or_recovery"],
    ],
  );
});

test("AWS KMS account reconciles a committed success after its insert acknowledgement is lost", async () => {
  const kms = kmsClient();
  const events: EvmKmsSigningLedgerEvent[] = [];
  const account = createAwsKmsEthereumAccount({
    client: kms.client as never,
    ledger: {
      async append(event) {
        events.push(event);
        if (event.outcome === "succeeded") throw new Error("success acknowledgement lost");
      },
      async readTerminal(attemptId) {
        return events.find(
          event => event.attemptId === attemptId && event.outcome === "succeeded",
        ) as EvmKmsSigningTerminalEvent | null;
      },
    },
    configuration: {
      expectedAddress: LOCAL.address,
      keyResource: KEY_ARN,
      region: "eu-central-1",
      signerRole: "credential_issuer",
    },
  });

  await assert.doesNotReject(() => account.signMessage({ message: "durably recorded" }));
  assert.deepEqual(
    events.map(event => event.outcome),
    ["attempted", "succeeded"],
  );
});

test("AWS KMS account never returns a signature without a durable terminal ledger event", async () => {
  const kms = kmsClient();
  let appendCount = 0;
  const account = createAwsKmsEthereumAccount({
    client: kms.client as never,
    ledger: {
      async append() {
        appendCount += 1;
        if (appendCount > 1) throw new Error("database unavailable");
      },
      async readTerminal() {
        throw new Error("database unavailable");
      },
    },
    configuration: {
      expectedAddress: LOCAL.address,
      keyResource: KEY_ARN,
      region: "eu-central-1",
      signerRole: "credential_issuer",
    },
  });

  await assert.rejects(
    () => account.signMessage({ message: "must remain withheld" }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "managed_signer_outage" && error.retryable === true,
  );
  assert.equal(kms.calls.filter(call => call instanceof SignCommand).length, 1);
  assert.equal(appendCount, 2, "a failed success write is reconciled without appending a contradictory failure");
});

test("AWS KMS DER parser rejects malformed and out-of-range signatures", () => {
  assert.throws(() => parseAwsKmsDerSignature(Uint8Array.from([0x30, 0x00])), /integer/iu);
  assert.throws(() => parseAwsKmsDerSignature(Uint8Array.from([0x31, 0x00])), /sequence/iu);
  assert.throws(
    () => parseAwsKmsDerSignature(Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x80, 0x02, 0x01, 0x01])),
    /negative/iu,
  );
  assert.throws(
    () => parseAwsKmsDerSignature(Uint8Array.from([0x30, 0x07, 0x02, 0x02, 0x00, 0x01, 0x02, 0x01, 0x01])),
    /canonical/iu,
  );
  assert.equal(hashMessage("stable").length, 66);
});

test("AWS KMS DER parser accepts randomized canonical secp256k1 signatures with sign padding", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  let paddedScalars = 0;
  for (let index = 0; index < 512; index += 1) {
    const signature = sign("sha256", randomBytes(32), { dsaEncoding: "der", key: privateKey });
    const parsed = parseAwsKmsDerSignature(signature);
    assert.ok(parsed.r > 0n);
    assert.ok(parsed.s > 0n);
    if (signature.includes(Buffer.from([0x02, 0x21, 0x00]))) paddedScalars += 1;
  }
  assert.ok(paddedScalars > 0, "randomized corpus must exercise DER sign padding");
});
