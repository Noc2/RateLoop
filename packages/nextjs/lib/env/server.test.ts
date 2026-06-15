import {
  getDatabaseConfig,
  getServerRpcOverrides,
  resolveAppUrl,
  resolveOptionalAppUrl,
  resolveServerPonderUrl,
  resolveServerTargetNetworks,
} from "./server";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalPublicRpcUrl4801 = env.NEXT_PUBLIC_RPC_URL_4801;
const originalVercelEnv = env.VERCEL_ENV;

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

  if (originalVercelEnv === undefined) {
    delete env.VERCEL_ENV;
  } else {
    env.VERCEL_ENV = originalVercelEnv;
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

test("getServerRpcOverrides includes public per-chain RPC overrides", () => {
  env.NEXT_PUBLIC_RPC_URL_4801 = "https://4801.rpc.thirdweb.com/client-id/";

  assert.deepEqual(getServerRpcOverrides(), {
    4801: "https://4801.rpc.thirdweb.com/client-id",
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
