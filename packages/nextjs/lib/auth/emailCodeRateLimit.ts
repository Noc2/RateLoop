import { createHmac } from "node:crypto";
import "server-only";
import { dbClient } from "~~/lib/db";

/**
 * Caps how often a sign-in code can be sent to one address.
 *
 * Better Auth already throttles this route, but its bucket is keyed on the
 * caller's IP and path. That bounds what one client can do and does nothing
 * about the case this exists for: a distributed caller sending code after code
 * to somebody else's inbox. The address is the only key that stops that.
 *
 * **This limiter fails open, deliberately, and that is the opposite of
 * `lib/mcp/rateLimit.ts`.** That one answers 503 when its secret is missing or
 * no IP header is present, which is right for a machine API and wrong here: the
 * same behaviour on this path would take sign-in down on any deployment missing
 * an environment variable. A missing secret should cost us a control, not the
 * product's front door.
 *
 * The cap is an hour rather than a minute because the harm is cumulative volume,
 * not burst rate — a hundred emails an hour is abuse whether or not any single
 * minute looks calm.
 *
 * The tradeoff, stated plainly: an attacker who exhausts an address's budget
 * denies that person sign-in for the rest of the hour. Ten is chosen to make
 * that expensive without being reachable in normal use — a real person needs one
 * code and might retry two or three times — and losing an hour of sign-in is a
 * far smaller harm than an unbounded inbox flood.
 */
const CODES_PER_HOUR = 10;
const MINIMUM_SECRET_LENGTH = 32;
const NAMESPACE = "auth:email-code";

/** Reuses the MCP limiter's secret. A separate one would be a second thing to rotate. */
function rateLimitSecret() {
  const secret = process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET?.trim();
  return secret && secret.length >= MINIMUM_SECRET_LENGTH ? secret : null;
}

/**
 * The address never reaches the database. Only an HMAC of its normalised form
 * does, so the rate-limit table cannot become a record of who tried to sign in.
 */
function addressKey(email: string, secret: string) {
  return createHmac("sha256", secret).update(`${NAMESPACE}\0${email.trim().toLowerCase()}`).digest("hex");
}

function hourWindow(now: Date) {
  const window = new Date(now);
  window.setUTCMinutes(0, 0, 0);
  return window;
}

export type EmailCodeRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export async function consumeEmailCodeRateLimit(
  email: string,
  now = new Date(),
  client = dbClient,
): Promise<EmailCodeRateLimitResult> {
  const secret = rateLimitSecret();
  if (!secret) return { allowed: true, retryAfterSeconds: 0 };

  const windowStartedAt = hourWindow(now);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStartedAt.getTime() + 3_600_000 - now.getTime()) / 1_000));

  try {
    const result = await client.execute({
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
            RETURNING request_count`,
      args: [addressKey(email, secret), windowStartedAt, now],
    });
    const requestCount = Number(result.rows[0]?.request_count);
    if (!Number.isSafeInteger(requestCount) || requestCount < 1) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: requestCount <= CODES_PER_HOUR, retryAfterSeconds };
  } catch {
    // A database failure must not become a sign-in outage. The control is lost
    // for this request; the product is not.
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
