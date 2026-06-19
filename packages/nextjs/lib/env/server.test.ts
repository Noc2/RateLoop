import {
  getDatabaseConfig,
  getServerRpcOverrides,
  getX402UsdcAddressOverride,
  resolveAppUrl,
  resolveOptionalAppUrl,
  resolveServerPonderUrl,
  resolveServerTargetNetworks,
} from "./server";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalBasePreconfRpcUrl84532 = env.NEXT_PUBLIC_BASE_PRECONF_RPC_URL_84532;
const originalPublicRpcUrl4801 = env.NEXT_PUBLIC_RPC_URL_4801;
const originalPublicRpcUrl84532 = env.NEXT_PUBLIC_RPC_URL_84532;
const originalUseBasePreconfRpc = env.NEXT_PUBLIC_USE_BASE_PRECONF_RPC;
const originalServerBasePreconfRpcUrl84532 = env.RATELOOP_SERVER_BASE_PRECONF_RPC_URL_84532;
const originalServerBasePreconfRpcUrl8453 = env.RATELOOP_SERVER_BASE_PRECONF_RPC_URL_8453;
const originalServerUseBasePreconfRpc = env.RATELOOP_SERVER_USE_BASE_PRECONF_RPC;
const originalVercelEnv = env.VERCEL_ENV;
const originalPublicUsdc = env.NEXT_PUBLIC_USDC_ADDRESS;
const originalPublicUsdc84532 = env.NEXT_PUBLIC_USDC_ADDRESS_84532;
const originalPublicX402Usdc = env.NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS;
const originalPublicX402Usdc84532 = env.NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS_84532;
const originalServerX402Usdc = env.RATELOOP_X402_USDC_ADDRESS;
const originalServerX402Usdc84532 = env.RATELOOP_X402_USDC_ADDRESS_84532;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete env.DATABASE_URL;
  } else {
    env.DATABASE_URL = originalDatabaseUrl;
  }

  if (originalPublicRpcUrl4801 === undefined) {
    delete env.NEXT_PUBLIC_RPC_URL_4801;
  } else {
    env.NEXT_PUBLIC_RPC_URL_4801 = originalPublicRpcUrl4801;
  }

  if (originalBasePreconfRpcUrl84532 === undefined) {
    delete env.NEXT_PUBLIC_BASE_PRECONF_RPC_URL_84532;
  } else {
    env.NEXT_PUBLIC_BASE_PRECONF_RPC_URL_84532 = originalBasePreconfRpcUrl84532;
  }

  if (originalPublicRpcUrl84532 === undefined) {
    delete env.NEXT_PUBLIC_RPC_URL_84532;
  } else {
    env.NEXT_PUBLIC_RPC_URL_84532 = originalPublicRpcUrl84532;
  }

  if (originalUseBasePreconfRpc === undefined) {
    delete env.NEXT_PUBLIC_USE_BASE_PRECONF_RPC;
  } else {
    env.NEXT_PUBLIC_USE_BASE_PRECONF_RPC = originalUseBasePreconfRpc;
  }

  if (originalServerBasePreconfRpcUrl84532 === undefined) {
    delete env.RATELOOP_SERVER_BASE_PRECONF_RPC_URL_84532;
  } else {
    env.RATELOOP_SERVER_BASE_PRECONF_RPC_URL_84532 = originalServerBasePreconfRpcUrl84532;
  }

  if (originalServerBasePreconfRpcUrl8453 === undefined) {
    delete env.RATELOOP_SERVER_BASE_PRECONF_RPC_URL_8453;
  } else {
    env.RATELOOP_SERVER_BASE_PRECONF_RPC_URL_8453 = originalServerBasePreconfRpcUrl8453;
  }

  if (originalServerUseBasePreconfRpc === undefined) {
    delete env.RATELOOP_SERVER_USE_BASE_PRECONF_RPC;
  } else {
    env.RATELOOP_SERVER_USE_BASE_PRECONF_RPC = originalServerUseBasePreconfRpc;
  }

  if (originalVercelEnv === undefined) {
    delete env.VERCEL_ENV;
  } else {
    env.VERCEL_ENV = originalVercelEnv;
  }

  if (originalPublicUsdc === undefined) {
    delete env.NEXT_PUBLIC_USDC_ADDRESS;
  } else {
    env.NEXT_PUBLIC_USDC_ADDRESS = originalPublicUsdc;
  }

  if (originalPublicUsdc84532 === undefined) {
    delete env.NEXT_PUBLIC_USDC_ADDRESS_84532;
  } else {
    env.NEXT_PUBLIC_USDC_ADDRESS_84532 = originalPublicUsdc84532;
  }

  if (originalPublicX402Usdc === undefined) {
    delete env.NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS;
  } else {
    env.NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS = originalPublicX402Usdc;
  }

  if (originalPublicX402Usdc84532 === undefined) {
    delete env.NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS_84532;
  } else {
    env.NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS_84532 = originalPublicX402Usdc84532;
  }

  if (originalServerX402Usdc === undefined) {
    delete env.RATELOOP_X402_USDC_ADDRESS;
  } else {
    env.RATELOOP_X402_USDC_ADDRESS = originalServerX402Usdc;
  }

  if (originalServerX402Usdc84532 === undefined) {
    delete env.RATELOOP_X402_USDC_ADDRESS_84532;
  } else {
    env.RATELOOP_X402_USDC_ADDRESS_84532 = originalServerX402Usdc84532;
  }
});

