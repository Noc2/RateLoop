import {
  createPlatformSecretEthereumAccount,
  loadPlatformSecretEthereumAccountConfiguration,
} from "./platformSecretAccount";
import type { EvmSigningLedgerEvent } from "@rateloop/node-utils/evm-signing-audit";
import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as const;
const EXPECTED_ADDRESS = privateKeyToAccount(PRIVATE_KEY).address;

test("web platform-secret configuration requires an address and version pin", () => {
  const complete = {
    TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY: PRIVATE_KEY,
    TOKENLESS_PREPAID_FUNDER_EXPECTED_ADDRESS: EXPECTED_ADDRESS,
    TOKENLESS_PREPAID_FUNDER_KEY_VERSION: "vercel-v1",
  } as unknown as NodeJS.ProcessEnv;
  assert.deepEqual(
    loadPlatformSecretEthereumAccountConfiguration({
      env: complete,
      role: "PREPAID_FUNDER",
    }),
    {
      expectedAddress: EXPECTED_ADDRESS,
      keyVersion: "vercel-v1",
      privateKey: PRIVATE_KEY,
      signerRole: "prepaid_funder",
    },
  );
  assert.throws(
    () =>
      loadPlatformSecretEthereumAccountConfiguration({
        env: {
          ...complete,
          TOKENLESS_PREPAID_FUNDER_EXPECTED_ADDRESS: undefined,
        },
        role: "PREPAID_FUNDER",
      }),
    /EXPECTED_ADDRESS is required/iu,
  );
});

test("web platform-secret signing maps audit failures to a service outage", async () => {
  const events: EvmSigningLedgerEvent[] = [];
  const account = createPlatformSecretEthereumAccount({
    configuration: {
      expectedAddress: EXPECTED_ADDRESS,
      keyVersion: "vercel-v1",
      privateKey: PRIVATE_KEY,
      signerRole: "prepaid_funder",
    },
    ledger: {
      append: async event => {
        events.push(event);
        if (event.outcome === "succeeded") throw new Error("write lost");
      },
      readTerminal: async () => null,
    },
  });
  await assert.rejects(
    account.signMessage({ message: "RateLoop" }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "TokenlessServiceError" &&
      /Managed signer is unavailable/iu.test(error.message),
  );
  assert.deepEqual(
    events.map(event => event.outcome),
    ["attempted", "succeeded"],
  );
});
