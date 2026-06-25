import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  hasTrustedRateLimitHeadersConfigured,
  isLoopbackRateLimitIdentifier,
  isLoopbackRequestUrl,
  resolveRateLimitIdentifier,
} from "./request-identity.js";
import { RateLimiter } from "./rate-limit.js";
import { registerContentRoutes } from "./routes/content-routes.js";
import { registerCorrelationRoutes } from "./routes/correlation-routes.js";
import { registerDataRoutes } from "./routes/data-routes.js";
import { registerDiscoveryRoutes } from "./routes/discovery-routes.js";
import { registerKeeperRoutes } from "./routes/keeper-routes.js";
import { registerLeaderboardRoutes } from "./routes/leaderboard-routes.js";
import { resolvePonderProtocolDeploymentMetadata } from "../protocol-deployment.js";

const KEEPER_INTERNAL_PATH_PREFIXES = [
  "/keeper/work",
  "/votes",
  "/advisory-votes",
  "/correlation",
  "/rounds",
] as const;

function isKeeperInternalPath(pathname: string) {
  return KEEPER_INTERNAL_PATH_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function hasValidKeeperWorkAuthorization(c: { req: { header: (name: string) => string | undefined } }) {
  const token = process.env.PONDER_KEEPER_WORK_TOKEN?.trim();
  if (!token) {
    return process.env.NODE_ENV !== "production";
  }
  return c.req.header("authorization") === `Bearer ${token}`;
}

const app = new Hono();

// ============================================================
// GLOBAL ERROR HANDLER — catch unhandled DB/runtime errors
// ============================================================

app.onError((err, c) => {
  console.error("[ponder-api] Unhandled error:", err.message);
  return c.json({ error: "Internal server error" }, 500);
});

// ============================================================
// RATE LIMITING — IP-based sliding window (in-memory, resets on restart)
// ============================================================

const rateLimiter = new RateLimiter(120, 60_000, 60_000);
const isProduction = process.env.NODE_ENV === "production";
const rateLimitMisconfigured = isProduction && !hasTrustedRateLimitHeadersConfigured();

if (rateLimitMisconfigured) {
  console.error(
    "[ponder] FATAL: RATE_LIMIT_TRUSTED_IP_HEADERS is required in production. " +
    "Set it to the proxy header(s) that carry the client IP. " +
    "All custom API routes will return 503 until this is fixed.",
  );
}

// H-7 (2026-05-22 audit): the in-memory limiter resets on process restart and is per-replica.
// Operators running multiple Ponder instances behind a load balancer will see the effective
// limit divide by replica count, and burst traffic immediately after a redeploy goes
// uncounted. Surface this at boot so it cannot be silently misconfigured; opt-in via
// PONDER_REPLICA_COUNT > 1 (or RATE_LIMIT_BACKEND=memory to acknowledge the trade-off).
{
  const replicaCount = Number.parseInt(process.env.PONDER_REPLICA_COUNT ?? "1", 10);
  const backendAcknowledged = process.env.RATE_LIMIT_BACKEND === "memory";
  if (isProduction && Number.isFinite(replicaCount) && replicaCount > 1 && !backendAcknowledged) {
    console.warn(
      `[ponder] WARNING: in-memory rate limiter is running with ${replicaCount} replicas; ` +
      "the effective per-IP limit divides by replica count. Migrate to a shared store " +
      "(e.g. Redis) or set RATE_LIMIT_BACKEND=memory to acknowledge this trade-off.",
    );
  }
}

app.use("/*", async (c, next) => {
  const requestPath = new URL(c.req.url).pathname;
  const isDeploymentProbe = requestPath === "/deployment";
  const isAuthorizedKeeperRequest = isKeeperInternalPath(requestPath) && hasValidKeeperWorkAuthorization(c);

  if (rateLimitMisconfigured && !isDeploymentProbe && !isAuthorizedKeeperRequest) {
    return c.json({ error: "RATE_LIMIT_TRUSTED_IP_HEADERS not configured. Set the env var." }, 503);
  }

  if (isDeploymentProbe || isAuthorizedKeeperRequest) {
    await next();
    return;
  }

  const identifier = resolveRateLimitIdentifier(name => c.req.header(name) ?? undefined, {
    requestUrl: c.req.url,
  });

  const isLoopbackRequest =
    process.env.NODE_ENV !== "production"
    && (isLoopbackRateLimitIdentifier(identifier) || isLoopbackRequestUrl(c.req.url));

  if (isLoopbackRequest) {
    await next();
    return;
  }

  const { allowed, retryAfter } = rateLimiter.check(identifier);

  if (!allowed) {
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "Too many requests" }, 429);
  }

  await next();
});

// Enable CORS for frontend access (restrict via CORS_ORIGIN in production, comma-separated)
const DEFAULT_CORS_ORIGINS = ["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"];
const corsOrigin = process.env.CORS_ORIGIN;
const corsMisconfigured = isProduction && !corsOrigin;
if (corsMisconfigured) {
  console.error(
    "[ponder] FATAL: CORS_ORIGIN is required in production. " +
    "Set CORS_ORIGIN env var to your frontend domain(s). " +
    "All API routes will return 503 until this is fixed.",
  );
}

const allowedOrigins = corsOrigin ? corsOrigin.split(",").map((origin: string) => origin.trim()) : DEFAULT_CORS_ORIGINS;
if (!isProduction && !corsOrigin) {
  console.warn("[ponder] CORS_ORIGIN not set — allowing localhost only. Set CORS_ORIGIN for production domains.");
}

// Block browser-facing routes if CORS is misconfigured — keeper work routes stay available with bearer auth.
if (corsMisconfigured) {
  app.use("/*", async (c, next) => {
    const requestPath = new URL(c.req.url).pathname;
    if (requestPath === "/deployment") {
      await next();
      return;
    }
    if (isKeeperInternalPath(requestPath) && hasValidKeeperWorkAuthorization(c)) {
      await next();
      return;
    }
    return c.json({ error: "CORS_ORIGIN not configured. Set CORS_ORIGIN env var." }, 503);
  });
}

app.use(
  "/*",
  cors({
    origin: allowedOrigins,
  }),
);

// Ponder provides /health and /status natively — no custom health check needed.
app.get("/deployment", (c) => {
  const metadata = resolvePonderProtocolDeploymentMetadata();
  if (!metadata) {
    return c.json({ configured: false, error: "Protocol deployment is not configured" }, 503);
  }

  return c.json(metadata);
});

registerContentRoutes(app);
registerCorrelationRoutes(app);
registerDiscoveryRoutes(app);
registerKeeperRoutes(app);
registerLeaderboardRoutes(app);
registerDataRoutes(app);

export default app;
