import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../i18n/config";
import {
  buildContentSecurityPolicy,
  contentSecurityPolicyReportingEndpoints,
  createContentSecurityPolicyNonce,
  resolveAgentOAuthFormActionRedirectOrigins,
  resolveAgentOAuthFrameRedirectOrigins,
} from "../lib/security/contentSecurityPolicy";
import { normalizeCspReports, safeReportUrl } from "../lib/security/contentSecurityPolicyReport";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

function directiveOf(csp: string, name: string) {
  return csp
    .split(";")
    .map(directive => directive.trim())
    .find(directive => directive.startsWith(`${name} `));
}

async function getGlobalHeaderValue(key: string) {
  const headers = typeof nextConfig.headers === "function" ? await nextConfig.headers() : [];
  const globalHeaders = headers.find(header => header.source === "/(.*)")?.headers ?? [];
  return globalHeaders.find(header => header.key === key)?.value;
}

test("connect-src includes only the tokenless app, Base RPC, and the wallet connector", async () => {
  const csp = await getContentSecurityPolicy();
  const connectSrc = directiveOf(csp, "connect-src");

  assert.ok(connectSrc);
  assert.match(connectSrc, /(?:^|\s)'self'(?:\s|$)/);
  assert.doesNotMatch(csp, /simpleanalyticscdn/u);
  assert.match(connectSrc, /(?:^|\s)https:\/\/sepolia\.base\.org(?:\s|$)/);
  assert.match(connectSrc, /(?:^|\s)https:\/\/\*\.thirdweb\.com(?:\s|$)/);
  assert.match(connectSrc, /(?:^|\s)wss:\/\/\*\.walletconnect\.org(?:\s|$)/);
  assert.doesNotMatch(connectSrc, /developer\.world|drand|blob\.vercel-storage/);
});

test("the World ID widget's three sources appear exactly where the widget can render", async () => {
  // Every one of these exists for @worldcoin/idkit and nothing else, and the
  // widget renders only behind TOKENLESS_NETWORK_PANELS_ENABLED. With the lane
  // off — the default — the production policy must not carry any of them.
  const off = buildContentSecurityPolicy({ nonce: "testnonce" });
  assert.doesNotMatch(directiveOf(off, "script-src") ?? "", /wasm-unsafe-eval/u);
  assert.equal(directiveOf(off, "font-src"), "font-src 'self'");
  assert.doesNotMatch(directiveOf(off, "connect-src") ?? "", /worldcoin/u);

  const on = buildContentSecurityPolicy({ isWorldIdEnabled: true, nonce: "testnonce" });
  // idkit-core compiles idkit_wasm_bg.wasm via WebAssembly.instantiateStreaming,
  // which without this token fails closed and the verification flow never starts.
  assert.match(directiveOf(on, "script-src") ?? "", /(?:^|\s)'wasm-unsafe-eval'(?:\s|$)/u);
  // The five TWK Lausanne @font-face rules the widget injects are absolute URLs
  // inside the published bundle, so they cannot be served from our own origin.
  assert.match(directiveOf(on, "font-src") ?? "", /(?:^|\s)https:\/\/world-id-assets\.com(?:\s|$)/u);
  assert.match(directiveOf(on, "connect-src") ?? "", /(?:^|\s)https:\/\/bridge\.worldcoin\.org(?:\s|$)/u);

  // Enabling the widget must not loosen script-src any further than the one token.
  assert.doesNotMatch(directiveOf(on, "script-src") ?? "", /(?:^|\s)'unsafe-eval'(?:\s|$)/u);
  assert.doesNotMatch(directiveOf(on, "script-src") ?? "", /unsafe-inline/u);
});

test("development already grants a superset, so it does not restate wasm-unsafe-eval", () => {
  // 'unsafe-eval' covers WebAssembly compilation. Emitting both would suggest
  // the two are independent, and it is precisely this masking that hid the gap
  // from every local run.
  const dev = buildContentSecurityPolicy({ isDev: true, isWorldIdEnabled: true, nonce: "testnonce" });
  const scriptSrc = directiveOf(dev, "script-src") ?? "";
  assert.match(scriptSrc, /(?:^|\s)'unsafe-eval'(?:\s|$)/u);
  assert.doesNotMatch(scriptSrc, /wasm-unsafe-eval/u);
});

test("connect-src does not advertise chains or relays no shipped code reaches", async () => {
  const csp = await getContentSecurityPolicy();

  // Base mainnet has no client anywhere in this deployment, and the shipped
  // WalletConnect relay is wss://relay.walletconnect.org, so a wss *.com source
  // widens the policy without covering anything.
  assert.doesNotMatch(csp, /mainnet\.base\.org/u);
  assert.doesNotMatch(csp, /wss:\/\/\*\.walletconnect\.com/u);
});

test("the managed in-app wallet frame is allowed only where the feature can be enabled", async () => {
  const frameSrcOf = (csp: string) =>
    csp
      .split(";")
      .map(directive => directive.trim())
      .find(directive => directive.startsWith("frame-src ")) ?? "";

  assert.doesNotMatch(frameSrcOf(await getContentSecurityPolicy()), /embedded-wallet\.thirdweb\.com/u);
  assert.match(
    frameSrcOf(buildContentSecurityPolicy({ isDev: true, nonce: "testnonce" })),
    /(?:^|\s)https:\/\/embedded-wallet\.thirdweb\.com(?:\s|$)/u,
  );
});

