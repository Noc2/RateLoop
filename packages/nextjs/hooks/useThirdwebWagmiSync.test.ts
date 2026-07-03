import {
  getThirdwebWagmiSyncOptions,
  getWagmiConnectorIdForThirdwebWallet,
  shouldReplaceActiveThirdwebWagmiConnection,
  shouldSkipThirdwebWagmiSync,
} from "./useThirdwebWagmiSync";
import assert from "node:assert/strict";
import test from "node:test";

test("getWagmiConnectorIdForThirdwebWallet keeps in-app wallets on the in-app connector", () => {
  assert.equal(
    getWagmiConnectorIdForThirdwebWallet({
      id: "inApp",
    } as any),
    "in-app-wallet",
  );
  assert.equal(
    getWagmiConnectorIdForThirdwebWallet({
      id: "in-app-wallet",
    } as any),
    "in-app-wallet",
  );
});

test("getWagmiConnectorIdForThirdwebWallet keeps dedicated connector ids for matching injected wallets", () => {
  assert.equal(
    getWagmiConnectorIdForThirdwebWallet(
      {
        id: "io.metamask",
      } as any,
      {
        window: {
          ethereum: {
            providers: [{ isMetaMask: true }],
          },
        },
      },
    ),
    "io.metamask",
  );
  assert.equal(
    getWagmiConnectorIdForThirdwebWallet(
      {
        id: "com.coinbase.wallet",
      } as any,
      {
        window: {
          ethereum: {
            providers: [{ isCoinbaseWallet: true }],
          },
        },
      },
    ),
    "com.coinbase.wallet",
  );
  assert.equal(
    getWagmiConnectorIdForThirdwebWallet(
      {
        id: "me.rainbow",
      } as any,
      {
        window: {
          ethereum: {
            providers: [{ isRainbow: true }],
          },
        },
      },
    ),
    "me.rainbow",
  );
});

test("getWagmiConnectorIdForThirdwebWallet skips dedicated external connectors when the injected provider is unavailable", () => {
  assert.equal(
    getWagmiConnectorIdForThirdwebWallet(
      {
        id: "io.metamask",
      } as any,
      {
        window: {
          ethereum: {
            providers: [{ isCoinbaseWallet: true }],
          },
        },
      },
    ),
    null,
  );
});

test("getWagmiConnectorIdForThirdwebWallet falls back to the generic injected connector for unknown external wallets", () => {
  assert.equal(
    getWagmiConnectorIdForThirdwebWallet(
      {
        id: "walletConnect",
      } as any,
      {
        window: undefined,
      },
    ),
    "injected",
  );
});

test("shouldSkipThirdwebWagmiSync returns true when the requested thirdweb wallet is already connected", () => {
  assert.equal(
    shouldSkipThirdwebWagmiSync({
      connectorId: "in-app-wallet",
      currentAddress: "0xabcDEF0000000000000000000000000000000000",
      currentChainId: 8453,
      currentConnectorId: "in-app-wallet",
      requestedAddress: "0xabcdef0000000000000000000000000000000000",
      requestedChainId: 8453,
    }),
    true,
  );
});

test("shouldSkipThirdwebWagmiSync returns false for forced reconnects on the same wallet", () => {
  assert.equal(
    shouldSkipThirdwebWagmiSync({
      connectorId: "in-app-wallet",
      currentAddress: "0xabcDEF0000000000000000000000000000000000",
      currentChainId: 8453,
      currentConnectorId: "in-app-wallet",
      forceReconnect: true,
      requestedAddress: "0xabcdef0000000000000000000000000000000000",
      requestedChainId: 8453,
    }),
    false,
  );
});

test("shouldSkipThirdwebWagmiSync returns false when the requested chain differs", () => {
  assert.equal(
    shouldSkipThirdwebWagmiSync({
      connectorId: "in-app-wallet",
      currentAddress: "0xabcdef0000000000000000000000000000000000",
      currentChainId: 8453,
      currentConnectorId: "in-app-wallet",
      requestedAddress: "0xabcdef0000000000000000000000000000000000",
      requestedChainId: 999999,
    }),
    false,
  );
});

test("shouldReplaceActiveThirdwebWagmiConnection replaces active in-app connector when address changes", () => {
  assert.equal(
    shouldReplaceActiveThirdwebWagmiConnection({
      connectorId: "in-app-wallet",
      currentAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
      currentChainId: 8453,
      currentConnectorId: "in-app-wallet",
      forceReconnect: true,
      replaceActiveConnection: true,
      requestedAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      requestedChainId: 8453,
    }),
    true,
  );
});

test("shouldReplaceActiveThirdwebWagmiConnection does not replace unrelated or opt-out connections", () => {
  assert.equal(
    shouldReplaceActiveThirdwebWagmiConnection({
      connectorId: "in-app-wallet",
      currentAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
      currentChainId: 8453,
      currentConnectorId: "in-app-wallet",
      forceReconnect: true,
      replaceActiveConnection: false,
      requestedAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      requestedChainId: 8453,
    }),
    false,
  );
  assert.equal(
    shouldReplaceActiveThirdwebWagmiConnection({
      connectorId: "io.metamask",
      currentAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
      currentChainId: 8453,
      currentConnectorId: "io.metamask",
      forceReconnect: true,
      replaceActiveConnection: true,
      requestedAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      requestedChainId: 8453,
    }),
    false,
  );
});

test("getThirdwebWagmiSyncOptions treats supported auto-connect wallets as wagmi reconnects", () => {
  assert.deepEqual(
    getThirdwebWagmiSyncOptions({ id: "inApp" } as any, {
      source: "autoConnect",
    }),
    { reconnect: true },
  );
  assert.deepEqual(
    getThirdwebWagmiSyncOptions({ id: "in-app-wallet" } as any, {
      source: "autoConnect",
    }),
    { reconnect: true },
  );

  for (const walletId of ["io.metamask", "com.coinbase.wallet", "me.rainbow"]) {
    assert.deepEqual(
      getThirdwebWagmiSyncOptions({ id: walletId } as any, {
        source: "autoConnect",
      }),
      { reconnect: true },
    );
  }
});

test("getThirdwebWagmiSyncOptions keeps auto-connected unknown external wallets on the direct connect path", () => {
  assert.equal(
    getThirdwebWagmiSyncOptions({ id: "walletConnect" } as any, {
      source: "autoConnect",
    }),
    undefined,
  );
});

test("getThirdwebWagmiSyncOptions replaces stale manual in-app wallet connections", () => {
  assert.deepEqual(
    getThirdwebWagmiSyncOptions({ id: "inApp" } as any, {
      source: "manualConnect",
    }),
    { reconnect: true, replaceActiveConnection: true },
  );
  assert.deepEqual(
    getThirdwebWagmiSyncOptions({ id: "in-app-wallet" } as any, {
      source: "manualConnect",
    }),
    { reconnect: true, replaceActiveConnection: true },
  );
});

test("getThirdwebWagmiSyncOptions treats manual targeted external wallet sync as a wagmi reconnect", () => {
  for (const walletId of ["io.metamask", "com.coinbase.wallet", "me.rainbow"]) {
    assert.deepEqual(
      getThirdwebWagmiSyncOptions({ id: walletId } as any, {
        source: "manualConnect",
      }),
      { reconnect: true },
    );
  }
});

test("getThirdwebWagmiSyncOptions keeps manual unknown external wallet sync on the direct connect path", () => {
  assert.equal(
    getThirdwebWagmiSyncOptions({ id: "walletConnect" } as any, {
      source: "manualConnect",
    }),
    undefined,
  );
});
