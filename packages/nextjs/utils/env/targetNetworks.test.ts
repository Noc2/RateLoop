import { AVAILABLE_TARGET_NETWORKS, resolveTargetNetworks } from "./targetNetworks";
import assert from "node:assert/strict";
import test from "node:test";
import * as chains from "viem/chains";

test("World Chain Sepolia uses ETH as the native token symbol", () => {
  assert.equal(AVAILABLE_TARGET_NETWORKS[chains.worldchainSepolia.id].nativeCurrency.symbol, "ETH");

  const [network] = resolveTargetNetworks(`${chains.worldchainSepolia.id}`, {
    production: false,
  });

  assert.equal(network.nativeCurrency.symbol, "ETH");
});

test("production builds can explicitly opt into the local Foundry chain", () => {
  const networks = resolveTargetNetworks(`${chains.foundry.id},${chains.worldchainSepolia.id}`, {
    allowFoundryInProduction: true,
    production: true,
  });

  assert.deepEqual(
    networks.map(network => network.id),
    [chains.foundry.id, chains.worldchainSepolia.id],
  );
});

test("production builds only use a local fallback when Foundry is explicitly allowed", () => {
  assert.throws(
    () =>
      resolveTargetNetworks(undefined, {
        fallback: `${chains.foundry.id}`,
        production: true,
      }),
    /must not include the local Foundry chain in production/,
  );

  const [network] = resolveTargetNetworks(undefined, {
    allowFoundryInProduction: true,
    fallback: `${chains.foundry.id}`,
    production: true,
  });

  assert.equal(network.id, chains.foundry.id);
});

test("target network parsing rejects chain IDs with non-numeric suffixes", () => {
  assert.throws(
    () =>
      resolveTargetNetworks(`${chains.worldchain.id}abc`, {
        production: true,
      }),
    /comma-separated list of numeric chain IDs/,
  );
});

test("configured RPC overrides become the preferred browser transport for target chains", () => {
  const [network] = resolveTargetNetworks(`${chains.worldchainSepolia.id}`, {
    production: false,
    rpcOverrides: {
      [chains.worldchainSepolia.id]: "https://4801.rpc.thirdweb.com/client-id",
    },
  });

  assert.equal(network.rpcUrls.default.http[0], "https://4801.rpc.thirdweb.com/client-id");
});
