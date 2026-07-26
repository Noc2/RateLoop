import assert from "node:assert/strict";
import test from "node:test";
import type {
  EvmSigningLedger,
  EvmSigningLedgerEvent,
} from "./evm-signing-audit";
import {
  createAuditedPlatformSecretEvmAccount,
  platformSecretKeyId,
} from "./platform-secret-evm-account";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as const;
const EXPECTED_ADDRESS = privateKeyToAccount(PRIVATE_KEY).address;

function memoryLedger() {
  const events: EvmSigningLedgerEvent[] = [];
  const ledger: EvmSigningLedger = {
    append: async event => {
      events.push(event);
    },
    readTerminal: async attemptId =>
      (events.find(
        event =>
          event.attemptId === attemptId && event.outcome !== "attempted",
      ) as Extract<EvmSigningLedgerEvent, { outcome: "succeeded" | "failed" }> | undefined) ??
      null,
  };
  return { events, ledger };
}

test("platform-secret account validates identity and durably audits signatures", async () => {
  const { events, ledger } = memoryLedger();
  const account = createAuditedPlatformSecretEvmAccount({
    configuration: {
      expectedAddress: EXPECTED_ADDRESS,
      keyVersion: "railway-v1",
      privateKey: PRIVATE_KEY,
      signerRole: "keeper",
    },
    ledger,
  });
  await account.validate();
  const signature = await account.signMessage({ message: "RateLoop" });
  assert.match(signature, /^0x[0-9a-f]{130}$/u);
  assert.deepEqual(
    events.map(event => event.outcome),
    ["attempted", "succeeded"],
  );
  assert.equal(events[0]?.provider, "platform-secret");
  assert.equal(events[0]?.keyId, "platform-secret:keeper:railway-v1");
  assert.equal(events[1]?.signatureHash?.length, 66);
});

test("platform-secret account fails closed on an address or version mismatch", () => {
  const { ledger } = memoryLedger();
  assert.throws(
    () =>
      createAuditedPlatformSecretEvmAccount({
        configuration: {
          expectedAddress: privateKeyToAccount(`0x${"22".repeat(32)}`).address,
          keyVersion: "v1",
          privateKey: PRIVATE_KEY,
          signerRole: "keeper",
        },
        ledger,
      }),
    /does not match/iu,
  );
  assert.throws(
    () =>
      createAuditedPlatformSecretEvmAccount({
        configuration: {
          expectedAddress: EXPECTED_ADDRESS,
          keyVersion: "invalid version",
          privateKey: PRIVATE_KEY,
          signerRole: "keeper",
        },
        ledger,
      }),
    /version is invalid/iu,
  );
});

test("platform-secret account never returns a signature without a durable terminal event", async () => {
  let appendCount = 0;
  const account = createAuditedPlatformSecretEvmAccount({
    configuration: {
      expectedAddress: EXPECTED_ADDRESS,
      keyVersion: "v1",
      privateKey: PRIVATE_KEY,
      signerRole: "keeper",
    },
    ledger: {
      append: async () => {
        appendCount += 1;
        if (appendCount === 2) throw new Error("write lost");
      },
      readTerminal: async () => null,
    },
  });
  await assert.rejects(
    account.signMessage({ message: "RateLoop" }),
    /ledger is unavailable/iu,
  );
});

test("platform-secret key identifiers contain role and version, never key material", () => {
  const keyId = platformSecretKeyId({
    keyVersion: "vercel-v2",
    signerRole: "credential_issuer",
  });
  assert.equal(
    keyId,
    "platform-secret:credential_issuer:vercel-v2",
  );
  assert.equal(keyId.includes(PRIVATE_KEY.slice(2)), false);
});
