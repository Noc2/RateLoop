type ContentSecurityPolicyOptions = {
  baseRpcUrl?: string;
  formActionRedirectOrigins?: string[];
  frameRedirectOrigins?: string[];
  isDev?: boolean;
  isVercelLiveEnabled?: boolean;
  isWorldIdEnabled?: boolean;
  nonce?: string;
};

// The World ID widget is the only browser code that needs WebAssembly or a
// cross-origin font, and it renders only where `isWorldIdAssuranceEnabled()`
// does — behind TOKENLESS_NETWORK_PANELS_ENABLED. Gating its sources on the same
// flag keeps the policy exactly as tight as it is today wherever the widget
// cannot appear, which is the default.
const WORLD_ID_FONT_ORIGIN = "https://world-id-assets.com";
const WORLD_ID_BRIDGE_ORIGIN = "https://bridge.worldcoin.org";

/**
 * Where browsers send violation reports. Same-origin, so a report never leaves
 * the deployment and no third party learns which pages a visitor loaded.
 * `report-to` is the current Reporting API and needs the companion
 * `Reporting-Endpoints` response header; `report-uri` is deprecated but is still
 * the only one several engines honour, so both ship.
 */
export const CSP_REPORT_PATH = "/api/security/csp-report";
export const CSP_REPORT_GROUP = "csp-endpoint";

/** The `Reporting-Endpoints` header value that makes `report-to` resolvable. */
export function contentSecurityPolicyReportingEndpoints() {
  return `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;
}

const AGENT_OAUTH_AUTHORIZE_PATH = "/agent/oauth/authorize";

function httpsOrigin(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function unique(values: Array<string | undefined>) {
  return values.filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function resolveAgentOAuthFormActionRedirectOrigins(pathname: string, redirectUri: string | null) {
  if (pathname !== AGENT_OAUTH_AUTHORIZE_PATH || !redirectUri) return [];
  try {
    const url = new URL(redirectUri);
    const secure = url.protocol === "https:";
    const loopback = url.protocol === "http:" && isLoopbackHostname(url.hostname);
    if ((!secure && !loopback) || url.username || url.password || url.hash) return [];
    if (loopback) {
      // NextRequest normalizes loopback spellings in the query to localhost, while Chromium checks form redirects.
      const port = url.port ? `:${url.port}` : "";
      return [`http://localhost${port}`, `http://127.0.0.1${port}`, `http://[::1]${port}`];
    }
    return [url.origin];
  } catch {
    return [];
  }
}

export function resolveAgentOAuthFrameRedirectOrigins(pathname: string, redirectUri: string | null) {
  if (pathname !== AGENT_OAUTH_AUTHORIZE_PATH || !redirectUri) return [];
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname) || url.username || url.password || url.hash) {
      return [];
    }
    const port = url.port ? `:${url.port}` : "";
    return [`http://localhost${port}`, `http://127.0.0.1${port}`, `http://[::1]${port}`];
  } catch {
    return [];
  }
}

export function createContentSecurityPolicyNonce() {
  return crypto.randomUUID().replaceAll("-", "");
}

export function resolveRuntimeContentSecurityPolicyOptions(): ContentSecurityPolicyOptions {
  return {
    baseRpcUrl: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
    isDev: process.env.NODE_ENV === "development",
    isVercelLiveEnabled: process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "development",
    // Either flag activating the lane is what the production readiness check
    // treats as "enabled", so the policy grants on the same condition. Erring
    // toward granting matters here: a header that is too tight breaks the
    // widget outright, and both values are non-secret feature switches.
    isWorldIdEnabled:
      process.env.TOKENLESS_NETWORK_PANELS_ENABLED === "true" ||
      process.env.NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED === "true",
  };
}

export function buildContentSecurityPolicy(options: ContentSecurityPolicyOptions = {}) {
  const vercelLive = options.isVercelLiveEnabled ? ["https://vercel.live"] : [];
  const scriptSources = unique([
    "'self'",
    options.nonce ? `'nonce-${options.nonce}'` : undefined,
    options.isDev ? "'unsafe-eval'" : undefined,
    // @worldcoin/idkit-core compiles idkit_wasm_bg.wasm through
    // WebAssembly.instantiateStreaming, which the CSP treats as script
    // evaluation. The widget's default bridge URL lives inside that binary, so
    // without this the verification flow cannot start at all. Development
    // already grants 'unsafe-eval', a superset, which is exactly why this gap
    // is invisible outside a production build.
    options.isWorldIdEnabled && !options.isDev ? "'wasm-unsafe-eval'" : undefined,
    ...vercelLive,
  ]);
  const connectSources = unique([
    "'self'",
    // Base Sepolia is the only chain this deployment targets, so no Base mainnet
    // source belongs here. The wallet-binding connector and the World ID widget
    // are the only browser code that reaches a cross-origin endpoint at all.
    "https://sepolia.base.org",
    "https://*.thirdweb.com",
    "https://*.walletconnect.com",
    "https://*.walletconnect.org",
    "wss://*.walletconnect.org",
    options.isWorldIdEnabled ? WORLD_ID_BRIDGE_ORIGIN : undefined,
    httpsOrigin(options.baseRpcUrl),
    ...(options.isVercelLiveEnabled ? ["https://vercel.live", "https://*.pusher.com", "wss://*.pusher.com"] : []),
    ...(options.isDev ? ["http://localhost:*", "http://127.0.0.1:*"] : []),
  ]);
  // @worldcoin/idkit injects five @font-face rules for TWK Lausanne into the
  // modal's own <style> element. Self-hosting them was considered and rejected:
  // the URLs are hardcoded absolutes inside the published bundle, the widget's
  // style element renders after our global stylesheet so an override cannot
  // reliably win, and TWK Lausanne is a licensed commercial typeface we have no
  // right to re-serve from our own origin. The rules use font-display: swap, so
  // this is presentation only — the widget works either way.
  const fontSources = unique(["'self'", options.isWorldIdEnabled ? WORLD_ID_FONT_ORIGIN : undefined]);
  const formActionSources = unique(["'self'", ...(options.formActionRedirectOrigins ?? [])]);
  const frameSources = unique([
    "'self'",
    // The managed in-app wallet iframe is gated to non-production builds by
    // settings/wallets, so production never needs to frame it.
    ...(options.isDev ? ["https://embedded-wallet.thirdweb.com"] : []),
    "https://www.youtube-nocookie.com",
    ...vercelLive,
    ...(options.frameRedirectOrigins ?? []),
  ]);

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `font-src ${fontSources.join(" ")}`,
    "img-src 'self' data: blob: https://*.thirdweb.com",
    `connect-src ${connectSources.join(" ")}`,
    `frame-src ${frameSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action ${formActionSources.join(" ")}`,
    "frame-ancestors 'none'",
    `report-to ${CSP_REPORT_GROUP}`,
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}