test("thirdweb OAuth popups retain their opener", async () => {
  assert.equal(await getGlobalHeaderValue("Cross-Origin-Opener-Policy"), "same-origin-allow-popups");
});

test("shared evidence pages are non-cacheable, non-indexable, and never send referrers", async () => {
  const headers = typeof nextConfig.headers === "function" ? await nextConfig.headers() : [];
  const expectedSources = [
    "/evidence/share/:path*",
    ...SUPPORTED_LOCALES.filter(locale => locale !== DEFAULT_LOCALE).map(locale => `/${locale}/evidence/share/:path*`),
  ];
  for (const source of expectedSources) {
    const evidenceHeaders = headers.find(header => header.source === source)?.headers ?? [];
    const value = (key: string) => evidenceHeaders.find(header => header.key === key)?.value;

    assert.equal(value("Cache-Control"), "private, no-store, max-age=0");
    assert.equal(value("Referrer-Policy"), "no-referrer");
    assert.equal(value("X-Robots-Tag"), "noindex, nofollow, noarchive");
    assert.ok(
      headers.findIndex(header => header.source === source) > headers.findIndex(header => header.source === "/(.*)"),
    );
  }
  assert.deepEqual(
    headers.filter(header => header.source.endsWith("/evidence/share/:path*")).map(header => header.source),
    expectedSources,
  );
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

test("the root layout renders dynamically so middleware nonces reach every page and error route", () => {
  const source = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(source, /export const dynamic = ["']force-dynamic["'];/u);
});

test("permissions policy only advertises browser-recognized directives", async () => {
  const permissionsPolicy = await getGlobalHeaderValue("Permissions-Policy");

  assert.equal(permissionsPolicy, "camera=(), microphone=(), geolocation=()");
  assert.doesNotMatch(permissionsPolicy ?? "", /(?:^|,\s*)tools=/);
});

test("the policy names a same-origin reporting endpoint in both supported forms", async () => {
  // Until this existed a policy that blocked shipped code produced no signal
  // anywhere. `report-to` is the current API and `report-uri` is deprecated but
  // still the only one several engines honour, so dropping either loses reports.
  const csp = await getContentSecurityPolicy();
  assert.match(csp, /(?:^|;\s)report-to csp-endpoint(?:;|$)/u);
  assert.match(csp, /(?:^|;\s)report-uri \/api\/security\/csp-report(?:;|$)/u);
  // Same-origin: a report must never disclose to a third party which pages a
  // visitor loaded, so the endpoint is a path and never an absolute URL.
  assert.doesNotMatch(csp, /report-uri https?:\/\//u);
  assert.equal(contentSecurityPolicyReportingEndpoints(), 'csp-endpoint="/api/security/csp-report"');
});

test("middleware sends the header that makes report-to resolvable", () => {
  // `report-to` names a group; without a Reporting-Endpoints header defining
  // that group the directive is silently inert, which looks identical to
  // "no violations".
  const middlewareSource = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  assert.match(
    middlewareSource,
    /response\.headers\.set\("Reporting-Endpoints", contentSecurityPolicyReportingEndpoints\(\)\)/u,
  );
});

test("violation reports keep no query string and no unbounded field", () => {
  // Report bodies are attacker-controlled and a document-uri carries the whole
  // page URL, which on this application can hold a return-to path, an invitation
  // token, or an OAuth redirect_uri.
  assert.equal(
    safeReportUrl("https://rateloop-tokenless.vercel.app/sign-in?returnTo=%2Fsettings&token=secret#frag"),
    "https://rateloop-tokenless.vercel.app/sign-in",
  );
  assert.equal(safeReportUrl("inline"), "inline");
  assert.equal(safeReportUrl(undefined), "unknown");
  assert.ok(safeReportUrl(`https://example.com/${"a".repeat(5_000)}`).length <= 200);

  const [report] = normalizeCspReports([
    {
      body: {
        blockedURL: "wasm-eval",
        disposition: "enforce",
        documentURL: "https://rateloop-tokenless.vercel.app/human/profile?invite=secret",
        effectiveDirective: "script-src",
      },
      type: "csp-violation",
    },
  ]);
  assert.deepEqual(report, {
    blockedUri: "wasm-eval",
    directive: "script-src",
    disposition: "enforce",
    documentUri: "https://rateloop-tokenless.vercel.app/human/profile",
  });

  // The legacy application/csp-report shape must still be understood.
  const [legacy] = normalizeCspReports({
    "csp-report": { "blocked-uri": "eval", "document-uri": "https://x.test/a?b=c", "effective-directive": "font-src" },
  });
  assert.equal(legacy?.directive, "font-src");
  assert.equal(legacy?.documentUri, "https://x.test/a");

  // A flood of reports in one request cannot inflate a single log burst without bound.
  assert.ok(
    normalizeCspReports(Array.from({ length: 500 }, () => ({ body: { effectiveDirective: "img-src" } }))).length <= 20,
  );
  assert.deepEqual(normalizeCspReports("nonsense"), []);
});
