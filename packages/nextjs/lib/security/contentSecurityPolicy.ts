type ContentSecurityPolicyOptions = {
  baseRpcUrl?: string;
  formActionRedirectOrigins?: string[];
  frameRedirectOrigins?: string[];
  isDev?: boolean;
  isVercelLiveEnabled?: boolean;
  nonce?: string;
};

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
  };
}

export function buildContentSecurityPolicy(options: ContentSecurityPolicyOptions = {}) {
  const vercelLive = options.isVercelLiveEnabled ? ["https://vercel.live"] : [];
  const scriptSources = unique([
    "'self'",
    options.nonce ? `'nonce-${options.nonce}'` : undefined,
    "https://scripts.simpleanalyticscdn.com",
    options.isDev ? "'unsafe-eval'" : undefined,
    ...vercelLive,
  ]);
  const connectSources = unique([
    "'self'",
    "https://queue.simpleanalyticscdn.com",
    "https://sepolia.base.org",
    "https://mainnet.base.org",
    "https://*.thirdweb.com",
    "https://*.walletconnect.com",
    "https://*.walletconnect.org",
    "wss://*.walletconnect.com",
    "https://bridge.worldcoin.org",
    httpsOrigin(options.baseRpcUrl),
    ...(options.isVercelLiveEnabled ? ["https://vercel.live", "https://*.pusher.com", "wss://*.pusher.com"] : []),
    ...(options.isDev ? ["http://localhost:*", "http://127.0.0.1:*"] : []),
  ]);
  const formActionSources = unique(["'self'", ...(options.formActionRedirectOrigins ?? [])]);
  const frameSources = unique([
    "'self'",
    "https://embedded-wallet.thirdweb.com",
    "https://www.youtube-nocookie.com",
    ...vercelLive,
    ...(options.frameRedirectOrigins ?? []),
  ]);

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob: https://*.thirdweb.com",
    `connect-src ${connectSources.join(" ")}`,
    `frame-src ${frameSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action ${formActionSources.join(" ")}`,
    "frame-ancestors 'none'",
  ].join("; ");
}