test("resolveAppUrl keeps the local default outside production", () => {
  assert.equal(resolveAppUrl(undefined, false), "http://localhost:3000");
});

test("resolveAppUrl rejects localhost in production", () => {
  assert.equal(resolveAppUrl("http://localhost:3000", true), null);
});

test("resolveAppUrl normalizes valid public app URLs", () => {
  assert.equal(resolveAppUrl("https://rateloop.ai/", true), "https://rateloop.ai");
});

test("resolveOptionalAppUrl prefers configured app URLs over Vercel system URLs", () => {
  assert.equal(
    resolveOptionalAppUrl({
      rawAppUrl: "https://www.rateloop.ai",
      rawVercelEnv: "production",
      rawVercelProjectProductionUrl: "rate-loop-nextjs.vercel.app",
      production: true,
    }),
    "https://www.rateloop.ai",
  );
});

test("resolveOptionalAppUrl uses the Vercel production URL in production deployments", () => {
  assert.equal(
    resolveOptionalAppUrl({
      rawVercelEnv: "production",
      rawVercelProjectProductionUrl: "www.rateloop.ai",
      rawVercelUrl: "rate-loop-nextjs-abc123.vercel.app",
      production: true,
    }),
    "https://www.rateloop.ai",
  );
});

test("resolveOptionalAppUrl uses the Vercel deployment URL outside production deployments", () => {
  assert.equal(
    resolveOptionalAppUrl({
      rawVercelEnv: "preview",
      rawVercelProjectProductionUrl: "www.rateloop.ai",
      rawVercelUrl: "rate-loop-nextjs-abc123.vercel.app",
      production: true,
    }),
    "https://rate-loop-nextjs-abc123.vercel.app",
  );
});

test("resolveOptionalAppUrl rejects localhost Vercel-style hosts in production", () => {
  assert.equal(
    resolveOptionalAppUrl({
      rawVercelEnv: "production",
      rawVercelProjectProductionUrl: "localhost:3000",
      production: true,
    }),
    undefined,
  );
});

test("resolveServerPonderUrl keeps the local default outside production", () => {
  assert.equal(resolveServerPonderUrl(undefined, false), "http://localhost:42069");
});

test("resolveServerPonderUrl treats localhost production URLs as unavailable", () => {
  assert.equal(resolveServerPonderUrl("http://localhost:42069", true), null);
});

test("resolveServerPonderUrl allows localhost production URLs for explicit e2e builds", () => {
  assert.equal(resolveServerPonderUrl("http://localhost:42069", true, true), "http://localhost:42069");
});

test("resolveServerTargetNetworks rejects Foundry in production by default", () => {
  const networks = resolveServerTargetNetworks("31337,4801", true);
  assert.equal(networks, null);
});

test("resolveServerTargetNetworks tolerates local-chain builds in explicit e2e production mode", () => {
  const networks = resolveServerTargetNetworks("31337,4801", true, {
    allowFoundryInProduction: true,
  });
  assert.deepEqual(
    networks?.map(network => network.id),
    [31337, 4801],
  );
});

test("resolveServerTargetNetworks does not auto-fallback on Vercel preview production builds", () => {
  env.VERCEL_ENV = "preview";

  const networks = resolveServerTargetNetworks(undefined, true);
  assert.equal(networks, null);
});

test("resolveServerTargetNetworks returns null for invalid production values", () => {
  assert.equal(resolveServerTargetNetworks("not-a-chain", true), null);
});

test("resolveServerTargetNetworks ignores public Base preconfirmation browser opt-in", () => {
  env.NEXT_PUBLIC_USE_BASE_PRECONF_RPC = "true";
  env.NEXT_PUBLIC_BASE_PRECONF_RPC_URL_84532 = "https://base-sepolia-preconf.example.com/";
  env.NEXT_PUBLIC_RPC_URL_84532 = "https://84532.rpc.thirdweb.com/client-id/";

  const networks = resolveServerTargetNetworks("84532", true);
  const serverRpcUrls: readonly string[] = networks?.[0]?.rpcUrls.default.http ?? [];

  assert.equal(serverRpcUrls[0], "https://84532.rpc.thirdweb.com/client-id");
  assert.equal(serverRpcUrls.includes("https://base-sepolia-preconf.example.com"), false);
  assert.equal(serverRpcUrls.includes("https://sepolia-preconf.base.org"), false);
});

