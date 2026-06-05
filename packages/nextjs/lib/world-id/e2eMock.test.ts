import { RATELOOP_E2E_WORLD_ID_MOCK_STORAGE_KEY, buildE2EWorldIdV4Result, readLocalE2EWorldIdMock } from "./e2eMock";
import { parseWorldIdV4Proof } from "./onchainProof";
import { hashSignal } from "@worldcoin/idkit/hashing";
import assert from "node:assert/strict";
import { afterEach } from "node:test";
import test from "node:test";

const TEST_SIGNAL = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const TEST_WALLET_KEY = "rateloop:e2e-test-wallet-private-key";
const originalWindow = globalThis.window;
const mutableGlobal = globalThis as unknown as { window: unknown };

function installMockWindow(params: { hostname: string; mockValue: string | null; walletKey?: string | null }) {
  mutableGlobal.window = {
    location: { hostname: params.hostname },
    localStorage: {
      getItem: (key: string) => {
        if (key === RATELOOP_E2E_WORLD_ID_MOCK_STORAGE_KEY) return params.mockValue;
        if (key === TEST_WALLET_KEY) return params.walletKey ?? "0xabc";
        return null;
      },
    },
  };
}

afterEach(() => {
  mutableGlobal.window = originalWindow;
});

test("buildE2EWorldIdV4Result produces a parser-compatible v4 proof", () => {
  const result = buildE2EWorldIdV4Result({
    action: "rateloop-test",
    signal: TEST_SIGNAL.toLowerCase(),
  });

  const parsed = parseWorldIdV4Proof(result, {
    expectedAction: "rateloop-test",
    expectedCredential: "proof_of_human",
    expectedSignal: TEST_SIGNAL.toLowerCase(),
  });

  assert.equal(result.environment, "staging");
  assert.equal(parsed.nullifierHash > 0n, true);
  assert.equal(parsed.signalHash, hashSignal(TEST_SIGNAL.toLowerCase()));
});

test("readLocalE2EWorldIdMock accepts localhost pages with the test wallet session", () => {
  const result = buildE2EWorldIdV4Result({ action: "rateloop-test", signal: TEST_SIGNAL });
  installMockWindow({
    hostname: "localhost",
    mockValue: JSON.stringify({
      action: "rateloop-test",
      appId: "app_rateloop_e2e_mock",
      connectorURI: "worldcoin://rateloop-e2e/request",
      environment: "staging",
      result,
      rpContext: { rp_id: "app_rateloop_e2e_mock" },
    }),
  });

  assert.equal(readLocalE2EWorldIdMock()?.appId, "app_rateloop_e2e_mock");
});

test("readLocalE2EWorldIdMock ignores non-local pages", () => {
  installMockWindow({
    hostname: "example.com",
    mockValue: JSON.stringify({
      action: "rateloop-test",
      appId: "app_rateloop_e2e_mock",
      connectorURI: "worldcoin://rateloop-e2e/request",
      environment: "staging",
      result: buildE2EWorldIdV4Result({ action: "rateloop-test", signal: TEST_SIGNAL }),
      rpContext: { rp_id: "app_rateloop_e2e_mock" },
    }),
  });

  assert.equal(readLocalE2EWorldIdMock(), null);
});
