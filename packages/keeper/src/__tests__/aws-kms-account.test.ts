import { GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import {
  EvmKmsSigningError,
  type EvmKmsSigningLedgerEvent,
  type EvmKmsSigningTerminalEvent,
} from "@rateloop/node-utils/aws-kms-signing-audit";
import {
  type Hex,
  parseSignature,
  recoverMessageAddress,
  serializeTransaction,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  createAwsKmsKeeperAccount,
  parseAwsKmsDerSignature,
} from "../aws-kms-account.js";

const PRIVATE_KEY = `0x${"31".repeat(32)}` as const;
const LOCAL_ACCOUNT = privateKeyToAccount(PRIVATE_KEY);
const KEY_ARN =
  "arn:aws:kms:eu-central-1:123456789012:key/11111111-1111-1111-1111-111111111111";
const SPKI_PREFIX = Buffer.from(
  "3056301006072a8648ce3d020106052b8104000a034200",
  "hex",
);

function derInteger(hex: Hex) {
  let bytes = Buffer.from(hex.slice(2).replace(/^00+/u, ""), "hex");
  if (bytes.length === 0) bytes = Buffer.from([0]);
  if ((bytes[0]! & 0x80) !== 0) {
    bytes = Buffer.concat([Buffer.from([0]), bytes]);
  }
  return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
}

async function derSignature(hash: Hex, account = LOCAL_ACCOUNT) {
  const signature = parseSignature(await account.sign({ hash }));
  const r = derInteger(signature.r);
  const s = derInteger(signature.s);
  return Buffer.concat([Buffer.from([0x30, r.length + s.length]), r, s]);
}

function kmsClient(input?: {
  keyId?: string;
  publicKey?: Hex;
  signError?: Error;
  signingAccount?: typeof LOCAL_ACCOUNT;
}) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      async send(command: unknown) {
        calls.push(command);
        if (command instanceof GetPublicKeyCommand) {
          return {
            $metadata: { requestId: "aws-get-public-key-request" },
            KeyId: input?.keyId ?? KEY_ARN,
            KeySpec: "ECC_SECG_P256K1",
            KeyUsage: "SIGN_VERIFY",
            PublicKey: Buffer.concat([
              SPKI_PREFIX,
              Buffer.from(
                (input?.publicKey ?? LOCAL_ACCOUNT.publicKey).slice(2),
                "hex",
              ),
            ]),
            SigningAlgorithms: ["ECDSA_SHA_256"],
          };
        }
        if (command instanceof SignCommand) {
          if (input?.signError) throw input.signError;
          return {
            $metadata: { requestId: "aws-sign-request" },
            KeyId: KEY_ARN,
            Signature: await derSignature(
              toHex(command.input.Message!),
              input?.signingAccount,
            ),
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
            (event) =>
              event.attemptId === attemptId &&
              (event.outcome === "succeeded" || event.outcome === "failed"),
          ) ?? null) as EvmKmsSigningTerminalEvent | null;
      },
    },
  };
}

function configuration() {
  return {
    expectedAddress: LOCAL_ACCOUNT.address,
    keyResource: KEY_ARN,
    region: "eu-central-1",
    roleArn: "arn:aws:iam::123456789012:role/tokenless-keeper",
    roleSessionName: "rateloop-tokenless-keeper",
    webIdentityTokenFile: "/var/run/secrets/rateloop/aws-oidc-token",
  } as const;
}

