import {
  HARD_TESTNET_SPEND_CAP_ATOMIC,
  HostedE2ESafetyError,
  assertFundedSpend,
  safeHostedSummary,
  validateHostedRun,
} from "./safety.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const SHA = "a".repeat(40);
const addresses = {
  E2E_TESTNET_AWARDER_ADDRESS: `0x${"3".repeat(40)}`,
  E2E_TESTNET_FUNDER_ADDRESS: `0x${"1".repeat(40)}`,
  E2E_TESTNET_KEEPER_ADDRESS: `0x${"4".repeat(40)}`,
  E2E_TESTNET_REVIEWER_PAYOUT_ADDRESS: `0x${"2".repeat(40)}`,
};

function baseEnv() {
  return {
    E2E_BASE_URL: "https://rateloop-tokenless.vercel.app",
    E2E_EXPECTED_GIT_SHA: SHA,
  };
}

function fundedEnv() {
  return {
    ...baseEnv(),
    ...addresses,
    E2E_ALLOW_HOSTED_MUTATIONS: "true",
    E2E_ALLOW_TESTNET_SPEND: "true",
    E2E_CHAIN_ID: "84532",
    E2E_TESTNET_PLANNED_SPEND_ATOMIC: "4300000",
    E2E_TESTNET_SPEND_CAP_ATOMIC: "5000000",
  };
}

function safetyMessage(action) {
  assert.throws(action, error => error instanceof HostedE2ESafetyError && Boolean(error.message));
}

test("smoke requires an exact tokenless Vercel origin and checked-out SHA", () => {
  const context = validateHostedRun({ checkoutSha: SHA, env: baseEnv(), mode: "smoke" });
  assert.equal(context.targetUrl, "https://rateloop-tokenless.vercel.app");

  for (const target of [
    "http://rateloop-tokenless.vercel.app",
    "https://rateloop-tokenless.vercel.app/rate",
    "https://rateloop-tokenless.vercel.app?branch=tokenless",
    "https://rateloop-tokenless-preview.vercel.app",
    "https://rateloop.ai",
  ]) {
    safetyMessage(() =>
      validateHostedRun({ checkoutSha: SHA, env: { ...baseEnv(), E2E_BASE_URL: target }, mode: "smoke" }),
    );
  }
  safetyMessage(() => validateHostedRun({ checkoutSha: "b".repeat(40), env: baseEnv(), mode: "smoke" }));
});

test("stateful runs require the mutation gate exactly", () => {
  safetyMessage(() => validateHostedRun({ checkoutSha: SHA, env: baseEnv(), mode: "stateful" }));
  safetyMessage(() =>
    validateHostedRun({
      checkoutSha: SHA,
      env: { ...baseEnv(), E2E_ALLOW_HOSTED_MUTATIONS: "TRUE" },
      mode: "stateful",
    }),
  );
  assert.equal(
    validateHostedRun({
      checkoutSha: SHA,
      env: { ...baseEnv(), E2E_ALLOW_HOSTED_MUTATIONS: "true" },
      mode: "stateful",
    }).mode,
    "stateful",
  );
});

test("funded runs fail closed on chain, spend, and dedicated address mistakes", () => {
  const context = validateHostedRun({ checkoutSha: SHA, env: fundedEnv(), mode: "funded" });
  assert.equal(context.spend.requestedAtomic, 4_300_000n);

  safetyMessage(() =>
    validateHostedRun({
      checkoutSha: SHA,
      env: { ...fundedEnv(), E2E_ALLOW_TESTNET_SPEND: "false" },
      mode: "funded",
    }),
  );
  safetyMessage(() =>
    validateHostedRun({ checkoutSha: SHA, env: { ...fundedEnv(), E2E_CHAIN_ID: "8453" }, mode: "funded" }),
  );
  safetyMessage(() =>
    validateHostedRun({
      checkoutSha: SHA,
      env: { ...fundedEnv(), E2E_TESTNET_PLANNED_SPEND_ATOMIC: "5000001" },
      mode: "funded",
    }),
  );
  safetyMessage(() =>
    validateHostedRun({
      checkoutSha: SHA,
      env: {
        ...fundedEnv(),
        E2E_TESTNET_SPEND_CAP_ATOMIC: (HARD_TESTNET_SPEND_CAP_ATOMIC + 1n).toString(),
      },
      mode: "funded",
    }),
  );
  safetyMessage(() =>
    validateHostedRun({
      checkoutSha: SHA,
      env: { ...fundedEnv(), E2E_TESTNET_AWARDER_ADDRESS: addresses.E2E_TESTNET_FUNDER_ADDRESS },
      mode: "funded",
    }),
  );
});

test("every funded spend is independently bounded and summaries omit secrets", () => {
  const env = {
    ...fundedEnv(),
    E2E_HOSTED_SESSION_COOKIE: "session-super-secret",
    E2E_KEEPER_AUTH_TOKEN: "keeper-super-secret",
  };
  assert.equal(assertFundedSpend("4999999", env).requestedAtomic, 4_999_999n);
  safetyMessage(() => assertFundedSpend("5000001", env));

  const serialized = JSON.stringify(safeHostedSummary(validateHostedRun({ checkoutSha: SHA, env, mode: "funded" })));
  assert.doesNotMatch(serialized, /session-super-secret|keeper-super-secret/u);
  assert.doesNotMatch(serialized, /0x[0-9a-f]{40}/u);
});
