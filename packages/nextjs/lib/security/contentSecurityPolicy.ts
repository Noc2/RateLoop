type ContentSecurityPolicyOptions = {
  baseRpcUrl?: string;
  isDev?: boolean;
  isVercelLiveEnabled?: boolean;
  nonce?: string;
};

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
    httpsOrigin(options.baseRpcUrl),
    ...(options.isVercelLiveEnabled ? ["https://vercel.live", "https://*.pusher.com", "wss://*.pusher.com"] : []),
    ...(options.isDev ? ["http://localhost:*", "http://127.0.0.1:*"] : []),
  ]);

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob: https://*.thirdweb.com",
    `connect-src ${connectSources.join(" ")}`,
    `frame-src 'self' https://embedded-wallet.thirdweb.com ${vercelLive.join(" ")}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
