import { getStoredLocalE2ETestWalletChainId, getStoredLocalE2ETestWalletRpcUrl } from "./useLocalE2ETestWalletClient";
import assert from "node:assert/strict";
import test from "node:test";
import {
  RATELOOP_E2E_RPC_URL_STORAGE_KEY,
  RATELOOP_E2E_TEST_WALLET_CHAIN_ID_STORAGE_KEY,
} from "~~/services/thirdweb/testWalletStorage";

function createStorage(values: Record<string, string | null>) {
  return {
    getItem(key: string) {
      return values[key] ?? null;
    },
  } as Pick<Storage, "getItem">;
}

test("reads the configured local E2E RPC URL from storage", () => {
  assert.equal(
    getStoredLocalE2ETestWalletRpcUrl(createStorage({ [RATELOOP_E2E_RPC_URL_STORAGE_KEY]: "http://127.0.0.1:9545/" })),
    "http://127.0.0.1:9545",
  );
});

test("falls back to the default localhost RPC when no override is stored", () => {
  assert.equal(getStoredLocalE2ETestWalletRpcUrl(createStorage({})), "http://127.0.0.1:8545");
});

test("falls back to the Base Sepolia public RPC for Base Sepolia test wallets", () => {
  const storage = createStorage({ [RATELOOP_E2E_TEST_WALLET_CHAIN_ID_STORAGE_KEY]: "84532" });
  const rpcUrl = getStoredLocalE2ETestWalletRpcUrl(storage);

  assert.equal(getStoredLocalE2ETestWalletChainId(storage), 84532);
  assert.equal(typeof rpcUrl, "string");
  assert.match(rpcUrl ?? "", /^https:\/\//);
});

test("ignores invalid local E2E RPC URLs", () => {
  assert.equal(
    getStoredLocalE2ETestWalletRpcUrl(createStorage({ [RATELOOP_E2E_RPC_URL_STORAGE_KEY]: "not-a-url" })),
    undefined,
  );
});

test("ignores invalid local E2E wallet chain IDs", () => {
  assert.equal(
    getStoredLocalE2ETestWalletChainId(createStorage({ [RATELOOP_E2E_TEST_WALLET_CHAIN_ID_STORAGE_KEY]: "base" })),
    undefined,
  );
});
