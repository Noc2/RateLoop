import {
  buildContentSecurityPolicy,
  createContentSecurityPolicyNonce,
  resolveAgentOAuthFormActionRedirectOrigins,
  resolveAgentOAuthFrameRedirectOrigins,
} from "../lib/security/contentSecurityPolicy";
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
  });
}

async function getGlobalHeaderValue(key: string) {
  const headers = typeof nextConfig.headers === "function" ? await nextConfig.headers() : [];
  const globalHeaders = headers.find(header => header.source === "/(.*)")?.headers ?? [];
  return globalHeaders.find(header => header.key === key)?.value;
}

test("connect-src includes only the tokenless app, Base RPC, auth, World ID bridge, and analytics", async () => {
  const csp = await getContentSecurityPolicy();
  const connectSrc = csp
    .split(";")
    .map(directive => directive.trim())
    .find(directive => directive.startsWith("connect-src "));

  assert.ok(connectSrc);
  assert.match(connectSrc, /(?:^|\s)'self'(?:\s|$)/);
  assert.match(connectSrc, /(?:^|\s)https:\/\/queue\.simpleanalyticscdn\.com(?:\s|$)/);
  assert.match(connectSrc, /(?:^|\s)https:\/\/sepolia\.base\.org(?:\s|$)/);
  assert.match(connectSrc, /(?:^|\s)https:\/\/\*\.thirdweb\.com(?:\s|$)/);
  assert.match(connectSrc, /(?:^|\s)wss:\/\/\*\.walletconnect\.com(?:\s|$)/);
  assert.match(connectSrc, /(?:^|\s)https:\/\/bridge\.worldcoin\.org(?:\s|$)/);
  assert.doesNotMatch(connectSrc, /developer\.world|drand|blob\.vercel-storage/);
});

test("thirdweb OAuth popups retain their opener", async () => {
  assert.equal(await getGlobalHeaderValue("Cross-Origin-Opener-Policy"), "same-origin-allow-popups");
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

test("OAuth consent CSP allows Chromium to follow the form redirect on the exact loopback callback port", () => {
  const formActionRedirectOrigins = resolveAgentOAuthFormActionRedirectOrigins(
    "/agent/oauth/authorize",
    "http://127.0.0.1:58520/callback/codex",
  );
  const csp = buildContentSecurityPolicy({ formActionRedirectOrigins, nonce: "testnonce" });
  const formAction = csp
    .split(";")
    .map(directive => directive.trim())
    .find(directive => directive.startsWith("form-action "));

  assert.deepEqual(formActionRedirectOrigins, [
    "http://localhost:58520",
    "http://127.0.0.1:58520",
    "http://[::1]:58520",
  ]);
  assert.equal(formAction, "form-action 'self' http://localhost:58520 http://127.0.0.1:58520 http://[::1]:58520");
});

test("OAuth consent CSP limits the hidden callback frame to the exact loopback port", () => {
  const frameRedirectOrigins = resolveAgentOAuthFrameRedirectOrigins(
    "/agent/oauth/authorize",
    "http://127.0.0.1:58520/callback/codex",
  );
  const csp = buildContentSecurityPolicy({ frameRedirectOrigins, nonce: "testnonce" });
  const frameSrc = csp
    .split(";")
    .map(directive => directive.trim())
    .find(directive => directive.startsWith("frame-src "));

  assert.deepEqual(frameRedirectOrigins, ["http://localhost:58520", "http://127.0.0.1:58520", "http://[::1]:58520"]);
  assert.match(frameSrc ?? "", /http:\/\/localhost:58520 http:\/\/127\.0\.0\.1:58520 http:\/\/\[::1\]:58520$/);
  assert.deepEqual(
    resolveAgentOAuthFrameRedirectOrigins("/agent/oauth/authorize", "https://agent.example/callback"),
    [],
  );
});

test("OAuth callback form-action source is limited to a safe redirect origin on the consent page", () => {
  assert.deepEqual(
    resolveAgentOAuthFormActionRedirectOrigins("/agent/oauth/authorize", "https://agent.example/callback?flow=1"),
    ["https://agent.example"],
  );
  assert.deepEqual(resolveAgentOAuthFormActionRedirectOrigins("/rate", "https://agent.example/callback"), []);
  assert.deepEqual(
    resolveAgentOAuthFormActionRedirectOrigins("/agent/oauth/authorize", "http://agent.example/callback"),
    [],
  );
  assert.deepEqual(
    resolveAgentOAuthFormActionRedirectOrigins("/agent/oauth/authorize", "https://user:secret@agent.example/callback"),
    [],
  );
  assert.deepEqual(
    resolveAgentOAuthFormActionRedirectOrigins("/agent/oauth/authorize", "https://agent.example/callback#fragment"),
    [],
  );
});

test("YouTube context is isolated to the privacy-enhanced frame origin", async () => {
  const csp = await getContentSecurityPolicy();
  const directives = csp.split(";").map(directive => directive.trim());
  const frameSrc = directives.find(directive => directive.startsWith("frame-src "));

  assert.match(frameSrc ?? "", /(?:^|\s)https:\/\/www\.youtube-nocookie\.com(?:\s|$)/);
  for (const directive of directives.filter(value => !value.startsWith("frame-src "))) {
    assert.doesNotMatch(directive, /youtube(?:-nocookie)?\.com/);
  }
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
