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
import { base, basePreconf, baseSepolia, foundry } from "viem/chains";

test("buildAlchemyHttpUrl returns the expected Base mainnet RPC", () => {
  assert.equal(buildAlchemyHttpUrl(8453, "test-key"), "https://base-mainnet.g.alchemy.com/v2/test-key");
});

test("buildAlchemyHttpUrl returns the expected Base Sepolia RPC", () => {
  assert.equal(buildAlchemyHttpUrl(baseSepolia.id, "test-key"), "https://base-sepolia.g.alchemy.com/v2/test-key");
});

test("buildAlchemyHttpUrl ignores retired and unsupported networks", () => {
  assert.equal(buildAlchemyHttpUrl(137, "test-key"), undefined);
  assert.equal(buildAlchemyHttpUrl(999999, "test-key"), undefined);
});

test("getPreferredHttpRpcUrls prioritizes overrides before Alchemy and defaults", () => {
  assert.deepEqual(
    getPreferredHttpRpcUrls(base, {
      alchemyApiKey: "alchemy-key",
      rpcOverrides: {
        [base.id]: "https://rpc.example.com",
      },
    }),
    ["https://rpc.example.com", "https://base-mainnet.g.alchemy.com/v2/alchemy-key", ...base.rpcUrls.default.http],
  );
});

test("getPreferredHttpRpcUrls requires a configured Base RPC when preconfirmation is enabled", () => {
  assert.equal(isBasePreconfRpcChain(basePreconf), true);
  assert.equal(isBasePreconfRpcChain(base), false);

  assert.throws(
    () => getPreferredHttpRpcUrls(basePreconf, { alchemyApiKey: "alchemy-key", preferBasePreconfRpc: true }),
    /NEXT_PUBLIC_RPC_URL_8453/,
  );
});

test("getPreferredHttpRpcUrls reuses the configured Base RPC when preconfirmation is enabled", () => {
  assert.deepEqual(
    getPreferredHttpRpcUrls(basePreconf, {
      alchemyApiKey: "alchemy-key",
      preferBasePreconfRpc: true,
      rpcOverrides: {
        [basePreconf.id]: "https://8453.rpc.thirdweb.com/client-id",
      },
    }),
    ["https://8453.rpc.thirdweb.com/client-id"],
  );
});

test("withPreferredHttpRpcUrls preserves Base preconfirmation detection after RPC URL rewrites", () => {
  const preferredChain = withPreferredHttpRpcUrls(basePreconf, {
    preferBasePreconfRpc: true,
    rpcOverrides: {
      [basePreconf.id]: "https://8453.rpc.thirdweb.com/client-id",
    },
  });

  assert.deepEqual(Array.from(preferredChain.rpcUrls.default.http), ["https://8453.rpc.thirdweb.com/client-id"]);
  assert.equal(isBasePreconfRpcChain(preferredChain), true);
});

test("non-Base chain metadata does not receive Alchemy rewrites without a mapped chain name", () => {
  const preferredChain = withPreferredHttpRpcUrls(foundry, {
    alchemyApiKey: "alchemy-key",
  });

  assert.deepEqual(Array.from(preferredChain.rpcUrls.default.http), Array.from(foundry.rpcUrls.default.http));
});

test("resolveRpcOverrides normalizes configured per-chain RPC URLs", () => {
  assert.deepEqual(
    resolveRpcOverrides({
      8453: "https://8453.rpc.thirdweb.com/client-id/",
      999999: undefined,
    }),
    {
      8453: "https://8453.rpc.thirdweb.com/client-id",
    },
  );
});

test("resolveRpcOverrides rejects remote plaintext HTTP in production", () => {
  assert.throws(
    () =>
      resolveRpcOverrides(
        {
          8453: "http://rpc.example.test/",
        },
        {
          production: true,
        },
      ),
    /RPC override for chain 8453 must use HTTPS in production/,
  );
});

test("resolveRpcOverrides allows HTTPS and local production E2E HTTP exceptions", () => {
  assert.deepEqual(
    resolveRpcOverrides(
      {
        31337: "http://127.0.0.1:8545/",
        8453: "https://rpc.example.test/",
      },
      {
        allowLocalhostInProduction: true,
        production: true,
      },
    ),
    {
      31337: "http://127.0.0.1:8545",
      8453: "https://rpc.example.test",
    },
  );
});

test("mergeRpcOverrides lets env-defined RPC URLs override code defaults", () => {
  assert.deepEqual(
    mergeRpcOverrides(
      {
        [base.id]: "https://base-mainnet.g.alchemy.com/public",
      },
      {
        [base.id]: "https://8453.rpc.thirdweb.com/client-id",
      },
    ),
    {
      [base.id]: "https://8453.rpc.thirdweb.com/client-id",
    },
  );
});
