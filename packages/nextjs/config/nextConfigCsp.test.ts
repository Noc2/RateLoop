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
  const headers = typeof nextConfig.headers === "function" ? await nextConfig.headers() : [];
  const globalHeaders = headers.find(header => header.source === "/(.*)")?.headers ?? [];
  const csp = globalHeaders.find(header => header.key === "Content-Security-Policy")?.value;

  assert.equal(typeof csp, "string");
  return csp as string;
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

test("permissions policy only advertises browser-recognized directives", async () => {
  const permissionsPolicy = await getGlobalHeaderValue("Permissions-Policy");

  assert.equal(permissionsPolicy, "camera=(), microphone=(), geolocation=()");
  assert.doesNotMatch(permissionsPolicy ?? "", /(?:^|,\s*)tools=/);
});
