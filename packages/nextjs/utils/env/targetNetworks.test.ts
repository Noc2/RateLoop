import { AVAILABLE_TARGET_NETWORKS, resolveTargetNetworks } from "./targetNetworks";
import assert from "node:assert/strict";
import test from "node:test";
import * as chains from "viem/chains";

test("available app targets are local Foundry and Base deployments", () => {
  assert.deepEqual(
    Object.keys(AVAILABLE_TARGET_NETWORKS)
      .map(Number)
      .sort((a, b) => a - b),
    [chains.foundry.id, chains.base.id, chains.baseSepolia.id].sort((a, b) => a - b),
  );
});

test("Base mainnet and Base Sepolia are available targets", () => {
  const networks = resolveTargetNetworks(`${chains.baseSepolia.id},${chains.base.id}`, {
    production: true,
  });

  assert.deepEqual(
    networks.map(network => network.id),
    [chains.baseSepolia.id, chains.base.id],
  );
});

test("Base targets use standard RPC metadata until preconfirmation RPC is enabled", () => {
  const networks = resolveTargetNetworks(`${chains.baseSepolia.id},${chains.base.id}`, {
    production: true,
  });

  assert.deepEqual(
    networks.map(network => network.rpcUrls.default.http[0]),
    [chains.baseSepolia.rpcUrls.default.http[0], chains.base.rpcUrls.default.http[0]],
  );
});

test("Base targets can opt into Flashblocks preconfirmation RPC metadata", () => {
  const networks = resolveTargetNetworks(`${chains.baseSepolia.id},${chains.base.id}`, {
    production: true,
    rpcOverrides: {
      [chains.baseSepolia.id]: "https://84532.rpc.thirdweb.com/client-id",
      [chains.base.id]: "https://8453.rpc.thirdweb.com/client-id",
    },
    useBasePreconfRpc: true,
  });

  assert.deepEqual(
    networks.map(network => network.rpcUrls.default.http[0]),
    ["https://84532.rpc.thirdweb.com/client-id", "https://8453.rpc.thirdweb.com/client-id"],
  );
  assert.deepEqual(
    networks.map(
      network => (network as { experimental_preconfirmationTime?: number }).experimental_preconfirmationTime,
    ),
    [200, 200],
  );
});

test("Base preconfirmation opt-in requires generic RPC overrides", () => {
  assert.throws(
    () =>
      resolveTargetNetworks(`${chains.baseSepolia.id}`, {
        production: false,
        useBasePreconfRpc: true,
      }),
    /NEXT_PUBLIC_RPC_URL_84532/,
  );
});

test("generic Base RPC overrides are reused when preconfirmation RPC is enabled", () => {
  const [network] = resolveTargetNetworks(`${chains.baseSepolia.id}`, {
    production: false,
    rpcOverrides: {
      [chains.baseSepolia.id]: "https://84532.rpc.thirdweb.com/client-id",
    },
    useBasePreconfRpc: true,
  });

  assert.deepEqual(network.rpcUrls.default.http, ["https://84532.rpc.thirdweb.com/client-id"]);
});

test("generic Base RPC overrides stay preferred when preconfirmation RPC is not enabled", () => {
  const [network] = resolveTargetNetworks(`${chains.baseSepolia.id}`, {
    production: false,
    rpcOverrides: {
      [chains.baseSepolia.id]: "https://84532.rpc.thirdweb.com/client-id",
    },
  });

  assert.deepEqual(network.rpcUrls.default.http.slice(0, 2), [
    "https://84532.rpc.thirdweb.com/client-id",
    chains.baseSepolia.rpcUrls.default.http[0],
  ]);
});

test("production builds can explicitly opt into the local Foundry chain", () => {
  const networks = resolveTargetNetworks(`${chains.foundry.id},${chains.base.id}`, {
    allowFoundryInProduction: true,
    production: true,
  });

  assert.deepEqual(
    networks.map(network => network.id),
    [chains.foundry.id, chains.base.id],
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
      resolveTargetNetworks(`${chains.base.id}abc`, {
        production: true,
      }),
    /comma-separated list of numeric chain IDs/,
  );
});

test("legacy World Chain IDs are not app targets", () => {
  for (const chainId of [chains.worldchain.id, chains.worldchainSepolia.id]) {
    assert.throws(
      () =>
        resolveTargetNetworks(`${chainId}`, {
          production: true,
        }),
      /Unsupported target network/,
    );
  }
});

test("configured RPC overrides become the preferred browser transport for target chains", () => {
  const [network] = resolveTargetNetworks(`${chains.baseSepolia.id}`, {
    production: false,
    rpcOverrides: {
      [chains.baseSepolia.id]: "https://84532.rpc.thirdweb.com/client-id",
    },
  });

  assert.equal(network.rpcUrls.default.http[0], "https://84532.rpc.thirdweb.com/client-id");
});
