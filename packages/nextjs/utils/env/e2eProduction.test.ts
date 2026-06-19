import { isLocalE2EProductionBuildEnabled, isLocalE2EWalletBridgeEnabled } from "./e2eProduction";
import assert from "node:assert/strict";
import test from "node:test";

test("enables local production-style E2E from the server-only flag", () => {
  assert.equal(
    isLocalE2EProductionBuildEnabled({
      RATELOOP_E2E_PRODUCTION_BUILD: "true",
      NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD: undefined,
    }),
    true,
  );
});

test("enables local production-style E2E from the public client flag", () => {
  assert.equal(
    isLocalE2EProductionBuildEnabled({
      RATELOOP_E2E_PRODUCTION_BUILD: undefined,
      NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD: "true",
    }),
    true,
  );
});

test("reads the default local production-style E2E flag from static process env", () => {
  const previousServerFlag = process.env.RATELOOP_E2E_PRODUCTION_BUILD;
  const previousPublicFlag = process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD;

  try {
    delete process.env.RATELOOP_E2E_PRODUCTION_BUILD;
    process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD = "true";

    assert.equal(isLocalE2EProductionBuildEnabled(), true);
  } finally {
    if (previousServerFlag === undefined) {
      delete process.env.RATELOOP_E2E_PRODUCTION_BUILD;
    } else {
      process.env.RATELOOP_E2E_PRODUCTION_BUILD = previousServerFlag;
    }

    if (previousPublicFlag === undefined) {
      delete process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD;
    } else {
      process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD = previousPublicFlag;
    }
  }
});

test("stays disabled when neither E2E opt-in flag is set", () => {
  assert.equal(
    isLocalE2EProductionBuildEnabled({
      RATELOOP_E2E_PRODUCTION_BUILD: undefined,
      NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD: undefined,
    }),
    false,
  );
});

test("enables the local test wallet bridge on localhost during development", () => {
  assert.equal(
    isLocalE2EWalletBridgeEnabled({
      hostname: "127.0.0.1",
      isProduction: false,
      localE2EProductionBuild: false,
    }),
    true,
  );
});

test("enables the local test wallet bridge for local production-style E2E", () => {
  assert.equal(
    isLocalE2EWalletBridgeEnabled({
      hostname: "localhost",
      isProduction: true,
      localE2EProductionBuild: true,
    }),
    true,
  );
});

test("disables the local test wallet bridge for non-local production traffic", () => {
  assert.equal(
    isLocalE2EWalletBridgeEnabled({
      hostname: "rateloop.ai",
      isProduction: true,
      localE2EProductionBuild: true,
    }),
    false,
  );
});

test("disables the local test wallet bridge for ordinary production localhost requests", () => {
  assert.equal(
    isLocalE2EWalletBridgeEnabled({
      hostname: "localhost",
      isProduction: true,
      localE2EProductionBuild: false,
    }),
    false,
  );
});