describe("AWS KMS keeper account", () => {
  it("verifies the exact key and signs recoverable Ethereum messages", async () => {
    const kms = kmsClient();
    const audit = recordingLedger();
    const account = createAwsKmsKeeperAccount({
      client: kms.client as never,
      configuration: configuration(),
      ledger: audit.ledger,
    });

    const message = "RateLoop managed keeper signing";
    await account.validate();
    const signature = await account.signMessage({ message });

    await expect(recoverMessageAddress({ message, signature })).resolves.toBe(
      LOCAL_ACCOUNT.address,
    );
    expect(
      kms.calls.filter((call) => call instanceof GetPublicKeyCommand),
    ).toHaveLength(1);
    expect(
      kms.calls.filter((call) => call instanceof SignCommand),
    ).toHaveLength(1);
    expect(audit.events.map((event) => event.outcome)).toEqual([
      "attempted",
      "succeeded",
    ]);
    expect(audit.events[1]).toMatchObject({
      signerRole: "keeper",
      keyArn: KEY_ARN,
      purpose: "eip191_message",
      awsRequestId: "aws-sign-request",
      errorClass: null,
    });
  });

  it("signs serialized transactions without exporting key material", async () => {
    const kms = kmsClient();
    const audit = recordingLedger();
    const account = createAwsKmsKeeperAccount({
      client: kms.client as never,
      configuration: configuration(),
      ledger: audit.ledger,
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

    await expect(account.signTransaction(transaction)).resolves.not.toBe(
      await serializeTransaction(transaction),
    );
    expect(audit.events[1]?.transactionHash).toMatch(/^0x[0-9a-f]{64}$/u);
  });

  it("refuses a different key resource or Ethereum address", async () => {
    const wrongKey = kmsClient({
      keyId:
        "arn:aws:kms:eu-central-1:123456789012:key/22222222-2222-2222-2222-222222222222",
    });
    const wrongKeyAudit = recordingLedger();
    const wrongKeyAccount = createAwsKmsKeeperAccount({
      client: wrongKey.client as never,
      configuration: configuration(),
      ledger: wrongKeyAudit.ledger,
    });
    await expect(
      wrongKeyAccount.signMessage({ message: "must fail" }),
    ).rejects.toMatchObject({
      errorClass: "access_or_key_configuration",
      retryable: false,
    });
    expect(wrongKey.calls.some((call) => call instanceof SignCommand)).toBe(
      false,
    );

    const other = privateKeyToAccount(`0x${"32".repeat(32)}`);
    const wrongAddress = kmsClient({ publicKey: other.publicKey });
    const wrongAddressAudit = recordingLedger();
    const wrongAddressAccount = createAwsKmsKeeperAccount({
      client: wrongAddress.client as never,
      configuration: configuration(),
      ledger: wrongAddressAudit.ledger,
    });
    await expect(
      wrongAddressAccount.signMessage({ message: "must fail" }),
    ).rejects.toMatchObject({
      errorClass: "access_or_key_configuration",
      retryable: false,
    });
    expect(wrongAddress.calls.some((call) => call instanceof SignCommand)).toBe(
      false,
    );
    expect(wrongAddressAudit.events[1]).toMatchObject({
      outcome: "failed",
      errorClass: "access_or_key_configuration",
      retryable: false,
    });
  });

  it("exposes retryable throttling as a typed failure and a failed ledger event", async () => {
    const providerError = Object.assign(new Error("provider detail"), {
      name: "ThrottlingException",
      $metadata: { requestId: "aws-throttled-request" },
    });
    const kms = kmsClient({ signError: providerError });
    const audit = recordingLedger();
    const failures: string[] = [];
    const account = createAwsKmsKeeperAccount({
      client: kms.client as never,
      configuration: configuration(),
      ledger: audit.ledger,
      onFailure: (errorClass) => failures.push(errorClass),
    });

    await expect(
      account.signMessage({ message: "retry later" }),
    ).rejects.toMatchObject({
      name: "EvmKmsSigningError",
      errorClass: "throttling",
      retryable: true,
      awsRequestId: "aws-throttled-request",
    } satisfies Partial<EvmKmsSigningError>);
    expect(failures).toEqual(["throttling"]);
    expect(audit.events[1]).toMatchObject({
      outcome: "failed",
      awsRequestId: "aws-throttled-request",
      errorClass: "throttling",
      retryable: true,
    });
  });

  it("preserves the AWS request ID when signature recovery fails", async () => {
    const other = privateKeyToAccount(`0x${"32".repeat(32)}`);
    const kms = kmsClient({ signingAccount: other });
    const audit = recordingLedger();
    const account = createAwsKmsKeeperAccount({
      client: kms.client as never,
      configuration: configuration(),
      ledger: audit.ledger,
    });

    await expect(
      account.signMessage({ message: "wrong recovered signer" }),
    ).rejects.toMatchObject({
      errorClass: "malformed_response_or_recovery",
      awsRequestId: "aws-sign-request",
    });
    expect(audit.events[1]).toMatchObject({
      outcome: "failed",
      awsRequestId: "aws-sign-request",
      errorClass: "malformed_response_or_recovery",
    });
  });

  it("reconciles a committed success after its insert acknowledgement is lost", async () => {
    const kms = kmsClient();
    const events: EvmKmsSigningLedgerEvent[] = [];
    const account = createAwsKmsKeeperAccount({
      client: kms.client as never,
      configuration: configuration(),
      ledger: {
        async append(event) {
          events.push(event);
          if (event.outcome === "succeeded") {
            throw new Error("success acknowledgement lost");
          }
        },
        async readTerminal(attemptId) {
          return events.find(
            (event) =>
              event.attemptId === attemptId && event.outcome === "succeeded",
          ) as EvmKmsSigningTerminalEvent | null;
        },
      },
    });

    await expect(
      account.signMessage({ message: "durably recorded" }),
    ).resolves.toMatch(/^0x[0-9a-f]+$/u);
    expect(events.map((event) => event.outcome)).toEqual([
      "attempted",
      "succeeded",
    ]);
  });

  it("rejects malformed DER signatures", () => {
    expect(() =>
      parseAwsKmsDerSignature(Uint8Array.from([0x30, 0x00])),
    ).toThrow(/integer/iu);
    expect(() =>
      parseAwsKmsDerSignature(Uint8Array.from([0x31, 0x00])),
    ).toThrow(/sequence/iu);
  });
});
