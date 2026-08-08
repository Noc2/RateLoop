import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getDatabaseConfig, isLoopbackDatabaseHost } from "~~/lib/env/server";

const ORIGINAL = process.env.DATABASE_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL;
});

function configuredUrl(databaseUrl: string) {
  process.env.DATABASE_URL = databaseUrl;
  return new URL(getDatabaseConfig().url);
}

test("a remote host with no sslmode is upgraded rather than left in plaintext", () => {
  // The previous version only rewrote prefer/require/verify-ca, so a URL with no
  // sslmode fell through and connected in plaintext across the public internet.
  const url = configuredUrl("postgresql://user:pass@db.example.test:5432/rateloop");
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
});

test("every weaker remote sslmode becomes verify-full", () => {
  for (const mode of ["prefer", "require", "verify-ca", "disable", "allow"]) {
    const url = configuredUrl(`postgresql://user:pass@db.example.test:5432/rateloop?sslmode=${mode}`);
    assert.equal(url.searchParams.get("sslmode"), "verify-full", mode);
  }
});

test("uselibpqcompat is refused for a remote host", () => {
  // In that mode pg-connection-string maps sslmode=require to
  // rejectUnauthorized:false, so the option that looks like it asks for TLS
  // actually disables verification of the certificate.
  process.env.DATABASE_URL = "postgresql://user:pass@db.example.test:5432/rateloop?sslmode=require&uselibpqcompat=true";
  assert.throws(() => getDatabaseConfig(), /uselibpqcompat=true for a remote host/u);
});

test("loopback development keeps working without TLS", () => {
  for (const host of ["localhost", "127.0.0.1"]) {
    const url = configuredUrl(`postgresql://postgres:postgres@${host}:5432/rateloop_tokenless`);
    assert.equal(url.searchParams.get("sslmode"), null);
  }
  // And the compat escape hatch stays available where it cannot cross a network.
  process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/rateloop?uselibpqcompat=true";
  assert.doesNotThrow(() => getDatabaseConfig());
});

test("loopback detection covers the forms a connection string can carry", () => {
  assert.equal(isLoopbackDatabaseHost("LOCALHOST"), true);
  assert.equal(isLoopbackDatabaseHost("127.0.0.1"), true);
  assert.equal(isLoopbackDatabaseHost("::1"), true);
  assert.equal(isLoopbackDatabaseHost("db.example.test"), false);
  // Not loopback despite the prefix: a real hostname that merely starts with it.
  assert.equal(isLoopbackDatabaseHost("localhost.example.test"), false);
});
