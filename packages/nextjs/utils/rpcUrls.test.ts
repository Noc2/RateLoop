import {
  buildAlchemyHttpUrl,
  getPreferredHttpRpcUrls,
  isBasePreconfRpcChain,
  mergeRpcOverrides,
  resolveRpcOverrides,
  withPreferredHttpRpcUrls,
} from "./rpcUrls";
import assert from "node:assert/strict";
import test from "node:test";
import { baseSepolia, baseSepoliaPreconf, worldchainSepolia } from "viem/chains";

test("buildAlchemyHttpUrl returns the expected World Chain Sepolia RPC", () => {
  assert.equal(buildAlchemyHttpUrl(4801, "test-key"), "https://worldchain-sepolia.g.alchemy.com/v2/test-key");
});

test("buildAlchemyHttpUrl returns the expected Base Sepolia RPC", () => {
  assert.equal(buildAlchemyHttpUrl(84532, "test-key"), "https://base-sepolia.g.alchemy.com/v2/test-key");
});

test("buildAlchemyHttpUrl ignores unsupported scaffold-era networks", () => {
  assert.equal(buildAlchemyHttpUrl(137, "test-key"), undefined);
});

test("getPreferredHttpRpcUrls prioritizes overrides before Alchemy and defaults", () => {
  assert.deepEqual(
    getPreferredHttpRpcUrls(baseSepolia, {
      alchemyApiKey: "alchemy-key",
      rpcOverrides: {
        [baseSepolia.id]: "https://rpc.example.com",
      },
    }),
    [
      "https://rpc.example.com",
      "https://base-sepolia.g.alchemy.com/v2/alchemy-key",
      ...baseSepolia.rpcUrls.default.http,
    ],
  );
});

test("getPreferredHttpRpcUrls requires a configured Base RPC when preconfirmation is enabled", () => {
  assert.equal(isBasePreconfRpcChain(baseSepoliaPreconf), true);

  assert.throws(
    () => getPreferredHttpRpcUrls(baseSepoliaPreconf, { alchemyApiKey: "alchemy-key", preferBasePreconfRpc: true }),
    /NEXT_PUBLIC_RPC_URL_84532/,
  );
});

test("getPreferredHttpRpcUrls reuses the configured Base RPC when preconfirmation is enabled", () => {
  assert.deepEqual(
    getPreferredHttpRpcUrls(baseSepoliaPreconf, {
      alchemyApiKey: "alchemy-key",
      preferBasePreconfRpc: true,
      rpcOverrides: {
        [baseSepoliaPreconf.id]: "https://84532.rpc.thirdweb.com/client-id",
      },
    }),
    ["https://84532.rpc.thirdweb.com/client-id"],
  );
});

test("withPreferredHttpRpcUrls preserves Base preconfirmation detection after RPC URL rewrites", () => {
  const preferredChain = withPreferredHttpRpcUrls(baseSepoliaPreconf, {
    preferBasePreconfRpc: true,
    rpcOverrides: {
      [baseSepoliaPreconf.id]: "https://84532.rpc.thirdweb.com/client-id",
    },
  });

  assert.deepEqual(Array.from(preferredChain.rpcUrls.default.http), ["https://84532.rpc.thirdweb.com/client-id"]);
  assert.equal(isBasePreconfRpcChain(preferredChain), true);
});

test("withPreferredHttpRpcUrls rewrites the chain metadata used for wallet add-chain flows", () => {
  const preferredChain = withPreferredHttpRpcUrls(worldchainSepolia, {
    alchemyApiKey: "alchemy-key",
  });

  assert.deepEqual(Array.from(preferredChain.rpcUrls.default.http), [
    "https://worldchain-sepolia.g.alchemy.com/v2/alchemy-key",
    "https://worldchain-sepolia.g.alchemy.com/public",
  ]);
});

test("resolveRpcOverrides normalizes configured per-chain RPC URLs", () => {
  assert.deepEqual(
    resolveRpcOverrides({
      4801: "https://4801.rpc.thirdweb.com/client-id/",
      480: undefined,
    }),
    {
      4801: "https://4801.rpc.thirdweb.com/client-id",
    },
  );
});

test("mergeRpcOverrides lets env-defined RPC URLs override code defaults", () => {
  assert.deepEqual(
    mergeRpcOverrides(
      {
        [worldchainSepolia.id]: "https://worldchain-sepolia.g.alchemy.com/public",
      },
      {
        [worldchainSepolia.id]: "https://4801.rpc.thirdweb.com/client-id",
      },
    ),
    {
      [worldchainSepolia.id]: "https://4801.rpc.thirdweb.com/client-id",
    },
  );
});