test("resolveServerTargetNetworks honors explicit server Base preconfirmation RPC opt-in", () => {
  env.NEXT_PUBLIC_USE_BASE_PRECONF_RPC = "true";
  env.NEXT_PUBLIC_BASE_PRECONF_RPC_URL_84532 = "https://browser-base-sepolia-preconf.example.com/";
  env.NEXT_PUBLIC_RPC_URL_84532 = "https://84532.rpc.thirdweb.com/client-id/";
  env.RATELOOP_SERVER_USE_BASE_PRECONF_RPC = "true";
  env.RATELOOP_SERVER_BASE_PRECONF_RPC_URL_84532 = "https://server-base-sepolia-preconf.example.com/";

  const networks = resolveServerTargetNetworks("84532", true);

  assert.deepEqual(networks?.[0]?.rpcUrls.default.http, [
    "https://server-base-sepolia-preconf.example.com",
    "https://sepolia-preconf.base.org",
    "https://84532.rpc.thirdweb.com/client-id",
  ]);
});

test("getServerRpcOverrides includes public per-chain RPC overrides", () => {
  env.NEXT_PUBLIC_RPC_URL_4801 = "https://4801.rpc.thirdweb.com/client-id/";
  env.NEXT_PUBLIC_RPC_URL_84532 = "https://84532.rpc.thirdweb.com/client-id/";

  assert.deepEqual(getServerRpcOverrides(), {
    4801: "https://4801.rpc.thirdweb.com/client-id",
    84532: "https://84532.rpc.thirdweb.com/client-id",
  });
});

test("getDatabaseConfig preserves explicit in-memory urls", () => {
  env.DATABASE_URL = "memory:";
  assert.deepEqual(getDatabaseConfig(), { url: "memory:" });
});

test("getDatabaseConfig preserves explicit postgres urls", () => {
  env.DATABASE_URL = "postgresql://alice:secret@127.0.0.1:5432/rateloop_app";
  assert.deepEqual(getDatabaseConfig(), {
    url: "postgresql://alice:secret@127.0.0.1:5432/rateloop_app",
  });
});

test("getDatabaseConfig upgrades legacy sslmode values to verify-full", () => {
  env.DATABASE_URL = "postgresql://alice:secret@db.example.com:5432/rateloop_app?sslmode=require&pool_max=1";
  assert.deepEqual(getDatabaseConfig(), {
    url: "postgresql://alice:secret@db.example.com:5432/rateloop_app?sslmode=verify-full&pool_max=1",
  });
});

test("getDatabaseConfig preserves libpq-compatible sslmode urls", () => {
  env.DATABASE_URL = "postgresql://alice:secret@db.example.com:5432/rateloop_app?uselibpqcompat=true&sslmode=require";
  assert.deepEqual(getDatabaseConfig(), {
    url: "postgresql://alice:secret@db.example.com:5432/rateloop_app?uselibpqcompat=true&sslmode=require",
  });
});

test("getX402UsdcAddressOverride rejects conflicting USDC env vars", () => {
  env.NEXT_PUBLIC_USDC_ADDRESS = "0x0000000000000000000000000000000000000001";
  env.NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS = "0x0000000000000000000000000000000000000002";
  assert.throws(() => getX402UsdcAddressOverride(), /must match when multiple are set/);
});

test("getX402UsdcAddressOverride requires a public USDC var when only server override is set", () => {
  delete env.NEXT_PUBLIC_USDC_ADDRESS;
  delete env.NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS;
  env.RATELOOP_X402_USDC_ADDRESS = "0x0000000000000000000000000000000000000003";
  assert.throws(
    () => getX402UsdcAddressOverride(),
    /requires NEXT_PUBLIC_USDC_ADDRESS or NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS/,
  );
});

test("getX402UsdcAddressOverride returns the shared address when all vars match", () => {
  const shared = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1";
  env.NEXT_PUBLIC_USDC_ADDRESS = shared;
  env.NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS = shared;
  env.RATELOOP_X402_USDC_ADDRESS = shared;
  assert.equal(getX402UsdcAddressOverride(), shared.toLowerCase());
});

test("getX402UsdcAddressOverride supports chain-scoped Base USDC overrides", () => {
  const shared = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  env.NEXT_PUBLIC_USDC_ADDRESS_84532 = shared;
  env.NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS_84532 = shared;
  env.RATELOOP_X402_USDC_ADDRESS_84532 = shared;
  assert.equal(getX402UsdcAddressOverride(84532), shared.toLowerCase());
  assert.equal(getX402UsdcAddressOverride(4801), undefined);
});
