import {
  getLocalE2ETestWalletClient,
  getStoredLocalE2ETestWalletChainId,
  getStoredLocalE2ETestWalletRpcUrl,
  isLocalE2ETestWalletClientEnabled,
} from "./useLocalE2ETestWalletClient";
import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  RATELOOP_E2E_RPC_URL_STORAGE_KEY,
  RATELOOP_E2E_TEST_WALLET_CHAIN_ID_STORAGE_KEY,
  RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY,
} from "~~/services/thirdweb/testWalletStorage";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = privateKeyToAccount(TEST_PRIVATE_KEY).address;

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

test("requires the explicit local E2E flag before enabling local test wallet clients", () => {
  assert.equal(
    isLocalE2ETestWalletClientEnabled({
      hostname: "localhost",
      localE2EProductionBuild: false,
      nodeEnv: "development",
      vercelEnv: undefined,
    }),
    false,
  );
});

test("refuses local E2E wallet clients on non-localhost origins", () => {
  const storage = createStorage({ [RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY]: TEST_PRIVATE_KEY });

  assert.equal(
    getLocalE2ETestWalletClient({
      address: TEST_ADDRESS,
      chainId: 31337,
      gate: {
        hostname: "rateloop.ai",
        localE2EProductionBuild: true,
        nodeEnv: "development",
        vercelEnv: undefined,
      },
      storage,
    }),
    undefined,
  );
});

test("refuses local E2E wallet clients on production Vercel deployments", () => {
  const storage = createStorage({ [RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY]: TEST_PRIVATE_KEY });

  assert.equal(
    getLocalE2ETestWalletClient({
      address: TEST_ADDRESS,
      chainId: 31337,
      gate: {
        hostname: "localhost",
        localE2EProductionBuild: true,
        nodeEnv: "production",
        vercelEnv: "production",
      },
      storage,
    }),
    undefined,
  );
});

test("creates local E2E wallet clients only for localhost with the explicit flag", () => {
  const storage = createStorage({ [RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY]: TEST_PRIVATE_KEY });
  const client = getLocalE2ETestWalletClient({
    address: TEST_ADDRESS,
    chainId: 31337,
    gate: {
      hostname: "127.0.0.1",
      localE2EProductionBuild: true,
      nodeEnv: "production",
      vercelEnv: "preview",
    },
    storage,
  });

  assert.equal(client?.account?.address, TEST_ADDRESS);
  assert.equal(client?.chain?.id, 31337);
});
