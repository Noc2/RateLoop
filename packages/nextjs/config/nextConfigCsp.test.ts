import { buildContentSecurityPolicy, createContentSecurityPolicyNonce } from "../lib/security/contentSecurityPolicy";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

type HeaderEntry = {
  key: string;
  value: string;
};

type HeaderRoute = {
  headers: HeaderEntry[];
  source: string;
};

type TestableNextConfig = {
  headers?: () => HeaderRoute[] | Promise<HeaderRoute[]>;
};

const require = createRequire(import.meta.url);
const nextConfig = require("../next.config") as TestableNextConfig;

async function getContentSecurityPolicy() {
  return buildContentSecurityPolicy({
    nonce: "testnonce",
    ponderUrl: "https://ponder.example",
    rpcOrigins: ["https://base.example"],
  });
}

async function getGlobalHeaderValue(key: string) {
  const headers = typeof nextConfig.headers === "function" ? await nextConfig.headers() : [];
  const globalHeaders = headers.find(header => header.source === "/(.*)")?.headers ?? [];
  return globalHeaders.find(header => header.key === key)?.value;
}

test("connect-src allows Vercel Blob browser upload API requests", async () => {
  const csp = await getContentSecurityPolicy();
  const connectSrc = csp
    .split(";")
    .map(directive => directive.trim())
    .find(directive => directive.startsWith("connect-src "));

  assert.ok(connectSrc);
  assert.match(connectSrc, /(?:^|\s)https:\/\/vercel\.com(?:\s|$)/);
  assert.match(connectSrc, /(?:^|\s)https:\/\/\*\.blob\.vercel-storage\.com(?:\s|$)/);
});

test("script-src uses the middleware nonce without unsafe-inline", async () => {
  const csp = await getContentSecurityPolicy();
  const scriptSrc = csp
    .split(";")
    .map(directive => directive.trim())
    .find(directive => directive.startsWith("script-src "));

  assert.ok(scriptSrc);
  assert.match(scriptSrc, /(?:^|\s)'nonce-testnonce'(?:\s|$)/);
  assert.doesNotMatch(scriptSrc, /(?:^|\s)'unsafe-inline'(?:\s|$)/);
});

test("CSP nonce generation creates a compact random token", () => {
  const nonce = createContentSecurityPolicyNonce();

  assert.match(nonce, /^[a-f0-9]{32}$/);
});

test("next config leaves CSP to middleware", async () => {
  const csp = await getGlobalHeaderValue("Content-Security-Policy");

  assert.equal(csp, undefined);
});

test("permissions policy only advertises browser-recognized directives", async () => {
  const permissionsPolicy = await getGlobalHeaderValue("Permissions-Policy");

  assert.equal(permissionsPolicy, "camera=(), microphone=(), geolocation=()");
  assert.doesNotMatch(permissionsPolicy ?? "", /(?:^|,\s*)tools=/);
});
