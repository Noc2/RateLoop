import { createHmac } from "node:crypto";
import "server-only";
import { dbClient } from "~~/lib/db";
import { TokenlessMcpHttpError } from "~~/lib/mcp/errors";

const REQUESTS_PER_MINUTE = 60;
const EVIDENCE_SHARE_REQUESTS_PER_MINUTE = 20;
const MINIMUM_SECRET_LENGTH = 32;

function rateLimitSecret() {
  const secret = process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET?.trim();
  if (!secret || secret.length < MINIMUM_SECRET_LENGTH) {
    throw new TokenlessMcpHttpError("MCP rate limiting is unavailable.", 503, "rate_limit_unavailable");
  }
  return secret;
}

function clientIdentity(headers: Headers) {
  // Vercel overwrites its forwarding headers at the platform boundary. Prefer
  // the Vercel-specific copy because it remains authoritative when a verified
  // proxy is placed in front of the deployment. Provider headers such as
  // CF-Connecting-IP are intentionally ignored here: they are meaningful only
  // after the platform has verified that proxy, not as application-level input.
  const vercelIp = headers
    .get("x-vercel-forwarded-for")
    ?.split(",")
    .map(value => value.trim())
    .find(Boolean);
  if (vercelIp) return `ip:${vercelIp}`;

  const directIp = headers.get("x-real-ip")?.trim();
  if (directIp) return `ip:${directIp}`;

  const forwardedFor = headers.get("x-forwarded-for");
  const proxyIp = forwardedFor
    ?.split(",")
    .map(value => value.trim())
    .filter(Boolean)
    .at(0);
  if (proxyIp) return `ip:${proxyIp}`;

  const authorization = headers.get("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ") && authorization.slice(7).trim()) {
    return `bearer:${authorization.slice(7).trim()}`;
  }

  throw new TokenlessMcpHttpError("MCP client identity is unavailable.", 503, "rate_limit_identity_unavailable");
}

function hashClient(headers: Headers, namespace: string) {
  return createHmac("sha256", rateLimitSecret())
    .update(`${namespace}\0${clientIdentity(headers)}`)
    .digest("hex");
}

function minuteWindow(now: Date) {
  const window = new Date(now);
  window.setUTCSeconds(0, 0);
  return window;
}

async function consumeRateLimit(input: { headers: Headers; limit: number; namespace: string; now: Date }) {
  const clientHash = hashClient(input.headers, input.namespace);
  const windowStartedAt = minuteWindow(input.now);

  try {
    const result = await dbClient.execute({
      sql: `INSERT INTO tokenless_mcp_rate_limits (
              client_hash,
              window_started_at,
              request_count,
              updated_at
            ) VALUES (?, ?, 1, ?)
            ON CONFLICT (client_hash)
            DO UPDATE SET
              request_count = CASE
                WHEN tokenless_mcp_rate_limits.window_started_at = EXCLUDED.window_started_at
                  THEN tokenless_mcp_rate_limits.request_count + 1
                WHEN tokenless_mcp_rate_limits.window_started_at < EXCLUDED.window_started_at
                  THEN 1
                ELSE tokenless_mcp_rate_limits.request_count
              END,
              window_started_at = CASE
                WHEN tokenless_mcp_rate_limits.window_started_at < EXCLUDED.window_started_at
                  THEN EXCLUDED.window_started_at
                ELSE tokenless_mcp_rate_limits.window_started_at
              END,
              updated_at = EXCLUDED.updated_at
            RETURNING request_count, window_started_at`,
      args: [clientHash, windowStartedAt, input.now],
    });
    const requestCount = Number(result.rows[0]?.request_count);
    if (!Number.isSafeInteger(requestCount) || requestCount < 1) {
      throw new Error("Invalid MCP rate-limit counter.");
    }
    return {
      allowed: requestCount <= input.limit,
      limit: input.limit,
      remaining: Math.max(0, input.limit - requestCount),
      requestCount,
      retryAfterSeconds: Math.max(1, Math.ceil((windowStartedAt.getTime() + 60_000 - input.now.getTime()) / 1_000)),
    };
  } catch (error) {
    if (error instanceof TokenlessMcpHttpError) throw error;
    throw new TokenlessMcpHttpError("MCP rate limiting is unavailable.", 503, "rate_limit_unavailable");
  }
}

export async function consumeMcpRateLimit(headers: Headers, now = new Date()) {
  return consumeRateLimit({
    headers,
    limit: REQUESTS_PER_MINUTE,
    namespace: "rateloop-mcp-rate-limit",
    now,
  });
}

export async function consumeEvidenceShareRateLimit(headers: Headers, now = new Date()) {
  return consumeRateLimit({
    headers,
    limit: EVIDENCE_SHARE_REQUESTS_PER_MINUTE,
    namespace: "rateloop-evidence-share-rate-limit",
    now,
  });
}
